import { EmbedBuilder } from 'discord.js';
import type { DailyStats, RecordInfo, WeeklyStats } from '../database/queries';

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

export function createDailySummaryEmbed(
    date: string,
    stats: DailyStats,
    records: RecordInfo[]
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🗺️ MapTap Daily Summary')
        .setDescription(`**${formatDate(date)}**`)
        .setColor(0x5865F2)
        .setTimestamp();

    if (stats.totalGames === 0) {
        embed.addFields({
            name: '📊 No Games Today',
            value: 'No MapTap scores were recorded today.',
        });
        return embed;
    }

    // Today's stats
    embed.addFields({
        name: "📊 Today's Stats",
        value: `• Players: **${stats.totalGames}**\n• Daily Average: **${formatAverage(stats.average)}** pts`,
    });

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
            maxFields: 15,
            maxTotalLength: 4200,
            overflowLabel: 'record',
        });

        for (let i = 0; i < recordChunks.length; i++) {
            embed.addFields({
                name: i === 0 ? '🆕 Records Broken!' : '\u200b',
                value: recordChunks[i],
            });
        }
    }

    embed.setFooter({ text: 'See full stats with /maptap leaderboard' });

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
