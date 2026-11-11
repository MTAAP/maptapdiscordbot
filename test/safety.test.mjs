import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Collection, TextChannel } from 'discord.js';
import {
    parseNpmrcPolicy,
    diffLockfilePackages,
    verifyReleaseAges,
} from '../scripts/check-lockfile-age.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maptap-safety-test-'));
const testDbPath = path.join(tmpDir, 'test.db');

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '100000000000000001';
process.env.GUILD_ID = '100000000000000002';
process.env.CHANNEL_ID = '100000000000000003';
process.env.TIMEZONE = 'Europe/Amsterdam';
process.env.SUMMARY_HOUR = '0';
process.env.DATABASE_PATH = testDbPath;

const scoreParser = await import('../dist/services/scoreParser.js');
const embeds = await import('../dist/utils/embeds.js');
const dbMod = await import('../dist/database/index.js');
const queries = await import('../dist/database/queries.js');
const allPlayersMod = await import('../dist/bot/commands/allplayers.js');
const messageCreateMod = await import('../dist/bot/events/messageCreate.js');
const commandsMod = await import('../dist/bot/commands/index.js');
const importCmdMod = await import('../dist/bot/commands/import.js');
const channelImportMod = await import('../dist/services/channelImport.js');
const schedulerMod = await import('../dist/services/scheduler.js');
const weeklyMod = await import('../dist/bot/commands/weekly.js');

dbMod.initializeDatabase();

function totalEmbedChars(embedBuilder) {
    const data = embedBuilder.toJSON();
    let total = 0;
    if (data.title) total += data.title.length;
    if (data.description) total += data.description.length;
    if (data.footer?.text) total += data.footer.text.length;
    if (data.author?.name) total += data.author.name.length;
    for (const f of data.fields ?? []) {
        total += f.name.length + f.value.length;
    }
    return total;
}

test('F2: lockfile release-age checker fails closed on young or missing timestamps and bad .npmrc', () => {
    const policy = parseNpmrcPolicy('min-release-age=2\nignore-scripts=true\n');
    assert.deepEqual(policy, { minReleaseAgeDays: 2, ignoreScripts: true });

    assert.throws(() => parseNpmrcPolicy('min-release-age=2\n'), /ignore-scripts=true/);
    assert.throws(() => parseNpmrcPolicy('min-release-age=1\nignore-scripts=true\n'), /min-release-age>=2/);

    const nowMs = Date.parse('2026-11-11T18:00:00Z');
    const packuments = new Map([
        [
            'young-pkg',
            { time: { '1.0.1': '2026-11-10T20:00:00Z' } }, // 22h old -> must fail
        ],
        [
            'mature-pkg',
            { time: { '2.0.0': '2026-11-05T12:00:00Z' } }, // >48h old -> must pass
        ],
        [
            'missing-time-pkg',
            { time: {} }, // missing version timestamp -> must fail closed
        ],
    ]);

    const badViolations = verifyReleaseAges(
        [
            { name: 'young-pkg', version: '1.0.1' },
            { name: 'missing-time-pkg', version: '0.1.0' },
        ],
        packuments,
        nowMs,
        2
    );
    assert.equal(badViolations.length, 2);
    assert.match(badViolations[0], /below 48h minimum/);
    assert.match(badViolations[1], /missing registry publish timestamp/);

    const okViolations = verifyReleaseAges(
        [{ name: 'mature-pkg', version: '2.0.0' }],
        packuments,
        nowMs,
        2
    );
    assert.deepEqual(okViolations, []);

    const diffed = diffLockfilePackages(
        {
            packages: {
                '': { name: 'app', version: '1.0.0' },
                'node_modules/mature-pkg': { version: '2.0.0' },
                'node_modules/young-pkg': { version: '1.0.1' },
            },
        },
        {
            packages: {
                '': { name: 'app', version: '1.0.0' },
                'node_modules/mature-pkg': { version: '2.0.0' },
            },
        }
    );
    assert.deepEqual(diffed, [{ name: 'young-pkg', version: '1.0.1' }]);
});

