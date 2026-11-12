import { EmbedBuilder } from 'discord.js';
import {
    parseLlmRoundDetails,
    type ChallengeRoundBreakdown,
    type DailyStats,
    type GeoLeaderboardResult,
    type LlmDailyRunRecord,
    type LlmDayLobbyPlacement,
    type LlmHeadToHeadSummary,
    type LlmRoundDetail,
    type RecordInfo,
    type UserPassport,
    type WeeklyStats,
    type WorldCrownsOverview,
} from '../database/queries';

export const DISCORD_EMBED_FIELD_LIMIT = 1024;

export function formatNumber(num: number): string {
    return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function formatAverage(num: number): string {
    return num.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function chunkEntriesForFields(
    entries: string[],
    options: {
        separator?: string;
        maxFieldLength?: number;
        maxFields?: number;
        maxTotalLength?: number;
        overflowLabel?: string;
    } = {}
): string[] {
    const separator = options.separator ?? '\n';
    const maxFieldLength = options.maxFieldLength ?? DISCORD_EMBED_FIELD_LIMIT;
    const maxFields = options.maxFields ?? 20;
    const maxTotalLength = options.maxTotalLength ?? 4800;
    const overflowLabel = options.overflowLabel ?? 'entry';

    const chunks: string[] = [];
    let current = '';
    let totalUsed = 0;
    let includedCount = 0;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i].slice(0, maxFieldLength - 40);
        const remainingEntries = entries.length - i;
        // Reserve 48 chars in case we must append "...and N more ..."
        const reserve = remainingEntries > 1 ? 48 : 0;
        const candidate = current ? `${current}${separator}${entry}` : entry;

        if (totalUsed - current.length + candidate.length + reserve > maxTotalLength) {
            break;
        }

        if (candidate.length <= maxFieldLength - reserve) {
            totalUsed += candidate.length - current.length;
            current = candidate;
            includedCount++;
            continue;
        }

        if (current) {
            chunks.push(current);
            current = '';
        }

        if (chunks.length >= maxFields - 1) {
            // Last allowed field: keep fitting entries until budget is reached
            if (totalUsed + entry.length + reserve > maxTotalLength || entry.length > maxFieldLength - reserve) {
                break;
            }
        }

        if (chunks.length >= maxFields) {
            break;
        }

        current = entry;
        totalUsed += entry.length;
        includedCount++;
    }

    if (current) {
        chunks.push(current);
    }

    const omitted = entries.length - includedCount;
    if (omitted > 0) {
        const suffix = `...and ${omitted} more ${overflowLabel}${omitted === 1 ? '' : 's'}`;
        if (chunks.length === 0) {
            chunks.push(suffix);
        } else {
            const lastIdx = chunks.length - 1;
            const combined = `${chunks[lastIdx]}${separator}${suffix}`;
            if (combined.length <= maxFieldLength) {
                chunks[lastIdx] = combined;
            } else if (chunks.length < maxFields) {
                chunks.push(suffix);
            }
        }
    }

    return chunks;
}

export function formatSignedDelta(delta: number): string {
    const sign = delta >= 0 ? '+' : '';
    return `${sign}${formatAverage(delta)}`;
}

function pickBestLlmMonologue(details: LlmRoundDetail[]): LlmRoundDetail | null {
    if (details.length === 0) return null;
    const withMono = details.filter(d => d.monologue && d.monologue.trim().length > 0);
    if (withMono.length === 0) return null;
    return [...withMono].sort(
        (a, b) => b.weightedPoints - a.weightedPoints || b.rawScore - a.rawScore
    )[0];
}

function buildSpoilerFreeLlmTeaser(
    llmRun: LlmDailyRunRecord,
    placement?: LlmDayLobbyPlacement | null
): string {
    const score = formatNumber(llmRun.total_score ?? 0);
    if (!placement || placement.humanCount === 0) {
        return `**${score}** pts (blind visual crosshair via \`${llmRun.model}\`) · No human scores posted yet. Replay & monologues unlock at midnight.`;
    }
    return `**${score}** pts (blind visual crosshair via \`${llmRun.model}\`) · Virtual Rank **#${placement.virtualRank}** of ${placement.humanCount + 1} (beat **${placement.humansBeaten}/${placement.humanCount}** humans so far, ${formatSignedDelta(placement.deltaVsLobby ?? 0)} vs lobby). Replay unlocks at midnight.`;
}

