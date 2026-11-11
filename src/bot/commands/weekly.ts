import { ChatInputCommandInteraction } from 'discord.js';
import { config } from '../../config';
import { getWeeklyStats } from '../../database/queries';
import { createWeeklySummaryEmbed } from '../../utils/embeds';
import { getCurrentWeekDateRange } from '../../utils/dates';

export { getCurrentWeekDateRange };

export async function handleWeekly(interaction: ChatInputCommandInteraction): Promise<void> {
    const { startDate, endDate } = getCurrentWeekDateRange(config.timezone);
    const stats = getWeeklyStats(startDate, endDate);

    const embed = createWeeklySummaryEmbed(stats);
    await interaction.reply({ embeds: [embed] });
}
