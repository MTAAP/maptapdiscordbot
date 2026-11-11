import { ChatInputCommandInteraction } from 'discord.js';
import { config } from '../../config';
import { getDailyStats, getRecordsForDate, getTodayDate } from '../../database/queries';
import { createDailySummaryEmbed } from '../../utils/embeds';

export async function handleDaily(interaction: ChatInputCommandInteraction): Promise<void> {
    const today = getTodayDate(config.timezone);
    const stats = getDailyStats(today);
    const records = getRecordsForDate(today);

    const embed = createDailySummaryEmbed(today, stats, records);
    await interaction.reply({ embeds: [embed] });
}