export function createDailySummaryEmbed(
    date: string,
    stats: DailyStats,
    records: RecordInfo[],
    options: {
        revealCities?: boolean;
        roundBreakdown?: ChallengeRoundBreakdown[];
        llmRun?: LlmDailyRunRecord | null;
        llmPlacement?: LlmDayLobbyPlacement | null;
        replayAttachmentName?: string;
    } = {}
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🗺️ MapTap Daily Summary')
        .setDescription(`**${formatDate(date)}**`)
        .setColor(0x5865F2)
        .setTimestamp();

    const completedLlm =
        options.llmRun?.status === 'completed' && options.llmRun.total_score !== null
            ? options.llmRun
            : null;

    if (stats.totalGames === 0) {
        embed.addFields({
            name: '📊 No Games Today',
            value: 'No MapTap scores were recorded today.',
        });
        if (completedLlm && !options.revealCities) {
            embed.addFields({
                name: '🤖 local-smart Benchmark',
                value: buildSpoilerFreeLlmTeaser(completedLlm, options.llmPlacement),
            });
        }
        return embed;
    }

    // Today's stats
    embed.addFields({
        name: "📊 Today's Stats",
        value: `• Players: **${stats.totalGames}**\n• Daily Average: **${formatAverage(stats.average)}** pts`,
    });

    // Optional post-midnight location reveal (suppressed during live day to avoid spoilers)
    if (options.revealCities && options.roundBreakdown && options.roundBreakdown.length > 0) {
        const weights = [1, 1, 2, 3, 3];
        const roundLines = options.roundBreakdown.map(r => {
            const w = weights[r.roundNum - 1] ?? 1;
            const statsPart =
                r.lobbyMean !== null && r.bestScore !== null
                    ? ` — μ **${formatAverage(r.lobbyMean)}** · Top: **${r.bestScore}** (${r.bestPlayers.join(', ')})`
                    : '';
            return `**R${r.roundNum}** (${w}×) ${r.flag} **${r.name}**${statsPart}`;
        });
        const chunks = chunkEntriesForFields(roundLines, {
            separator: '\n',
            maxFieldLength: DISCORD_EMBED_FIELD_LIMIT,
            maxFields: 2,
            maxTotalLength: 1000,
            overflowLabel: 'round',
        });
        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({
                name: i === 0 ? '🌍 Locations Played' : '\u200b',
                value: chunks[i],
            });
        }
    }

    // Top 3
    const medals = ['🥇', '🥈', '🥉'];
    const topScoresText = stats.topScores
        .map((s, i) => {
            const delta = s.score - stats.average;
            const deltaStr = delta >= 0 ? `(+${formatAverage(delta)})` : `(${formatAverage(delta)})`;
            return `${medals[i]} ${s.username} - **${formatNumber(s.score)}** pts ${deltaStr}`;
        })
        .join('\n');

    embed.addFields({
        name: '🏆 Top 3 Today',
        value: topScoresText || 'No scores yet',
    });

    // Worst player of the day
    if (stats.worstScore && stats.totalGames > 1) {
        const delta = stats.worstScore.score - stats.average;
        const deltaStr = `(${formatAverage(delta)})`;
        embed.addFields({
            name: '💩 Worst Today',
            value: `${stats.worstScore.username} - **${formatNumber(stats.worstScore.score)}** pts ${deltaStr}`,
        });
    }

    if (completedLlm) {
        if (!options.revealCities) {
            embed.addFields({
                name: '🤖 local-smart Benchmark',
                value: buildSpoilerFreeLlmTeaser(completedLlm, options.llmPlacement).slice(
                    0,
                    DISCORD_EMBED_FIELD_LIMIT
                ),
            });
        } else {
            const details = parseLlmRoundDetails(completedLlm);
            const placement = options.llmPlacement;
            const rankStr =
                placement && placement.humanCount > 0
                    ? `Virtual Rank **#${placement.virtualRank}** of ${placement.humanCount + 1} · Beat **${placement.humansBeaten}/${placement.humanCount}** humans (${formatSignedDelta(placement.deltaVsLobby ?? 0)} vs lobby)`
                    : 'Solo benchmark run';
            const roundsLine =
                details.length > 0
                    ? details
                          .map(d => `R${d.round}: **${d.rawScore}** (${Math.round(d.distanceKm)} km)`)
                          .join(' · ')
                    : '';
            const highlight = pickBestLlmMonologue(details);
            const monoLine = highlight
                ? `\n> *"${highlight.monologue.slice(0, 260)}"* (R${highlight.round} ${highlight.cityName})`
                : '';

            const showdownText =
                `**${formatNumber(completedLlm.total_score!)}** pts via \`${completedLlm.model}\` — ${rankStr}` +
                (roundsLine ? `\n${roundsLine}` : '') +
                monoLine;

            embed.addFields({
                name: '🤖 local-smart Showdown',
                value: showdownText.slice(0, DISCORD_EMBED_FIELD_LIMIT),
            });

            if (options.replayAttachmentName) {
                embed.setImage(`attachment://${options.replayAttachmentName}`);
            }
        }
    }

    // Records broken (chunked across <=1024-char fields)
    if (records.length > 0) {
        const recordEntries = records.map(r => {
            if (r.record_type === 'top_score') {
                const prevText = r.previous_value
                    ? `\n   Previous: ${formatNumber(r.previous_value)} by ${r.previous_holder_name}`
                    : '';
                return `⭐ **New All-Time High:** ${formatNumber(r.value)} by ${r.username}!${prevText}`;
            }
            return `📈 New ${r.record_type}: ${formatNumber(r.value)} by ${r.username}`;
        });

        const recordChunks = chunkEntriesForFields(recordEntries, {
            separator: '\n\n',
            maxFieldLength: DISCORD_EMBED_FIELD_LIMIT,
            maxFields: 10,
            maxTotalLength: 3200,
            overflowLabel: 'record',
        });

        for (let i = 0; i < recordChunks.length; i++) {
            embed.addFields({
                name: i === 0 ? '🆕 Records Broken!' : '\u200b',
                value: recordChunks[i],
            });
        }
    }

    embed.setFooter({ text: 'See full stats with /maptap leaderboard or /maptap llm' });

    return embed;
}

