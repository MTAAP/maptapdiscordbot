import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getUserStats } from '../../database/queries';
import { createUserStatsEmbed } from '../../utils/embeds';

export async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const stats = getUserStats(targetUser.id);

    if (!stats) {
        const embed = new EmbedBuilder()
            .setTitle(`📊 Stats for ${targetUser.username}`)
            .setDescription('No MapTap scores recorded yet.')
            .setColor(0x808080);
        await interaction.reply({ embeds: [embed] });
        return;
    }

    const embed = createUserStatsEmbed(targetUser.id, targetUser.username, stats);
    await interaction.reply({ embeds: [embed] });
}