test('F12: parseMapTapMessage accepts valid emojis (including U+1FA00+) and rejects out-of-bounds scores/rounds', () => {
    const valid = scoreParser.parseMapTapMessage(
        'www.maptap.gg November 11\n96🏅 93🫡 94⭐ 96🔥 54😔\nFinal score: 924 🎉'
    );
    assert.deepEqual(valid, {
        gameDate: 'November 11',
        roundScores: [96, 93, 94, 96, 54],
        finalScore: 924,
    });

    assert.equal(
        scoreParser.parseMapTapMessage(
            'www.maptap.gg November 11\n100🏆 100🏆 100🏆 100🏆 100🏆\nFinal score: 999999999'
        ),
        null,
        'Should reject finalScore > 1000'
    );

    assert.equal(
        scoreParser.parseMapTapMessage(
            'www.maptap.gg November 11\nno rounds here\nFinal score: 500'
        ),
        null,
        'Should reject zero round scores'
    );

    assert.equal(
        scoreParser.parseMapTapMessage(
            'www.maptap.gg November 11\n100🏆 100🏆 100🏆 100🏆 100🏆 100🏆\nFinal score: 600'
        ),
        null,
        'Should reject more than 5 rounds'
    );

    assert.equal(
        scoreParser.parseMapTapMessage(
            'www.maptap.gg November 11\n250🏆 100🏆 100🏆 100🏆 100🏆\nFinal score: 650'
        ),
        null,
        'Should reject round score > 200'
    );
});

test('F12: parseMapTapMessage resists quadratic ReDoS on 4000-char digit message', () => {
    const adversarial = 'www.maptap.gg November 11\n' + '9'.repeat(3900) + 'x\n99😔\nFinal score: 500';
    const start = performance.now();
    scoreParser.parseMapTapMessage(adversarial);
    const elapsedMs = performance.now() - start;
    assert.ok(elapsedMs < 10, `Expected <10ms, took ${elapsedMs.toFixed(2)}ms`);
});

test('F12: normalizeGameDate validates strict calendar dates and rejects arbitrary strings', () => {
    const ref = new Date('2026-11-11T12:00:00Z');
    assert.equal(scoreParser.normalizeGameDate('November 11', 'Europe/Amsterdam', ref), '2026-11-11');
    assert.equal(
        scoreParser.normalizeGameDate('December 31', 'Europe/Amsterdam', new Date('2026-01-01T12:00:00Z')),
        '2025-12-31'
    );
    assert.equal(
        scoreParser.normalizeGameDate('January 1', 'Europe/Amsterdam', new Date('2026-12-31T12:00:00Z')),
        '2027-01-01'
    );
    assert.equal(scoreParser.normalizeGameDate('Foo1', 'Europe/Amsterdam', ref), null);
    assert.equal(scoreParser.normalizeGameDate('November 99', 'Europe/Amsterdam', ref), null);
    assert.equal(scoreParser.normalizeGameDate('February 30', 'Europe/Amsterdam', ref), null);
    assert.equal(scoreParser.normalizeGameDate('November 11 extra', 'Europe/Amsterdam', ref), null);
});

test('F13: timezone-aware date helpers compute DST and Monday-Sunday ranges accurately under TZ=UTC', () => {
    assert.equal(typeof schedulerMod.getYesterdayDate, 'function');
    assert.equal(typeof schedulerMod.getLastWeekDateRange, 'function');
    assert.equal(typeof weeklyMod.getCurrentWeekDateRange, 'function');

    // 2026-03-30 00:00 CEST is 2026-03-29T22:00:00Z (DST spring-forward midnight)
    assert.equal(
        schedulerMod.getYesterdayDate('Europe/Amsterdam', new Date('2026-03-29T22:00:00Z')),
        '2026-03-29'
    );

    // Monday 2026-11-16 00:05 CET is 2026-11-15T23:05:00Z -> completed Mon..Sun is 2026-11-09..2026-11-15
    assert.deepEqual(
        schedulerMod.getLastWeekDateRange('Europe/Amsterdam', new Date('2026-11-15T23:05:00Z')),
        { startDate: '2026-11-09', endDate: '2026-11-15' }
    );

    // Sunday 2026-11-15 23:30 CET is 2026-11-15T22:30:00Z -> current week is 2026-11-09..2026-11-15
    assert.deepEqual(
        weeklyMod.getCurrentWeekDateRange('Europe/Amsterdam', new Date('2026-11-15T22:30:00Z')),
        { startDate: '2026-11-09', endDate: '2026-11-15' }
    );
});

