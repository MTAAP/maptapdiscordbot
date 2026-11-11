import { ChatInputCommandInteraction } from 'discord.js';
import {
    ChannelImportBusyError,
    DEFAULT_IMPORT_CUTOFF_MS,
    importChannelHistory,
    isImportInProgress,
} from '../../services/channelImport';
import { syncMissingChallenges } from '../../services/challengeSync';

export async function handleImport(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: '❌ Only administrators can run this command.', ephemeral: true });
        return;
    }

    if (isImportInProgress()) {
        await interaction.reply({
            content: '⏳ A channel history import is already in progress. Please wait for it to finish.',
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply();
    await interaction.editReply('📥 Starting import... This may take a while.').catch(err => {
        console.warn('Failed to send initial import status edit:', err);
    });

    let latest = { totalProcessed: 0, imported: 0, skipped: 0 };
    try {
        latest = await importChannelHistory(interaction.client, {
            stopBeforeTimestampMs: DEFAULT_IMPORT_CUTOFF_MS,
            onProgress: async stats => {
                latest = stats;
                await interaction
                    .editReply(
                        `📥 Processing... ${stats.totalProcessed} messages scanned, ${stats.imported} scores imported`
                    )
                    .catch(err => {
                        console.warn('Failed to edit import progress reply:', err);
                    });
            },
        });

        const challengeSync = await syncMissingChallenges();

        await interaction
            .editReply(
                `✅ Import complete!\n` +
                    `• Messages scanned: **${latest.totalProcessed}**\n` +
                    `• Scores imported: **${latest.imported}**\n` +
                    `• Duplicates skipped: **${latest.skipped}**\n` +
                    `• Challenge days newly synced: **${challengeSync.synced}**`
            )
            .catch(err => {
                console.warn('Failed to edit final import reply:', err);
            });
    } catch (error) {
        const message =
            error instanceof ChannelImportBusyError
                ? '⏳ Another import started concurrently; skipping duplicate run.'
                : `⚠️ Import stopped due to an error.\n` +
                  `• Messages scanned: **${latest.totalProcessed}**\n` +
                  `• Scores imported: **${latest.imported}**\n` +
                  `• Duplicates skipped: **${latest.skipped}**`;

        if (!(error instanceof ChannelImportBusyError)) {
            console.error('Import error:', error);
        }

        await interaction.editReply(message).catch(replyErr => {
            console.warn('Failed to edit import error reply:', replyErr);
        });
    }
}
