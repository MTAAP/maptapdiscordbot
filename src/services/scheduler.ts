import cron from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { config } from '../config';
import { getDailyStats, getRecordsForDate, getTodayDate } from '../database/queries';
import { createDailySummaryEmbed } from '../utils/embeds';

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
