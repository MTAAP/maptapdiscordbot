import fs from 'fs';
import cron from 'node-cron';
import { AttachmentBuilder, Client, TextChannel } from 'discord.js';
import { config } from '../config';
import {
    getDailyChallengeBreakdown,
    getDailyStats,
    getLlmDailyRun,
    getLlmDayPlacement,
    getRecordsForDate,
    getWeeklyStats,
} from '../database/queries';
import { ensureChallengeSyncedForDate, syncMissingChallenges } from './challengeSync';
import { isLlmPlayerConfigured, runLlmDailyChallenge } from './llmPlayer';
import { createDailySummaryEmbed, createWeeklySummaryEmbed } from '../utils/embeds';
import { getLastWeekDateRange, getTodayDate, getYesterdayDate } from '../utils/dates';

export { getLastWeekDateRange, getYesterdayDate };

export function startDailyScheduler(client: Client): void {
    // Schedule at configured hour in configured timezone
    // node-cron format: minute hour * * *
    const cronExpression = `0 ${config.summaryHour} * * *`;

    console.log(`Daily summary scheduled for ${config.summaryHour}:00 ${config.timezone}`);

    cron.schedule(cronExpression, async () => {
        console.log('Running daily summary...');
        await postDailySummary(client);
        // Pre-cache the newly started day's challenge locations quietly
        await ensureChallengeSyncedForDate(getTodayDate(config.timezone));
    }, {
        timezone: config.timezone,
    });
}

export function startLlmPlayerScheduler(): void {
    if (!isLlmPlayerConfigured()) {
        console.log('Daily LLM player disabled (SVPG_API_KEY or Chromium binary not configured)');
        return;
    }

    const padMin = String(config.llm.runDelayMinutes).padStart(2, '0');
    const cronExpression = `${config.llm.runDelayMinutes} ${config.summaryHour} * * *`;
    console.log(
        `Daily LLM player (${config.llm.model}, effort=${config.llm.reasoningEffort}) scheduled for ${config.summaryHour}:${padMin} ${config.timezone}`
    );

    cron.schedule(cronExpression, async () => {
        const today = getTodayDate(config.timezone);
        await ensureChallengeSyncedForDate(today);
        await runLlmDailyChallenge(today);
    }, {
        timezone: config.timezone,
    });

    if (process.env.MAPTAP_DISABLE_AUTO_LLM_RUN !== '1') {
        const timer = setTimeout(() => {
            const today = getTodayDate(config.timezone);
            const existing = getLlmDailyRun(today);
            if (!existing || existing.status !== 'completed') {
                runLlmDailyChallenge(today).catch(err => {
                    console.error('Startup LLM challenge catch-up failed:', err);
                });
            }
        }, 5_000);
        timer.unref();
    }
}

export async function postDailySummary(client: Client): Promise<void> {
    try {
        const channel = await client.channels.fetch(config.discord.summaryChannelId);
        if (!channel || !(channel instanceof TextChannel)) {
            console.error('Summary channel not found or not a text channel');
            return;
        }

        // Get yesterday's date since we're posting at midnight
        const yesterday = getYesterdayDate(config.timezone);
        const stats = getDailyStats(yesterday);
        const records = getRecordsForDate(yesterday);

        // Only post if there were games played
        if (stats.totalGames === 0) {
            console.log('No games played yesterday, skipping summary');
            return;
        }

        await ensureChallengeSyncedForDate(yesterday);
        const roundBreakdown = getDailyChallengeBreakdown(yesterday);
        const llmRun = getLlmDailyRun(yesterday);
        const llmPlacement = getLlmDayPlacement(yesterday);

        const hasReplayGif = Boolean(
            llmRun?.status === 'completed' && llmRun.gif_path && fs.existsSync(llmRun.gif_path)
        );
        const attachmentName = hasReplayGif ? `maptap-local-smart-${yesterday}.gif` : undefined;

        const embed = createDailySummaryEmbed(yesterday, stats, records, {
            revealCities: true,
            roundBreakdown,
            llmRun,
            llmPlacement,
            replayAttachmentName: attachmentName,
        });

        if (hasReplayGif && llmRun?.gif_path && attachmentName) {
            try {
                const file = new AttachmentBuilder(llmRun.gif_path, { name: attachmentName });
                await channel.send({ embeds: [embed], files: [file] });
                console.log('Daily summary posted with local-smart replay GIF');
                return;
            } catch (attachErr) {
                console.warn('Replay GIF upload failed; posting daily summary without attachment:', attachErr);
                const fallbackEmbed = createDailySummaryEmbed(yesterday, stats, records, {
                    revealCities: true,
                    roundBreakdown,
                    llmRun,
                    llmPlacement,
                });
                await channel.send({ embeds: [fallbackEmbed] });
                console.log('Daily summary posted (fallback without GIF)');
                return;
            }
        }

        await channel.send({ embeds: [embed] });
        console.log('Daily summary posted');
    } catch (error) {
        console.error('Failed to post daily summary:', error);
    }
}

export { syncMissingChallenges };

export function startWeeklyScheduler(client: Client): void {
    // Schedule for Monday at configured hour + 5 minutes so Sunday's games are included
    // node-cron format: minute hour * * day (1 = Monday)
    const cronExpression = `5 ${config.summaryHour} * * 1`;

    console.log(`Weekly summary scheduled for Mondays at ${config.summaryHour}:05 ${config.timezone}`);

    cron.schedule(cronExpression, async () => {
        console.log('Running weekly summary...');
        await postWeeklySummary(client);
    }, {
        timezone: config.timezone,
    });
}

export async function postWeeklySummary(client: Client): Promise<void> {
    try {
        const channel = await client.channels.fetch(config.discord.summaryChannelId);
        if (!channel || !(channel instanceof TextChannel)) {
            console.error('Summary channel not found or not a text channel');
            return;
        }

        // Get the completed Monday-to-Sunday week
        const { startDate, endDate } = getLastWeekDateRange(config.timezone);
        const stats = getWeeklyStats(startDate, endDate);

        // Only post if there were games played
        if (stats.totalGames === 0) {
            console.log('No games played last week, skipping summary');
            return;
        }

        const embed = createWeeklySummaryEmbed(stats);
        await channel.send({ embeds: [embed] });
        console.log('Weekly summary posted');
    } catch (error) {
        console.error('Failed to post weekly summary:', error);
    }
}
