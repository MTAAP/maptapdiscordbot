import cron from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { config } from '../config';
import { getDailyStats, getRecordsForDate, getWeeklyStats } from '../database/queries';
import { createDailySummaryEmbed, createWeeklySummaryEmbed } from '../utils/embeds';

export function startDailyScheduler(client: Client): void {
    // Schedule at configured hour in configured timezone
    // node-cron format: minute hour * * *
    const cronExpression = `0 ${config.summaryHour} * * *`;

    console.log(`📅 Daily summary scheduled for ${config.summaryHour}:00 ${config.timezone}`);

    cron.schedule(cronExpression, async () => {
        console.log('⏰ Running daily summary...');
        await postDailySummary(client);
    }, {
        timezone: config.timezone,
    });
}

export async function postDailySummary(client: Client): Promise<void> {
    try {
        const channel = await client.channels.fetch(config.discord.summaryChannelId);
        if (!channel || !(channel instanceof TextChannel)) {
            console.error('❌ Summary channel not found or not a text channel');
            return;
        }

        // Get yesterday's date since we're posting at midnight
        const yesterday = getYesterdayDate(config.timezone);
        const stats = getDailyStats(yesterday);
        const records = getRecordsForDate(yesterday);

        // Only post if there were games played
        if (stats.totalGames === 0) {
            console.log('📊 No games played yesterday, skipping summary');
            return;
        }

        const embed = createDailySummaryEmbed(yesterday, stats, records);
        await channel.send({ embeds: [embed] });
        console.log('✅ Daily summary posted');
    } catch (error) {
        console.error('❌ Failed to post daily summary:', error);
    }
}

function getYesterdayDate(timezone: string): string {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    return now.toLocaleDateString('en-CA', { timeZone: timezone });
}

export function startWeeklyScheduler(client: Client): void {
    // Schedule for Sunday at configured hour (after daily summary)
    // node-cron format: minute hour * * day (0 = Sunday)
    const cronExpression = `5 ${config.summaryHour} * * 0`;

    console.log(`📅 Weekly summary scheduled for Sundays at ${config.summaryHour}:05 ${config.timezone}`);

    cron.schedule(cronExpression, async () => {
        console.log('⏰ Running weekly summary...');
        await postWeeklySummary(client);
    }, {
        timezone: config.timezone,
    });
}

export async function postWeeklySummary(client: Client): Promise<void> {
    try {
        const channel = await client.channels.fetch(config.discord.summaryChannelId);
        if (!channel || !(channel instanceof TextChannel)) {
            console.error('❌ Summary channel not found or not a text channel');
            return;
        }

        // Get the last 7 days (Monday to Sunday of the past week)
        const { startDate, endDate } = getLastWeekDateRange(config.timezone);
        const stats = getWeeklyStats(startDate, endDate);

        // Only post if there were games played
        if (stats.totalGames === 0) {
            console.log('📊 No games played last week, skipping summary');
            return;
        }

        const embed = createWeeklySummaryEmbed(stats);
        await channel.send({ embeds: [embed] });
        console.log('✅ Weekly summary posted');
    } catch (error) {
        console.error('❌ Failed to post weekly summary:', error);
    }
}

function getLastWeekDateRange(timezone: string): { startDate: string; endDate: string } {
    // Get yesterday (Saturday if running on Sunday)
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    // Find the Monday of that week (go back to start of week)
    const dayOfWeek = yesterday.getDay(); // 0 = Sunday, 1 = Monday, ...
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const monday = new Date(yesterday);
    monday.setDate(monday.getDate() - daysToMonday);

    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    return {
        startDate: monday.toLocaleDateString('en-CA', { timeZone: timezone }),
        endDate: sunday.toLocaleDateString('en-CA', { timeZone: timezone }),
    };
}