export function createLeaderboardEmbed(
    topByAverage: Array<{ user_id: string; username: string; average: number; games: number }>,
    topScores: Array<{ user_id: string; username: string; score: number; game_date: string; daily_average: number }>,
    topDeltas: Array<{ user_id: string; username: string; score: number; daily_average: number; delta: number; game_date: string }>
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🗺️ MapTap All-Time Leaderboard')
        .setColor(0xFFD700)
        .setTimestamp();

    // Top by average
    const medals = ['🥇', '🥈', '🥉'];
    if (topByAverage.length > 0) {
        const avgText = topByAverage
            .map((u, i) => `${medals[i]} ${u.username} - **${formatAverage(u.average)}** avg (${u.games} games)`)
            .join('\n');
        embed.addFields({
            name: '👑 Top 3 by Average Score',
            value: avgText,
        });
    }

    // All-time top scores
    if (topScores.length > 0) {
        const scoresText = topScores
            .map((s, i) => `${medals[i]} **${formatNumber(s.score)}** - ${s.username} (${formatDate(s.game_date)}) [Avg: ${formatAverage(s.daily_average)}]`)
            .join('\n');
        embed.addFields({
            name: '⭐ All-Time Top Scores',
            value: scoresText,
        });
    }

    // Biggest deltas
    if (topDeltas.length > 0) {
        const deltasText = topDeltas
            .map((d, i) => `${medals[i]} **+${formatAverage(d.delta)}** - ${d.username} (${formatDate(d.game_date)})`)
            .join('\n');
        embed.addFields({
            name: '📈 Biggest Deltas (Score vs Daily Avg)',
            value: deltasText,
        });
    }

    if (topByAverage.length === 0 && topScores.length === 0) {
        embed.setDescription('No scores recorded yet. Start playing MapTap!');
    }

    return embed;
}

