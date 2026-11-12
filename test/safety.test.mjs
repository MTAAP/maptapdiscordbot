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
process.env.MAPTAP_DISABLE_AUTO_CHALLENGE_SYNC = '1';
process.env.MAPTAP_DISABLE_AUTO_LLM_RUN = '1';

const scoreParser = await import('../dist/services/scoreParser.js');
const geographyMod = await import('../dist/services/geography.js');
const challengeSyncMod = await import('../dist/services/challengeSync.js');
const gifEncoderMod = await import('../dist/utils/gifEncoder.js');
const configMod = await import('../dist/config.js');
const embeds = await import('../dist/utils/embeds.js');
const dbMod = await import('../dist/database/index.js');
const queries = await import('../dist/database/queries.js');
const allPlayersMod = await import('../dist/bot/commands/allplayers.js');
const messageCreateMod = await import('../dist/bot/events/messageCreate.js');
const commandsMod = await import('../dist/bot/commands/index.js');
const importCmdMod = await import('../dist/bot/commands/import.js');
const llmCmdMod = await import('../dist/bot/commands/llm.js');
const llmPlayerMod = await import('../dist/services/llmPlayer.js');
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

test('Phase 1: parseMapTapMessage supports https/linkless headers and flag-prefix round scores', () => {
    const discordShare = scoreParser.parseMapTapMessage(
        'https://maptap.gg November 11\n🇵🇱99 🇯🇵95 🇺🇸96 🇮🇹91 🌐17\nFinal score: 710\n🔥 12 day streak'
    );
    assert.deepEqual(discordShare, {
        gameDate: 'November 11',
        roundScores: [99, 95, 96, 91, 17],
        finalScore: 710,
    });

    const linklessShare = scoreParser.parseMapTapMessage(
        'MapTap November 11\n99🏆 95⭐ 96🔥 91👏 17😔\nFinal score: 710 Antipode!'
    );
    assert.deepEqual(linklessShare, {
        gameDate: 'November 11',
        roundScores: [99, 95, 96, 91, 17],
        finalScore: 710,
    });
});

test('Phase 1: classifyLocation resolves border straits, islands, bare cities, Georgia disambiguation, and ocean', () => {
    assert.deepEqual(
        geographyMod.classifyLocation({ name: 'Dover Strait, England', lat: 51.05, lng: 1.45 }),
        {
            countryCode: 'GB',
            countryName: 'United Kingdom',
            continent: 'Europe',
            subregion: 'Northern Europe',
        }
    );

    assert.deepEqual(
        geographyMod.classifyLocation({ name: 'Rhodes, Greece', lat: 36.434, lng: 28.217 }),
        {
            countryCode: 'GR',
            countryName: 'Greece',
            continent: 'Europe',
            subregion: 'Southern Europe',
        }
    );

    assert.deepEqual(
        geographyMod.classifyLocation({ name: 'Mutsamudu, Comoros', lat: -12.1696, lng: 44.4005 }),
        {
            countryCode: 'KM',
            countryName: 'Comoros',
            continent: 'Africa',
            subregion: 'East Africa',
        }
    );

    assert.deepEqual(
        geographyMod.classifyLocation({ name: 'Leipzig', lat: 51.3397, lng: 12.3731 }),
        {
            countryCode: 'DE',
            countryName: 'Germany',
            continent: 'Europe',
            subregion: 'Western Europe',
        }
    );

    assert.equal(
        geographyMod.classifyLocation({ name: 'Savannah, Georgia', lat: 32.0809, lng: -81.0912 }).countryCode,
        'US'
    );
    assert.equal(
        geographyMod.classifyLocation({ name: 'Tbilisi, Georgia', lat: 41.7151, lng: 44.8271 }).countryCode,
        'GE'
    );
    assert.equal(
        geographyMod.classifyLocation({ name: 'Elephant Island, Antarctica', lat: -61.1333, lng: -55.1167 }).countryCode,
        'AQ'
    );
    assert.equal(
        geographyMod.classifyLocation({
            name: 'the location where the Titanic sank',
            lat: 41.7269,
            lng: -49.948,
        }).countryCode,
        'XX'
    );
});

