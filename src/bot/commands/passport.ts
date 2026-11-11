import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getChallengeCoverage, getUserPassport } from '../../database/queries';
import { syncMissingChallenges } from '../../services/challengeSync';
import { createUserPassportEmbed } from '../../utils/embeds';

export async function handlePassport(interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    const coverage = getChallengeCoverage();
    if (coverage.syncedDays === 0 && coverage.scoredDays > 0) {
        await interaction.deferReply();
        await syncMissingChallenges();
    }

    const passport = getUserPassport(targetUser.id);

    const sendEmbed = async (embed: EmbedBuilder): Promise<void> => {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.reply({ embeds: [embed] });
        }
    };

    if (!passport) {
        const emptyEmbed = new EmbedBuilder()
            .setTitle(`🛂 Geography Passport — ${targetUser.username}`)
            .setDescription('No geo-tagged MapTap rounds recorded yet for this player.')
            .setColor(0x808080);
        await sendEmbed(emptyEmbed);
        return;
    }

    await sendEmbed(createUserPassportEmbed(targetUser.username, passport));
}