export function createUserStatsEmbed(
    userId: string,
    username: string,
    stats: { totalGames: number; averageScore: number; bestScore: number; bestScoreDate: string }
): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle(`📊 Stats for ${username}`)
        .setColor(0x00D4AA)
        .addFields(
            { name: 'Games Played', value: `**${stats.totalGames}**`, inline: true },
            { name: 'Average Score', value: `**${formatAverage(stats.averageScore)}**`, inline: true },
            { name: 'Best Score', value: `**${formatNumber(stats.bestScore)}** (${formatDate(stats.bestScoreDate)})`, inline: true }
        )
        .setTimestamp();
}

function formatDate(dateStr: string): string {
    // Convert "2026-11-11" to "Nov 11"
    const date = new Date(dateStr + 'T12:00:00Z');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function createWeeklySummaryEmbed(stats: WeeklyStats): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('📅 MapTap Weekly Summary')
        .setDescription(`**${formatDate(stats.startDate)} - ${formatDate(stats.endDate)}**`)
        .setColor(0xE67E22)
        .setTimestamp();

    if (stats.totalGames === 0) {
        embed.addFields({
            name: '📊 No Games This Week',
            value: 'No MapTap scores were recorded this week.',
        });
        return embed;
    }

    // Week overview
    embed.addFields({
        name: '📊 Week Overview',
        value: `• Total Games: **${stats.totalGames}**\n• Players: **${stats.totalPlayers}**\n• Weekly Average: **${formatAverage(stats.overallAverage)}** pts`,
    });

    // Player rankings (chunked across <=1024-char fields within Discord's 6,000-char embed limit)
    const medals = ['🥇', '🥈', '🥉'];
    if (stats.playerStats.length > 0) {
        const rankingEntries = stats.playerStats.map((p, i) => {
            const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
            return `${prefix} ${p.username} - **${formatAverage(p.average)}** avg (${p.games} games)`;
        });

        const rankingChunks = chunkEntriesForFields(rankingEntries, {
            separator: '\n',
            maxFieldLength: DISCORD_EMBED_FIELD_LIMIT,
            maxFields: 18,
            maxTotalLength: 4800,
            overflowLabel: 'player',
        });

        for (let i = 0; i < rankingChunks.length; i++) {
            embed.addFields({
                name: i === 0 ? '🏆 Player Rankings' : '\u200b',
                value: rankingChunks[i],
            });
        }
    }

    // Best and worst scores of the week
    if (stats.bestScore) {
        embed.addFields({
            name: '⭐ Best Score This Week',
            value: `**${formatNumber(stats.bestScore.score)}** - ${stats.bestScore.username} (${formatDate(stats.bestScore.game_date)})`,
            inline: true,
        });
    }

    if (stats.worstScore && stats.totalPlayers > 1) {
        embed.addFields({
            name: '💩 Worst Score This Week',
            value: `**${formatNumber(stats.worstScore.score)}** - ${stats.worstScore.username} (${formatDate(stats.worstScore.game_date)})`,
            inline: true,
        });
    }

    embed.setFooter({ text: 'See full stats with /maptap leaderboard' });

    return embed;
}

export function createWorldCrownsEmbed(overview: WorldCrownsOverview): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🌍 MapTap World Crowns')
        .setDescription(
            overview.syncedDays > 0
                ? `Regional leaders across **${overview.syncedDays}** synced daily challenges. Use \`/maptap region area:<name>\` to drill into any continent, subregion, or country.`
                : 'No daily challenge locations synced yet.'
        )
        .setColor(0x2ecc71)
        .setTimestamp();

    if (overview.continents.length > 0) {
        const contLines = overview.continents.map(
            c =>
                `${c.icon} **${c.label}** (${c.challengeRounds} rds) — 👑 **${c.leaderUsername}** · **${formatAverage(c.leaderMeanAccuracy)}** acc (${formatSignedDelta(c.leaderMeanDelta)} vs lobby, ${c.leaderRounds} rds)`
        );
        const chunks = chunkEntriesForFields(contLines, {
            separator: '\n',
            maxFieldLength: DISCORD_EMBED_FIELD_LIMIT,
            maxFields: 3,
            maxTotalLength: 1800,
            overflowLabel: 'continent',
        });
        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({
                name: i === 0 ? '🌐 Continent Crowns' : '\u200b',
                value: chunks[i],
            });
        }
    }

    if (overview.subregions.length > 0) {
        const subLines = overview.subregions.map(
            s =>
                `• **${s.label}** (${s.challengeRounds} rds) — 👑 **${s.leaderUsername}** · **${formatAverage(s.leaderMeanAccuracy)}** (${formatSignedDelta(s.leaderMeanDelta)})`
        );
        const chunks = chunkEntriesForFields(subLines, {
            separator: '\n',
            maxFieldLength: DISCORD_EMBED_FIELD_LIMIT,
            maxFields: 6,
            maxTotalLength: 2600,
            overflowLabel: 'subregion',
        });
        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({
                name: i === 0 ? '🗺️ Subregion Crowns' : '\u200b',
                value: chunks[i],
            });
        }
    }

    embed.setFooter({ text: 'Try /maptap region area:Western Europe or /maptap passport' });
    return embed;
}