test('Phase 1: parseChallengeScript handles active year, archived comment year, and wrong-year rejection', () => {
    const sampleScript = `
cities = [
    { id: "2026-11-11-a", name: "Poznań, Poland", lat: 52.4064, lng: 16.9252 },
    { id: "2026-11-11-b", name: "Kanazawa, Japan", lat: 36.5611, lng: 136.6566 },
    { id: "2026-11-11-c", name: "Syracuse, New York, USA", lat: 43.0481, lng: -76.1474 },
    { id: "2026-11-11-d", name: "Taranto, Italy", lat: 40.4711, lng: 17.2431 },
    { id: "2026-11-11-e", name: "Mutsamudu, Comoros", lat: -12.1696, lng: 44.4005 }
];

// ===== 2025 =====
// cities = [
//     { name: 'Syracuse, New York', lat: 43.0481, lng: -76.1474 },
//     { name: 'Kansas City', lat: 39.0997, lng: -94.5786 },
//     { name: 'Nara, Japan', lat: 34.6851, lng: 135.8048 },
//     { name: 'Leipzig', lat: 51.3397, lng: 12.3731 },
//     { name: 'Luanda, Angola', lat: -8.8390, lng: 13.2894 }
// ];
`;

    const active2026 = challengeSyncMod.parseChallengeScript(
        sampleScript,
        '2026-11-11',
        new Date('2026-11-11T12:00:00Z')
    );
    assert.equal(active2026?.length, 5);
    assert.equal(active2026[0].countryCode, 'PL');
    assert.equal(active2026[4].countryCode, 'KM');

    const archived2025 = challengeSyncMod.parseChallengeScript(
        sampleScript,
        '2025-11-11',
        new Date('2026-11-11T12:00:00Z')
    );
    assert.equal(archived2025?.length, 5);
    assert.equal(archived2025[3].name, 'Leipzig');
    assert.equal(archived2025[3].subregion, 'Western Europe');
    assert.equal(archived2025[4].countryCode, 'AO');

    const missing2024 = challengeSyncMod.parseChallengeScript(
        sampleScript,
        '2024-11-11',
        new Date('2026-11-11T12:00:00Z')
    );
    assert.equal(missing2024, null, 'Must fail closed rather than misattributing 2026 cities to 2024');

    // Static parser must never execute injected JS expressions or template interpolations
    const maliciousScript = `
cities = [
    { id: "2026-11-12-1", name: "Oslo, Norway", lat: 59.91, lng: 10.75, rce: cities.constructor.constructor("throw new Error('RCE')")() },
    { id: "2026-11-12-2", name: "Paris, France", lat: 48.85, lng: 2.35, tpl: \`\${(() => { throw new Error('TPL'); })()}\` },
    { id: "2026-11-12-3", name: "Tokyo, Japan", lat: 35.68, lng: 139.69 },
    { id: "2026-11-12-4", name: "Cairo, Egypt", lat: 30.04, lng: 31.23 },
    { id: "2026-11-12-5", name: "Lima, Peru", lat: -12.04, lng: -77.04 }
];
`;
    const safeParsed = challengeSyncMod.parseChallengeScript(
        maliciousScript,
        '2026-11-12',
        new Date('2026-11-12T12:00:00Z')
    );
    assert.equal(safeParsed?.length, 5);
    assert.equal(safeParsed[0].name, 'Oslo, Norway');
    assert.equal(safeParsed[0].countryCode, 'NO');
});

