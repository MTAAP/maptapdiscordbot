import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getEnhancedStats, getRoundStats } from '../../database/queries';
import { formatNumber, formatAverage } from '../../utils/embeds';

export async function handleFullStats(interaction: ChatInputCommandInteraction): Promise<void> {
    const stats = getEnhancedStats();
    const roundStats = getRoundStats();

    if (stats.totalGames === 0) {
        const embed = new EmbedBuilder()
            .setTitle('📊 MapTap Full Statistics')
            .setDescription('No scores recorded yet. Start playing MapTap!')
            .setColor(0x5865F2);
        await interaction.reply({ embeds: [embed] });
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('📊 MapTap Full Statistics')
        .setColor(0x5865F2)
        .setTimestamp();

    // Overall stats
    embed.addFields({
        name: '📈 Overall Statistics',
        value: [
            `• Total Games: **${formatNumber(stats.totalGames)}**`,
            `• Total Players: **${formatNumber(stats.totalPlayers)}**`,
            `• Mean: **${formatAverage(stats.mean)}**`,
            `• Median: **${formatAverage(stats.median)}**`,
            `• Std Dev: **${formatAverage(stats.stdDev)}**`,
            `• Range: **${formatNumber(stats.min)}** - **${formatNumber(stats.max)}**`,
        ].join('\n'),
    });

    // Round statistics
    const roundText = roundStats.map(r => {
        const bestPlayersText = r.bestPlayers.length > 0
            ? r.bestPlayers.map(p => p.username).join(', ')
            : 'N/A';
        return `**Round ${r.round}:** μ=${formatAverage(r.mean)} | Med=${formatAverage(r.median)} | σ=${formatAverage(r.stdDev)} | Best: ${r.bestScore} (${bestPlayersText})`;
    }).join('\n');

    embed.addFields({
        name: '🎯 Per-Round Statistics',
        value: roundText || 'No round data available',
    });

    await interaction.reply({ embeds: [embed] });
}
