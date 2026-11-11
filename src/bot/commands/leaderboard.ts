import { ChatInputCommandInteraction } from 'discord.js';
import { getTopUsersByAverage, getAllTimeTopScores, getBiggestDeltas } from '../../database/queries';
import { createLeaderboardEmbed } from '../../utils/embeds';

export async function handleLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
    const topByAverage = getTopUsersByAverage(3);
    const topScores = getAllTimeTopScores(3);
    const topDeltas = getBiggestDeltas(3);

    const embed = createLeaderboardEmbed(topByAverage, topScores, topDeltas);
    await interaction.reply({ embeds: [embed] });
}