test('Phase 1: regional standings, passport, and daily summary spoiler gate work accurately', () => {
    dbMod.db.exec('DELETE FROM scores; DELETE FROM records; DELETE FROM daily_challenges;');

    const parsed = challengeSyncMod.parseChallengeScript(
        `cities = [
            { id: "2026-11-01-1", name: "Leipzig, Germany", lat: 51.3397, lng: 12.3731 },
            { id: "2026-11-01-2", name: "Lyon, France", lat: 45.7640, lng: 4.8357 },
            { id: "2026-11-01-3", name: "Syracuse, New York, USA", lat: 43.0481, lng: -76.1474 },
            { id: "2026-11-01-4", name: "Chicago, Illinois, USA", lat: 41.8781, lng: -87.6298 },
            { id: "2026-11-01-5", name: "Kanazawa, Japan", lat: 36.5611, lng: 136.6566 }
        ];`,
        '2026-11-01'
    );
    queries.upsertDailyChallengeRounds(parsed);

    // Alice crushes Western Europe (100, 98), Bob crushes Northern America (99, 100)
    queries.insertScore('u_alice', 'Alice', 880, [100, 98, 80, 82, 90], '2026-11-01', 'm_a1');
    queries.insertScore('u_bob', 'Bob', 920, [84, 86, 99, 100, 90], '2026-11-01', 'm_b1');

    // Seed an active TODAY challenge + human score: regional queries and autocomplete must NOT leak it before midnight
    const todayIso = queries.getTodayDate('Europe/Amsterdam');
    const todayParsed = challengeSyncMod.parseChallengeScript(
        `cities = [
            { id: "${todayIso}-1", name: "Reykjavik, Iceland", lat: 64.1466, lng: -21.9426 },
            { id: "${todayIso}-2", name: "Bergen, Norway", lat: 60.3913, lng: 5.3221 },
            { id: "${todayIso}-3", name: "Lima, Peru", lat: -12.0464, lng: -77.0428 },
            { id: "${todayIso}-4", name: "Quito, Ecuador", lat: -0.1807, lng: -78.4678 },
            { id: "${todayIso}-5", name: "Suva, Fiji", lat: -18.1416, lng: 178.4419 }
        ];`,
        todayIso,
        new Date(`${todayIso}T12:00:00Z`)
    );
    queries.upsertDailyChallengeRounds(todayParsed);
    queries.insertScore('u_alice', 'Alice', 990, [100, 100, 100, 100, 90], todayIso, 'm_a_today');

    const neArea = queries.resolveGeoArea('Northern Europe');
    const neBoard = queries.getGeoLeaderboard(neArea, 1);
    assert.equal(neBoard.totalChallengeRounds, 0, 'Today Northern Europe rounds must stay spoiler-locked until midnight');
    assert.equal(neBoard.easiestLocation, null);

    const icelandChoices = queries.getGeoAutocompleteChoices('Iceland');
    assert.equal(icelandChoices.length, 0, 'Autocomplete must not reveal unreleased today countries');

    const weArea = queries.resolveGeoArea('Western Europe');
    assert.equal(weArea?.kind, 'subregion');
    const weBoard = queries.getGeoLeaderboard(weArea, 1);
    assert.equal(weBoard.standings[0].username, 'Alice');
    assert.equal(weBoard.standings[0].meanAccuracy, 99);
    assert.ok(weBoard.standings[0].meanDelta > 6);

    const naArea = queries.resolveGeoArea('North America');
    assert.equal(naArea?.kind, 'continent');
    const naBoard = queries.getGeoLeaderboard(naArea, 1);
    assert.equal(naBoard.standings[0].username, 'Bob');
    assert.equal(naBoard.standings[0].meanAccuracy, 99.5);

    const passport = queries.getUserPassport('u_alice');
    assert.equal(passport?.totalSyncedRounds, 5, 'Passport must exclude today unreleased rounds');
    assert.equal(passport?.strongestSubregions[0].label, 'Western Europe');
    assert.equal(passport?.weakestSubregions[0].label, 'Northern America');

    // Spoiler gate: live /maptap daily hides city names; midnight summary reveals them
    const stats = queries.getDailyStats('2026-11-01');
    const breakdown = queries.getDailyChallengeBreakdown('2026-11-01');

    const liveEmbed = embeds.createDailySummaryEmbed('2026-11-01', stats, []).toJSON();
    assert.ok(
        !JSON.stringify(liveEmbed).includes('Leipzig'),
        'Live daily embed must not leak today city names'
    );

    const midnightEmbed = embeds
        .createDailySummaryEmbed('2026-11-01', stats, [], {
            revealCities: true,
            roundBreakdown: breakdown,
        })
        .toJSON();
    assert.ok(
        JSON.stringify(midnightEmbed).includes('Leipzig, Germany'),
        'Midnight summary must reveal locations'
    );
});

test('Phase 2: config defaults to low reasoning and encodeAnimatedGifAsync produces valid looping GIF89a', async () => {
    assert.equal(configMod.config.llm.reasoningEffort, 'low');

    const w = 48;
    const h = 48;
    const makeGradientFrame = (seedOffset) => {
        const rgba = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const off = (y * w + x) * 4;
                rgba[off] = (x * 5 + seedOffset) & 0xff;
                rgba[off + 1] = (y * 5 + seedOffset * 2) & 0xff;
                rgba[off + 2] = ((x + y) * 3) & 0xff;
                rgba[off + 3] = 255;
            }
        }
        return rgba;
    };

    const gifBuf = await gifEncoderMod.encodeAnimatedGifAsync(
        [
            { rgba: makeGradientFrame(0), delayMs: 850 },
            { rgba: makeGradientFrame(64), delayMs: 1800 },
        ],
        w,
        h
    );

    assert.equal(gifBuf.subarray(0, 6).toString('ascii'), 'GIF89a');
    assert.equal(gifBuf.readUInt16LE(6), w);
    assert.equal(gifBuf.readUInt16LE(8), h);
    assert.ok(gifBuf.includes(Buffer.from('NETSCAPE2.0', 'ascii')));
    assert.equal(gifBuf[gifBuf.length - 1], 0x3b, 'GIF must end with 0x3B trailer');
});