export function createGeoLeaderboardEmbed(result: GeoLeaderboardResult): EmbedBuilder {
    const kindBadge =
        result.area.kind === 'continent'
            ? 'Continent'
            : result.area.kind === 'subregion'
              ? 'Subregion'
              : 'Country';

    const embed = new EmbedBuilder()
        .setTitle(`${result.area.icon} ${result.area.label} — ${kindBadge} Standings`)
        .setColor(0x3498db)
        .setTimestamp();

    if (result.totalPlayerAttempts === 0 || result.standings.length === 0) {
        embed.setDescription(
            result.totalChallengeRounds === 0
                ? `No MapTap daily rounds in **${result.area.label}** have appeared in your server's history yet.`
                : `No players have reached **${result.effectiveMinRounds}** round(s) in **${result.area.label}** yet (${result.totalChallengeRounds} challenge round(s) recorded).`
        );
        return embed;
    }

    embed.setDescription(
        `**${result.totalChallengeRounds}** challenge round${result.totalChallengeRounds === 1 ? '' : 's'} · Lobby Mean: **${formatAverage(result.lobbyMeanAccuracy)}**/100 · Qualification: **${result.effectiveMinRounds}+** rounds`
    );

    const medals = ['🥇', '🥈', '🥉'];
    const lines = result.standings.map((p, i) => {
        const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
        const perf = p.perfectCount > 0 ? ` · 💯×${p.perfectCount}` : '';
        return `${prefix} **${p.username}** — **${formatAverage(p.meanAccuracy)}** acc (${formatSignedDelta(p.meanDelta)} vs lobby) · ${p.rounds} rds${perf}`;
    });

    const chunks = chunkEntriesForFields(lines, {
        separator: '\n',
        maxFieldLength: DISCORD_EMBED_FIELD_LIMIT,
        maxFields: 14,
        maxTotalLength: 4000,
        overflowLabel: 'player',
    });

    for (let i = 0; i < chunks.length; i++) {
        embed.addFields({
            name: i === 0 ? '🏆 Player Standings (0–100 Round Accuracy)' : '\u200b',
            value: chunks[i],
        });
    }

    const extremes: string[] = [];
    if (result.easiestLocation) {
        extremes.push(
            `🎯 **Easiest:** ${result.easiestLocation.flag} ${result.easiestLocation.name} (μ=${formatAverage(result.easiestLocation.mean)})`
        );
    }
    if (result.hardestLocation) {
        extremes.push(
            `🧭 **Toughest:** ${result.hardestLocation.flag} ${result.hardestLocation.name} (μ=${formatAverage(result.hardestLocation.mean)})`
        );
    }
    if (extremes.length > 0) {
        embed.addFields({
            name: '📍 Location Highlights',
            value: extremes.join('\n').slice(0, DISCORD_EMBED_FIELD_LIMIT),
        });
    }

    embed.setFooter({ text: 'Delta compares each round score against the server lobby on that exact city' });
    return embed;
}

