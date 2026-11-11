import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getUserEnhancedStats, getUserPassport } from '../../database/queries';
import { formatNumber, formatAverage, formatSignedDelta } from '../../utils/embeds';

export async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const stats = getUserEnhancedStats(targetUser.id);

    if (!stats) {
        const embed = new EmbedBuilder()
            .setTitle(`📊 Stats for ${targetUser.username}`)
            .setDescription('No MapTap scores recorded yet.')
            .setColor(0x808080);
        await interaction.reply({ embeds: [embed] });
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle(`📊 Stats for ${targetUser.username}`)
        .setColor(0x00D4AA)
        .addFields(
            { name: 'Games Played', value: `**${stats.totalGames}**`, inline: true },
            { name: 'Best Score', value: `**${formatNumber(stats.max)}**`, inline: true },
            { name: 'Worst Score', value: `**${formatNumber(stats.min)}**`, inline: true },
            { name: 'Mean', value: `**${formatAverage(stats.mean)}**`, inline: true },
            { name: 'Median', value: `**${formatAverage(stats.median)}**`, inline: true },
            { name: 'Std Dev', value: `**${formatAverage(stats.stdDev)}**`, inline: true },
        )
        .setTimestamp();

    // Add round averages if available
    if (stats.roundAverages.some(r => r > 0)) {
        const roundText = stats.roundAverages
            .map((avg, i) => `R${i + 1}: **${formatAverage(avg)}**`)
            .join(' | ');
        embed.addFields({
            name: '🎯 Round Averages',
            value: roundText,
        });
    }

    const passport = getUserPassport(targetUser.id);
    if (passport && passport.strongestSubregions.length > 0) {
        const best = passport.strongestSubregions[0];
        const worst = passport.weakestSubregions[0];
        const lines = [
            `💪 **Best:** ${best.label} — **${formatAverage(best.meanAccuracy)}** (${formatSignedDelta(best.meanDelta)} vs lobby, ${best.rounds} rds)`,
        ];
        if (worst && worst.label !== best.label) {
            lines.push(
                `🧭 **Blind Spot:** ${worst.label} — **${formatAverage(worst.meanAccuracy)}** (${formatSignedDelta(worst.meanDelta)} vs lobby, ${worst.rounds} rds)`
            );
        }
        embed.addFields({
            name: '🌍 Geography Snapshot (full: /maptap passport)',
            value: lines.join('\n'),
        });
    }

    await interaction.reply({ embeds: [embed] });
}
