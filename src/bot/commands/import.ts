import { ChatInputCommandInteraction } from 'discord.js';
import { importChannelHistory } from '../../services/channelImport';

export async function handleImport(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: '❌ Only administrators can run this command.', ephemeral: true });
        return;
    }

    await interaction.deferReply();
    await interaction.editReply('📥 Starting import... This may take a while.');

    let latest = { totalProcessed: 0, imported: 0, skipped: 0 };
    try {
        latest = await importChannelHistory(interaction.client, {
            onProgress: async stats => {
                latest = stats;
                await interaction.editReply(
                    `📥 Processing... ${stats.totalProcessed} messages scanned, ${stats.imported} scores imported`
                );
            },
        });

        await interaction.editReply(
            `✅ Import complete!\n` +
            `• Messages scanned: **${latest.totalProcessed}**\n` +
            `• Scores imported: **${latest.imported}**\n` +
            `• Duplicates skipped: **${latest.skipped}**`
        );
    } catch (error) {
        console.error('Import error:', error);
        await interaction.editReply(
            `⚠️ Import stopped due to an error.\n` +
            `• Messages scanned: **${latest.totalProcessed}**\n` +
            `• Scores imported: **${latest.imported}**\n` +
            `• Duplicates skipped: **${latest.skipped}**`
        );
    }
}