test('Phase 2: llm_daily_runs keeps human scores pure, computes W-L rivalry, and enforces midnight spoiler gate', async () => {
    dbMod.db.exec('DELETE FROM scores; DELETE FROM records; DELETE FROM daily_challenges; DELETE FROM llm_daily_runs;');

    queries.insertScore('u_grissom', '.grissom', 982, [93, 96, 98, 99, 100], '2026-11-10', 'm_g1');
    queries.insertScore('u_act', 'activity', 827, [96, 93, 94, 96, 54], '2026-11-10', 'm_ac1');

    const fakeGifPath = path.join(tmpDir, '2026-11-10.gif');
    fs.writeFileSync(fakeGifPath, Buffer.from('GIF89a-mock'));

    queries.upsertLlmDailyRunStart('2026-11-10', 'local-smart', 'visual-crosshair');
    queries.completeLlmDailyRun({
        gameDate: '2026-11-10',
        model: 'local-smart',
        mode: 'visual-crosshair',
        totalScore: 980,
        rawScore: 486,
        roundScores: [92, 98, 98, 100, 98],
        roundDetails: [
            {
                round: 1,
                multiplier: 1,
                cityName: 'Poznań, Poland',
                rawScore: 92,
                weightedPoints: 92,
                distanceKm: 383,
                stepCount: 5,
                forcedDrop: false,
                confidence: 72,
                monologue: 'Planted on the Warta river bend in Greater Poland!',
                snarkyText: 'Great!',
            },
            {
                round: 4,
                multiplier: 3,
                cityName: 'Taranto, Italy',
                rawScore: 100,
                weightedPoints: 300,
                distanceKm: 22,
                stepCount: 6,
                forcedDrop: false,
                confidence: 82,
                monologue: 'Dead on the Salento instep notch at Taranto!',
                snarkyText: 'Unbelievably good. Wow!',
            },
        ],
        totalSteps: 28,
        wallClockMs: 180_000,
        promptTokens: 45_000,
        completionTokens: 8_000,
        reasoningTokens: 2_500,
        gifPath: fakeGifPath,
    });

    // Human stats must NOT include local-smart's 980
    const humanDayStats = queries.getDailyStats('2026-11-10');
    assert.equal(humanDayStats.totalGames, 2);
    assert.equal(humanDayStats.average, (982 + 827) / 2);

    const placement = queries.getLlmDayPlacement('2026-11-10');
    assert.equal(placement?.virtualRank, 2);
    assert.equal(placement?.humansBeaten, 1);
    assert.equal(placement?.humanCount, 2);

    const rivalry = queries.getLlmVsHumansStats();
    assert.equal(rivalry.completedRuns, 1);
    assert.equal(rivalry.daysBeatLobbyMean, 1);
    assert.equal(rivalry.firstPlaceFinishes, 0);
    assert.equal(rivalry.rivalries[0].username, '.grissom');
    assert.equal(rivalry.rivalries[0].humanWins, 1);
    assert.equal(rivalry.rivalries[1].username, 'activity');
    assert.equal(rivalry.rivalries[1].llmWins, 1);

    const run = queries.getLlmDailyRun('2026-11-10');

    // Daytime /maptap daily embed shows score teaser WITHOUT leaking Taranto or monologue
    const liveDailyJson = JSON.stringify(
        embeds
            .createDailySummaryEmbed('2026-11-10', humanDayStats, [], {
                revealCities: false,
                llmRun: run,
                llmPlacement: placement,
            })
            .toJSON()
    );
    assert.ok(liveDailyJson.includes('980'));
    assert.ok(!liveDailyJson.includes('Taranto'));
    assert.ok(!liveDailyJson.includes('Salento instep'));

    // Midnight summary embed reveals monologue + attaches replay image
    const midnightJson = JSON.stringify(
        embeds
            .createDailySummaryEmbed('2026-11-10', humanDayStats, [], {
                revealCities: true,
                llmRun: run,
                llmPlacement: placement,
                replayAttachmentName: 'maptap-local-smart-2026-11-10.gif',
            })
            .toJSON()
    );
    assert.ok(midnightJson.includes('Salento instep'));
    assert.ok(midnightJson.includes('attachment://maptap-local-smart-2026-11-10.gif'));

    // /maptap llm date:<today> must trigger spoiler gate
    const todayIso = queries.getTodayDate('Europe/Amsterdam');
    let spoilerReply = null;
    await llmCmdMod.handleLlm({
        options: { getString: () => todayIso },
        reply: async payload => {
            spoilerReply = payload;
        },
    });
    assert.equal(spoilerReply?.ephemeral, true);
    assert.ok(JSON.stringify(spoilerReply).includes('Spoiler Gate Active'));

    // Browser child environment must strip DISCORD_TOKEN, SVPG_API_KEY, and DATABASE_PATH
    process.env.SVPG_API_KEY = 'secret-svpg-key-must-not-leak';
    const childEnv = llmPlayerMod.buildSanitizedBrowserEnv('Europe/Amsterdam', '/tmp/isolated-prof');
    assert.equal(childEnv.DISCORD_TOKEN, undefined);
    assert.equal(childEnv.SVPG_API_KEY, undefined);
    assert.equal(childEnv.DATABASE_PATH, undefined);
    assert.equal(childEnv.HOME, '/tmp/isolated-prof');
    assert.equal(childEnv.TZ, 'Europe/Amsterdam');
    delete process.env.SVPG_API_KEY;

    // Container sandbox namespace denial detector must match PR_SET_NO_NEW_PRIVS + Crashpad footer and reject non-container/other errors
    const noNewPrivsStderr =
        'The setuid sandbox is not running as root. Common causes:\n' +
        '  * A parent process set prctl(PR_SET_NO_NEW_PRIVS, ...)\n' +
        'Failed to move to new namespace: PID namespaces supported, Network namespace supported, but failed: errno = Operation not permitted\n' +
        '[14:14:1112/002415.213917:FATAL:content/browser/zygote_host/zygote_host_impl_linux.cc:228] Zygote process exited prematurely with exit code 1\n' +
        '[1112/002415.217919:ERROR:third_party/crashpad/crashpad/util/file/file_io_posix.cc:145] open /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq: No such file or directory (2)\n' +
        '[1112/002415.218010:ERROR:third_party/crashpad/crashpad/util/file/file_io_posix.cc:145] open /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq: No such file or directory (2)\n';
    assert.equal(llmPlayerMod.isContainerSandboxNamespaceDenial(noNewPrivsStderr, true), true);
    assert.equal(llmPlayerMod.isContainerSandboxNamespaceDenial(noNewPrivsStderr, false), false);
    assert.equal(llmPlayerMod.isContainerSandboxNamespaceDenial('SyntaxError: Unexpected token', true), false);

    // Distinct dates must not coalesce onto another date's in-flight promise
    const bogusChrome = path.join(tmpDir, 'nonexistent-chrome-bin');
    fs.writeFileSync(bogusChrome, '');
    const [resDayA, resDayB] = await Promise.all([
        llmPlayerMod.runLlmDailyChallenge('2026-11-08', {
            apiKey: 'dummy',
            chromePath: bogusChrome,
            forceReplay: true,
        }),
        llmPlayerMod.runLlmDailyChallenge('2026-11-09', {
            apiKey: 'dummy',
            chromePath: bogusChrome,
            forceReplay: true,
        }),
    ]);
    assert.equal(resDayA?.game_date, '2026-11-08');
    assert.equal(resDayB?.game_date, '2026-11-09');

    // Mid-launch shutdownLlmPlayer() must immediately abort and terminate a spawned child process
    const slowChromeScript = path.join(tmpDir, 'slow-chrome-stub.sh');
    const pidFile = path.join(tmpDir, 'slow-chrome.pid');
    fs.writeFileSync(
        slowChromeScript,
        `#!/bin/sh\necho $$ > "${pidFile}"\nsleep 30\n`,
        { mode: 0o755 }
    );
    const launchRunPromise = llmPlayerMod.runLlmDailyChallenge('2026-11-07', {
        apiKey: 'dummy',
        chromePath: slowChromeScript,
        forceReplay: true,
    });
    for (let i = 0; i < 40 && !fs.existsSync(pidFile); i++) {
        await new Promise(r => setTimeout(r, 25));
    }
    assert.ok(fs.existsSync(pidFile), 'Stub Chromium process should have spawned');
    const childPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    assert.ok(childPid > 0);

    const shutdownStart = Date.now();
    await llmPlayerMod.shutdownLlmPlayer();
    await launchRunPromise;
    assert.ok(Date.now() - shutdownStart < 2500, 'shutdownLlmPlayer must abort mid-launch promptly');

    let childStillAlive = true;
    try {
        process.kill(childPid, 0);
    } catch {
        childStillAlive = false;
    }
    assert.equal(childStillAlive, false, 'Spawned Chromium child must be terminated by shutdownLlmPlayer');
});

test.after(() => {
    try {
        dbMod.db.close();
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