export function createUserPassportEmbed(username: string, passport: UserPassport): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle(`🛂 Geography Passport — ${username}`)
        .setDescription(`Across **${formatNumber(passport.totalSyncedRounds)}** geo-tagged rounds`)
        .setColor(0x00d4aa)
        .setTimestamp();

    if (passport.continents.length > 0) {
        const contText = passport.continents
            .map(c => {
                const rankPart =
                    c.rank && c.qualifiedPlayers ? ` · **#${c.rank}**/${c.qualifiedPlayers}` : '';
                return `${c.icon} **${c.label}:** **${formatAverage(c.meanAccuracy)}** acc (${formatSignedDelta(c.meanDelta)} vs lobby, ${c.rounds} rds${rankPart})`;
            })
            .join('\n');
        embed.addFields({
            name: '🌐 Continents (Sorted by Lobby Edge)',
            value: contText.slice(0, DISCORD_EMBED_FIELD_LIMIT),
        });
    }

    if (passport.strongestSubregions.length > 0) {
        const strongText = passport.strongestSubregions
            .map(
                s =>
                    `💪 **${s.label}:** **${formatAverage(s.meanAccuracy)}** (${formatSignedDelta(s.meanDelta)} vs lobby, ${s.rounds} rds)`
            )
            .join('\n');
        embed.addFields({
            name: '🏔️ Strongest Subregions',
            value: strongText.slice(0, DISCORD_EMBED_FIELD_LIMIT),
            inline: true,
        });
    }

    if (passport.weakestSubregions.length > 0) {
        const weakText = passport.weakestSubregions
            .map(
                s =>
                    `🧭 **${s.label}:** **${formatAverage(s.meanAccuracy)}** (${formatSignedDelta(s.meanDelta)} vs lobby, ${s.rounds} rds)`
            )
            .join('\n');
        embed.addFields({
            name: '🕳️ Blind Spots',
            value: weakText.slice(0, DISCORD_EMBED_FIELD_LIMIT),
            inline: true,
        });
    }

    if (passport.topCountries.length > 0) {
        const countryText = passport.topCountries
            .map(
                c =>
                    `${c.icon} **${c.label}:** **${formatAverage(c.meanAccuracy)}** (${formatSignedDelta(c.meanDelta)}, ${c.rounds} rds)`
            )
            .join('\n');
        embed.addFields({
            name: '🏳️ Best Countries',
            value: countryText.slice(0, DISCORD_EMBED_FIELD_LIMIT),
        });
    }

    embed.setFooter({ text: 'Compare whole regions with /maptap region' });
    return embed;
}

export function createLlmRivalryEmbed(
    summary: LlmHeadToHeadSummary,
    todayRun: LlmDailyRunRecord | null,
    todayPlacement: LlmDayLobbyPlacement | null,
    configured: boolean
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🤖 Humans vs. local-smart — Daily Rivalry')
        .setColor(0x9b59b6)
        .setTimestamp();

    if (summary.completedRuns === 0 && !todayRun) {
        embed.setDescription(
            configured
                ? 'No completed `local-smart` daily runs recorded yet. The first blind visual run is scheduled shortly after midnight.'
                : '`local-smart` daily challenger is not configured yet (`SVPG_API_KEY` not set).'
        );
        return embed;
    }

    if (summary.completedRuns > 0) {
        embed.addFields(
            {
                name: 'Games Played',
                value: `**${summary.completedRuns}**`,
                inline: true,
            },
            {
                name: 'Mean Score',
                value: `**${formatAverage(summary.meanScore)}**`,
                inline: true,
            },
            {
                name: 'Best Score',
                value: `**${formatNumber(summary.bestScore)}**${summary.bestScoreDate ? ` (${formatDate(summary.bestScoreDate)})` : ''}`,
                inline: true,
            },
            {
                name: 'Beat Lobby Avg',
                value:
                    summary.daysWithHumans > 0
                        ? `**${summary.daysBeatLobbyMean}/${summary.daysWithHumans}** days`
                        : '—',
                inline: true,
            },
            {
                name: '#1 Overall Finishes',
                value:
                    summary.daysWithHumans > 0
                        ? `**${summary.firstPlaceFinishes}/${summary.daysWithHumans}** days`
                        : '—',
                inline: true,
            },
            {
                name: 'Worst Score',
                value: `**${formatNumber(summary.worstScore)}**${summary.worstScoreDate ? ` (${formatDate(summary.worstScoreDate)})` : ''}`,
                inline: true,
            }
        );
    }

    if (todayRun) {
        if (todayRun.status === 'completed' && todayRun.total_score !== null) {
            embed.addFields({
                name: "🕵️ Today's Benchmark (Spoiler-Locked Until Midnight)",
                value: buildSpoilerFreeLlmTeaser(todayRun, todayPlacement).slice(
                    0,
                    DISCORD_EMBED_FIELD_LIMIT
                ),
            });
        } else if (todayRun.status === 'running') {
            embed.addFields({
                name: "⏳ Today's Run",
                value: '`local-smart` is currently playing today\'s 5-round globe challenge in headless Chromium...',
            });
        }
    }

    if (summary.rivalries.length > 0) {
        const medals = ['🥇', '🥈', '🥉'];
        const lines = summary.rivalries.map((r, i) => {
            const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
            const tieStr = r.ties > 0 ? `-${r.ties}T` : '';
            return `${prefix} **${r.username}** — **${r.humanWins}W-${r.llmWins}L${tieStr}** (${formatSignedDelta(r.meanMarginVsLlm)} pts/day, ${r.sharedDays}d)`;
        });
        const chunks = chunkEntriesForFields(lines, {
            separator: '\n',
            maxFieldLength: DISCORD_EMBED_FIELD_LIMIT,
            maxFields: 6,
            maxTotalLength: 2800,
            overflowLabel: 'player',
        });
        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({
                name: i === 0 ? '⚔️ Human vs. local-smart Head-to-Head' : '\u200b',
                value: chunks[i],
            });
        }
    }

    embed.setFooter({ text: 'Inspect any completed past day + replay GIF with /maptap llm date:YYYY-MM-DD' });
    return embed;
}