test('F11: createWeeklySummaryEmbed, createDailySummaryEmbed, and handleAllPlayers stay within Discord limits', async () => {
    const manyWeeklyPlayers = Array.from({ length: 45 }, (_, i) => ({
        user_id: String(1000 + i),
        username: `VeryLongPlayerDisplayName_${String(i + 1).padStart(2, '0')}`,
        games: 7,
        totalScore: 6300 - i * 10,
        average: 900 - i * 1.4,
        best: 980,
        worst: 810,
    }));

    const weeklyEmbed = embeds.createWeeklySummaryEmbed({
        startDate: '2026-11-09',
        endDate: '2026-11-15',
        totalGames: 315,
        totalPlayers: 45,
        overallAverage: 868.5,
        playerStats: manyWeeklyPlayers,
        bestScore: { username: 'VeryLongPlayerDisplayName_01', score: 990, game_date: '2026-11-10' },
        worstScore: { username: 'VeryLongPlayerDisplayName_45', score: 420, game_date: '2026-11-12' },
    });
    const weeklyJson = weeklyEmbed.toJSON();
    assert.ok((weeklyJson.fields ?? []).length <= 25);
    for (const f of weeklyJson.fields ?? []) {
        assert.ok(f.value.length <= 1024, `Weekly field exceeded 1024: ${f.value.length}`);
    }
    assert.ok(totalEmbedChars(weeklyEmbed) <= 6000);

    const manyRecords = Array.from({ length: 18 }, (_, i) => ({
        id: i + 1,
        record_type: 'top_score',
        user_id: String(2000 + i),
        username: `RecordBreakerLongName_${i + 1}`,
        value: 950 + i,
        previous_value: 949 + i,
        previous_holder_id: String(1999 + i),
        previous_holder_name: `PreviousHolderLongName_${i}`,
        game_date: '2026-11-11',
        created_at: new Date().toISOString(),
    }));
    const dailyEmbed = embeds.createDailySummaryEmbed(
        '2026-11-11',
        {
            average: 880,
            totalGames: 18,
            topScores: [
                { user_id: '1', username: 'A', score: 990 },
                { user_id: '2', username: 'B', score: 980 },
                { user_id: '3', username: 'C', score: 970 },
            ],
            worstScore: { user_id: '4', username: 'D', score: 500 },
        },
        manyRecords
    );
    for (const f of dailyEmbed.toJSON().fields ?? []) {
        assert.ok(f.value.length <= 1024, `Daily field exceeded 1024: ${f.value.length}`);
    }
    assert.ok(totalEmbedChars(dailyEmbed) <= 6000);

    dbMod.db.exec('DELETE FROM scores; DELETE FROM records;');
    for (let i = 0; i < 95; i++) {
        queries.insertScore(
            `player_${i}`,
            `PlayerWithLongHandle_${String(i).padStart(3, '0')}`,
            950 - i,
            [190, 190, 190, 190, 190 - i],
            '2026-11-11',
            `msg_all_${i}`
        );
    }

    let repliedPayload = null;
    await allPlayersMod.handleAllPlayers({
        reply: async payload => {
            repliedPayload = payload;
        },
    });
    assert.ok(repliedPayload?.embeds?.length === 1);
    const allEmbed = repliedPayload.embeds[0];
    const allJson = allEmbed.toJSON();
    assert.ok((allJson.fields ?? []).length <= 25);
    for (const f of allJson.fields ?? []) {
        assert.ok(f.value.length <= 1024);
        assert.ok(!f.value.trimStart().startsWith('└'), 'Must not split 2-line player entry across fields');
    }
    assert.ok(totalEmbedChars(allEmbed) <= 6000, `Total embed chars ${totalEmbedChars(allEmbed)} > 6000`);
});

test('F10: handleMessage, handleInteraction, and handleImport swallow Discord API secondary rejections and scope mentions', async () => {
    dbMod.db.exec('DELETE FROM scores; DELETE FROM records; DELETE FROM meta;');
    queries.setMetaValue('initial_backfill_complete', '1');

    let sentPayload = null;
    await assert.doesNotReject(async () => {
        await messageCreateMod.handleMessage({
            id: 'msg_live_1',
            author: { id: '9001', username: 'Alice @everyone', bot: false },
            channelId: '100000000000000003',
            content: 'www.maptap.gg November 11\n190🏆 190🏆 190🏆 190🏆 190🏆\nFinal score: 950',
            createdAt: new Date('2026-11-11T12:00:00Z'),
            channel: {
                send: async payload => {
                    sentPayload = payload;
                },
            },
            react: async () => {
                throw new Error('DiscordAPIError[10008]: Unknown Message');
            },
        });
    });

    assert.equal(typeof sentPayload, 'object');
    assert.deepEqual(sentPayload.allowedMentions, { users: ['9001'], parse: [] });

    await assert.doesNotReject(async () => {
        await commandsMod.handleInteraction({
            isChatInputCommand: () => true,
            commandName: 'maptap',
            replied: false,
            deferred: false,
            options: { getSubcommand: () => 'daily' },
            reply: async () => {
                throw new Error('DiscordAPIError[40060]: Interaction has already been acknowledged.');
            },
            followUp: async () => {
                throw new Error('DiscordAPIError[10062]: Unknown interaction');
            },
        });
    });

    await assert.doesNotReject(async () => {
        let editCalls = 0;
        await importCmdMod.handleImport({
            memberPermissions: { has: () => true },
            client: {
                channels: {
                    fetch: async () => {
                        throw new Error('Channel fetch boom');
                    },
                },
            },
            deferReply: async () => {},
            editReply: async () => {
                editCalls++;
                if (editCalls > 1) {
                    throw new Error('DiscordAPIError[50027]: Invalid Webhook Token');
                }
            },
        });
    });
});

