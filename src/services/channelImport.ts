import { Client, Collection, Message, TextChannel } from 'discord.js';
import { config } from '../config';
import { getScoreCount, insertScore } from '../database/queries';
import { normalizeGameDate, parseMapTapMessage } from './scoreParser';

export interface ChannelImportResult {
    totalProcessed: number;
    imported: number;
    skipped: number;
}

export interface ChannelImportOptions {
    stopBeforeTimestampMs?: number;
    onProgress?: (stats: ChannelImportResult) => Promise<void> | void;
}

export async function importChannelHistory(
    client: Client,
    options: ChannelImportOptions = {}
): Promise<ChannelImportResult> {
    const channel = await client.channels.fetch(config.discord.channelId);
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Configured channel ${config.discord.channelId} not found or not a text channel`);
    }

    let imported = 0;
    let skipped = 0;
    let totalProcessed = 0;
    let lastMessageId: string | undefined;

    while (true) {
        const fetchOptions: { limit: number; before?: string } = { limit: 100 };
        if (lastMessageId) {
            fetchOptions.before = lastMessageId;
        }

        const messages: Collection<string, Message> = await channel.messages.fetch(fetchOptions);
        if (messages.size === 0) {
            break;
        }

        let reachedCutoff = false;
        for (const message of messages.values()) {
            if (
                options.stopBeforeTimestampMs !== undefined &&
                message.createdTimestamp < options.stopBeforeTimestampMs
            ) {
                reachedCutoff = true;
                break;
            }

            totalProcessed++;
            if (message.author.bot) continue;

            const parsed = parseMapTapMessage(message.content);
            if (!parsed) continue;

            const normalizedDate = normalizeGameDate(parsed.gameDate, config.timezone, message.createdAt);
            const wasInserted = insertScore(
                message.author.id,
                message.author.username,
                parsed.finalScore,
                parsed.roundScores,
                normalizedDate,
                message.id
            );

            if (wasInserted) {
                imported++;
            } else {
                skipped++;
            }
        }

        if (reachedCutoff) {
            break;
        }

        lastMessageId = messages.last()?.id;

        if (options.onProgress && totalProcessed > 0 && totalProcessed % 500 === 0) {
            await options.onProgress({ totalProcessed, imported, skipped });
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return { totalProcessed, imported, skipped };
}

export async function backfillIfDatabaseEmpty(client: Client): Promise<void> {
    const existingCount = getScoreCount();
    if (existingCount > 0) {
        console.log(`Database already has ${existingCount} score(s); skipping initial backfill.`);
        return;
    }

    // MapTap launched in 2025; stop scanning before 2024-01-01 UTC so multi-year channels finish boundedly.
    const cutoffMs = Date.UTC(2024, 0, 1);
    console.log('Database is empty; starting initial channel backfill from Discord history...');
    try {
        const result = await importChannelHistory(client, {
            stopBeforeTimestampMs: cutoffMs,
            onProgress: ({ totalProcessed, imported }) => {
                console.log(`Backfill progress: scanned=${totalProcessed} imported=${imported}`);
            },
        });
        console.log(
            `Initial channel backfill complete: scanned=${result.totalProcessed} imported=${result.imported} skipped=${result.skipped}`
        );
    } catch (error) {
        console.error('Initial channel backfill failed:', error);
    }
}
