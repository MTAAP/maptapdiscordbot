import { ChatInputCommandInteraction } from 'discord.js';
import { config } from '../../config';
import { getWeeklyStats } from '../../database/queries';
import { createWeeklySummaryEmbed } from '../../utils/embeds';

export async function handleWeekly(interaction: ChatInputCommandInteraction): Promise<void> {
    const { startDate, endDate } = getCurrentWeekDateRange(config.timezone);
    const stats = getWeeklyStats(startDate, endDate);

    const embed = createWeeklySummaryEmbed(stats);
    await interaction.reply({ embeds: [embed] });
}

function getCurrentWeekDateRange(timezone: string): { startDate: string; endDate: string } {
    const now = new Date();
    const today = new Date(now.toLocaleDateString('en-CA', { timeZone: timezone }));

    // Find the Monday of the current week
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ...
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const monday = new Date(today);
    monday.setDate(monday.getDate() - daysToMonday);

    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    return {
        startDate: monday.toLocaleDateString('en-CA', { timeZone: timezone }),
        endDate: sunday.toLocaleDateString('en-CA', { timeZone: timezone }),
    };
}
