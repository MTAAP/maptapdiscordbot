import { EmbedBuilder } from 'discord.js';
import type { DailyStats, RecordInfo } from '../database/queries';

export function formatNumber(num: number): string {
    return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function formatAverage(num: number): string {
    return num.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function createDailySummaryEmbed(
    date: string,
    stats: DailyStats,
    records: RecordInfo[]
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle(`🗺️ MapTap Daily Summary`)
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
        name: '📊 Today\'s Stats',
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

    // Records broken
    if (records.length > 0) {
        const recordsText = records.map(r => {
            if (r.record_type === 'top_score') {
                const prevText = r.previous_value
                    ? `\n   Previous: ${formatNumber(r.previous_value)} by ${r.previous_holder_name}`
                    : '';
                return `⭐ **New All-Time High:** ${formatNumber(r.value)} by ${r.username}!${prevText}`;
            }
            return `📈 New ${r.record_type}: ${formatNumber(r.value)} by ${r.username}`;
        }).join('\n\n');

        embed.addFields({
            name: '🆕 Records Broken!',
            value: recordsText,
        });
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
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
