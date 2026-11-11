import { Client, Collection, Message, TextChannel } from 'discord.js';
import { config } from '../config';
import { checkpointDatabase } from '../database';
import {
    ensureBaselineTopRecord,
    getMetaValue,
    getScoreCount,
    insertScoresBatch,
    ScoreBatchInput,
    setMetaValue,
} from '../database/queries';
import { normalizeGameDate, parseMapTapMessage } from './scoreParser';

export const DEFAULT_IMPORT_CUTOFF_MS = Date.UTC(2024, 0, 1);
const INITIAL_BACKFILL_META_KEY = 'initial_backfill_complete';

let activeImport = false;
let initialBackfillRunning = false;

export class ChannelImportBusyError extends Error {
    constructor() {
        super('A channel history import is already in progress.');
        this.name = 'ChannelImportBusyError';
    }
}

export function isImportInProgress(): boolean {
    return activeImport;
}

export function isInitialBackfillRunning(): boolean {
    return initialBackfillRunning;
}

export function areRecordAnnouncementsReady(): boolean {
    return !initialBackfillRunning && getMetaValue(INITIAL_BACKFILL_META_KEY) === '1';
}

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
    if (activeImport) {
        throw new ChannelImportBusyError();
    }
    activeImport = true;

    try {
        const channel = await client.channels.fetch(config.discord.channelId);
        if (!channel || !(channel instanceof TextChannel)) {
            throw new Error(`Configured channel ${config.discord.channelId} not found or not a text channel`);
        }

        const cutoffMs = options.stopBeforeTimestampMs ?? DEFAULT_IMPORT_CUTOFF_MS;
        let imported = 0;
        let skipped = 0;
        let totalProcessed = 0;
        let lastProgressReportedAt = 0;
        let lastMessageId: string | undefined;

        while (true) {
            const fetchOptions: { limit: number; before?: string; cache: boolean } = {
                limit: 100,
                cache: false,
            };
            if (lastMessageId) {
                fetchOptions.before = lastMessageId;
            }

            const messages: Collection<string, Message> = await channel.messages.fetch(fetchOptions);
            if (messages.size === 0) {
                break;
            }

            let reachedCutoff = false;
            const pageRows: ScoreBatchInput[] = [];

            for (const message of messages.values()) {
                if (message.createdTimestamp < cutoffMs) {
                    reachedCutoff = true;
                    break;
                }

                totalProcessed++;
                if (message.author.bot) continue;

                const parsed = parseMapTapMessage(message.content);
                if (!parsed) continue;

                const normalizedDate = normalizeGameDate(parsed.gameDate, config.timezone, message.createdAt);
                if (!normalizedDate) continue;

                pageRows.push({
                    userId: message.author.id,
                    username: message.author.username,
                    score: parsed.finalScore,
                    roundScores: parsed.roundScores,
                    gameDate: normalizedDate,
                    messageId: message.id,
                });
            }

            if (pageRows.length > 0) {
                const batchResult = insertScoresBatch(pageRows);
                imported += batchResult.imported;
                skipped += batchResult.skipped;
            }

            if (reachedCutoff) {
                break;
            }

            lastMessageId = messages.last()?.id;

            if (options.onProgress && totalProcessed - lastProgressReportedAt >= 500) {
                lastProgressReportedAt = totalProcessed;
                await options.onProgress({ totalProcessed, imported, skipped });
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (cutoffMs <= DEFAULT_IMPORT_CUTOFF_MS) {
            setMetaValue(INITIAL_BACKFILL_META_KEY, '1');
        }
        ensureBaselineTopRecord();
        checkpointDatabase();

        return { totalProcessed, imported, skipped };
    } finally {
        activeImport = false;
    }
}

export async function backfillIfDatabaseEmpty(client: Client): Promise<void> {
    const existingCount = getScoreCount();
    const completedFlag = getMetaValue(INITIAL_BACKFILL_META_KEY);
    if (completedFlag === '1' && existingCount > 0) {
        ensureBaselineTopRecord();
        console.log(`Initial backfill already marked complete (${existingCount} score(s)); skipping.`);
        return;
    }

    console.log(
        existingCount === 0
            ? 'Database is empty; starting initial channel backfill from Discord history...'
            : `Database has ${existingCount} score(s) without completion marker; verifying channel backfill...`
    );

    initialBackfillRunning = true;
    try {
        const result = await importChannelHistory(client, {
            stopBeforeTimestampMs: DEFAULT_IMPORT_CUTOFF_MS,
            onProgress: ({ totalProcessed, imported }) => {
                console.log(`Backfill progress: scanned=${totalProcessed} imported=${imported}`);
            },
        });
        setMetaValue(INITIAL_BACKFILL_META_KEY, '1');
        checkpointDatabase();
        console.log(
            `Initial channel backfill complete: scanned=${result.totalProcessed} imported=${result.imported} skipped=${result.skipped}`
        );
    } catch (error) {
        console.error('Initial channel backfill failed:', error);
    } finally {
        initialBackfillRunning = false;
    }
}