export function createLlmDayRevealEmbed(
    date: string,
    run: LlmDailyRunRecord,
    placement: LlmDayLobbyPlacement | null,
    roundBreakdown: ChallengeRoundBreakdown[],
    replayAttachmentName?: string
): EmbedBuilder {
    const details = parseLlmRoundDetails(run);
    const breakdownMap = new Map(roundBreakdown.map(r => [r.roundNum, r]));

    const placementLine =
        placement && placement.humanCount > 0
            ? `Virtual Rank **#${placement.virtualRank}** of ${placement.humanCount + 1} · Beat **${placement.humansBeaten}/${placement.humanCount}** humans (${formatSignedDelta(placement.deltaVsLobby ?? 0)} vs lobby)`
            : 'No human scores recorded for this date';

    const embed = new EmbedBuilder()
        .setTitle(`🤖 local-smart Replay — ${formatDate(date)}`)
        .setDescription(
            `**Final Score: ${formatNumber(run.total_score ?? 0)} / 1,000** (Raw **${run.raw_score ?? 0}**/500 · ${run.total_steps ?? 0} visual steps)\n${placementLine}`
        )
        .setColor(0x9b59b6)
        .setTimestamp();

    if (details.length > 0) {
        const roundLines = details.map(d => {
            const br = breakdownMap.get(d.round);
            const flag = br?.flag ?? '📍';
            const lobbyPart =
                br?.lobbyMean !== null && br?.lobbyMean !== undefined
                    ? ` · Lobby μ **${formatAverage(br.lobbyMean)}**`
                    : '';
            const mono = d.monologue ? `\n> *"${d.monologue.slice(0, 145)}"*` : '';
            return `**R${d.round}** (${d.multiplier}×) ${flag} **${d.cityName}** — **${d.rawScore}**/100 (${Math.round(d.distanceKm)} km, ${d.stepCount} steps, conf ${d.confidence}%)${lobbyPart}${mono}`;
        });

        const chunks = chunkEntriesForFields(roundLines, {
            separator: '\n\n',
            maxFieldLength: DISCORD_EMBED_FIELD_LIMIT,
            maxFields: 5,
            maxTotalLength: 3500,
            overflowLabel: 'round',
        });

        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({
                name: i === 0 ? '🧭 Round-by-Round Blind Crosshair Log' : '\u200b',
                value: chunks[i],
            });
        }
    }

    if (replayAttachmentName) {
        embed.setImage(`attachment://${replayAttachmentName}`);
    }

    embed.setFooter({ text: `Model: ${run.model} · Mode: ${run.mode} (zero coordinate access)` });
    return embed;
}
