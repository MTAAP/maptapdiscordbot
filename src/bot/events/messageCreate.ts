import { Message, TextChannel } from 'discord.js';
import { config } from '../../config';
import { parseMapTapMessage, normalizeGameDate } from '../../services/scoreParser';
import { insertScore, getCurrentTopScore, insertRecord } from '../../database/queries';
import { areRecordAnnouncementsReady } from '../../services/channelImport';

export async function handleMessage(message: Message): Promise<void> {
    try {
        // Ignore bots
        if (message.author?.bot) return;

        // Only process messages in the configured channel
        if (message.channelId !== config.discord.channelId) return;

        // Try to parse as MapTap score
        const parsed = parseMapTapMessage(message.content ?? '');
        if (!parsed) return;

        const normalizedDate = normalizeGameDate(parsed.gameDate, config.timezone, message.createdAt);
        if (!normalizedDate) return;

        // Check current record before inserting
        const currentRecord = getCurrentTopScore();

        // Insert the score
        const inserted = insertScore(
            message.author.id,
            message.author.username,
            parsed.finalScore,
            parsed.roundScores,
            normalizedDate,
            message.id
        );

        if (!inserted) {
            // Score already exists (duplicate message or user already played today)
            return;
        }

        // Check if this is a new record (only after initial backfill has completed cleanly)
        if (areRecordAnnouncementsReady() && (!currentRecord || parsed.finalScore > currentRecord.score)) {
            insertRecord(
                'top_score',
                message.author.id,
                message.author.username,
                parsed.finalScore,
                currentRecord?.score ?? null,
                currentRecord?.user_id ?? null,
                currentRecord?.username ?? null,
                normalizedDate
            );

            // Announce new record with restricted mentions so usernames cannot trigger @everyone or role pings
            const channel = message.channel as TextChannel;
            const previousText = currentRecord
                ? ` (previous: ${currentRecord.score} by ${currentRecord.username})`
                : '';
            await channel
                .send({
                    content: `🎉 **NEW RECORD!** <@${message.author.id}> just set a new all-time high score of **${parsed.finalScore}** points!${previousText}`,
                    allowedMentions: { users: [message.author.id], parse: [] },
                })
                .catch(sendErr => {
                    console.error('Failed to send new record announcement:', sendErr);
                });
        }

        // React to acknowledge the score was recorded
        await message.react('✅').catch(reactErr => {
            console.warn('Failed to react to score message:', reactErr);
        });
    } catch (error) {
        console.error('Unhandled error in handleMessage:', error);
    }
}