test('F14: importChannelHistory enforces single-flight lock, uses cache:false, and seeds baseline top_score record', async () => {
    dbMod.db.exec('DELETE FROM scores; DELETE FROM records; DELETE FROM meta;');

    const fakeChannel = Object.create(TextChannel.prototype);
    const seenFetchOptions = [];
    let releaseFirstFetch;
    const gate = new Promise(resolve => {
        releaseFirstFetch = resolve;
    });

    let callNum = 0;
    fakeChannel.messages = {
        fetch: async opts => {
            seenFetchOptions.push(opts);
            callNum++;
            if (callNum === 1) {
                await gate;
                const col = new Collection();
                col.set('m1', {
                    id: 'm1',
                    createdTimestamp: Date.UTC(2026, 10, 10, 12),
                    createdAt: new Date(Date.UTC(2026, 10, 10, 12)),
                    author: { id: 'u_top', username: 'Champ', bot: false },
                    content: 'www.maptap.gg November 10\n200🏆 200🏆 200🏆 194🏆 194🏆\nFinal score: 988',
                });
                return col;
            }
            return new Collection();
        },
    };

    const fakeClient = {
        channels: {
            fetch: async () => fakeChannel,
        },
    };

    const firstRun = channelImportMod.importChannelHistory(fakeClient);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(channelImportMod.isImportInProgress(), true);

    await assert.rejects(
        () => channelImportMod.importChannelHistory(fakeClient),
        { name: 'ChannelImportBusyError' }
    );

    releaseFirstFetch();
    const res = await firstRun;
    assert.equal(channelImportMod.isImportInProgress(), false);
    assert.equal(res.imported, 1);
    assert.equal(seenFetchOptions[0].cache, false);

    const recs = queries.getRecordsForDate('2026-11-10');
    assert.equal(recs.length, 1);
    assert.equal(recs[0].value, 988);
    assert.equal(recs[0].user_id, 'u_top');

    // Regression check: failed startup backfill keeps record announcements gated off
    dbMod.db.exec('DELETE FROM scores; DELETE FROM records; DELETE FROM meta;');
    let failPage = 0;
    const partialChannel = Object.create(TextChannel.prototype);
    partialChannel.messages = {
        fetch: async () => {
            failPage++;
            if (failPage === 1) {
                const col = new Collection();
                col.set('m_recent', {
                    id: 'm_recent',
                    createdTimestamp: Date.UTC(2026, 10, 10, 12),
                    createdAt: new Date(Date.UTC(2026, 10, 10, 12)),
                    author: { id: 'u_low', username: 'Recent', bot: false },
                    content: 'www.maptap.gg November 10\n100🏆 100🏆 100🏆 100🏆 100🏆\nFinal score: 500',
                });
                return col;
            }
            throw new Error('Transient Discord 503 mid-backfill');
        },
    };
    await channelImportMod.backfillIfDatabaseEmpty({
        channels: { fetch: async () => partialChannel },
    });
    assert.equal(channelImportMod.areRecordAnnouncementsReady(), false);

    let prematureAnnouncements = 0;
    await messageCreateMod.handleMessage({
        id: 'm_live_during_incomplete',
        author: { id: 'u_mid', username: 'MidPlayer', bot: false },
        channelId: '100000000000000003',
        content: 'www.maptap.gg November 11\n120🏆 120🏆 120🏆 120🏆 120🏆\nFinal score: 600',
        createdAt: new Date('2026-11-11T12:00:00Z'),
        channel: {
            send: async () => {
                prematureAnnouncements++;
            },
        },
        react: async () => {},
    });
    assert.equal(prematureAnnouncements, 0);
    assert.equal(queries.getRecordsForDate('2026-11-11').length, 0);
});

test.after(() => {
    try {
        dbMod.db.close();
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
