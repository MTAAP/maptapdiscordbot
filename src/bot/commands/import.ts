import { ChatInputCommandInteraction, TextChannel, Message, Collection } from 'discord.js';
import { config } from '../../config';
import { parseMapTapMessage, normalizeGameDate } from '../../services/scoreParser';
import { insertScore } from '../../database/queries';

export async function handleImport(interaction: ChatInputCommandInteraction): Promise<void> {
    // Only allow server admins to run this
    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: '❌ Only administrators can run this command.', ephemeral: true });
        return;
    }

    await interaction.deferReply();

    const channel = await interaction.client.channels.fetch(config.discord.channelId);
    if (!channel || !(channel instanceof TextChannel)) {
        await interaction.editReply('❌ Could not find the configured channel.');
        return;
    }

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let lastMessageId: string | undefined;
    let totalProcessed = 0;

    await interaction.editReply('📥 Starting import... This may take a while.');

    try {
        // Fetch messages in batches of 100 (Discord API limit)
        while (true) {
            const options: { limit: number; before?: string } = { limit: 100 };
            if (lastMessageId) {
                options.before = lastMessageId;
            }

            const messages: Collection<string, Message> = await channel.messages.fetch(options);

            if (messages.size === 0) {
                break;
            }

            for (const message of messages.values()) {
                totalProcessed++;

                // Skip bot messages
                if (message.author.bot) continue;

                // Try to parse as MapTap score
                const parsed = parseMapTapMessage(message.content);
                if (!parsed) continue;

                const normalizedDate = normalizeGameDate(parsed.gameDate, config.timezone);

                // Insert the score
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

            lastMessageId = messages.last()?.id;

            // Update progress every 500 messages
            if (totalProcessed % 500 === 0) {
                await interaction.editReply(`📥 Processing... ${totalProcessed} messages scanned, ${imported} scores imported`);
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        await interaction.editReply(
            `✅ Import complete!\n` +
            `• Messages scanned: **${totalProcessed}**\n` +
            `• Scores imported: **${imported}**\n` +
            `• Duplicates skipped: **${skipped}**`
        );
    } catch (error) {
        console.error('Import error:', error);
        await interaction.editReply(
            `⚠️ Import stopped due to an error.\n` +
            `• Messages scanned: **${totalProcessed}**\n` +
            `• Scores imported: **${imported}**\n` +
            `• Duplicates skipped: **${skipped}**`
        );
    }
}
