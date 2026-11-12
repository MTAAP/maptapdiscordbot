import { AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import {
    getChallengeCoverage,
    getGeoAutocompleteChoices,
    getGeoLeaderboard,
    getWorldCrownsOverview,
    resolveGeoArea,
} from '../../database/queries';
import { syncMissingChallenges } from '../../services/challengeSync';
import { createGeoLeaderboardEmbed, createWorldCrownsEmbed } from '../../utils/embeds';

export async function handleRegionAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused();
    const choices = getGeoAutocompleteChoices(focused);
    await interaction.respond(choices).catch(() => {});
}

export async function handleRegion(interaction: ChatInputCommandInteraction): Promise<void> {
    const rawArea = interaction.options.getString('area')?.trim() ?? '';
    const requestedMinRounds = interaction.options.getInteger('min_rounds') ?? undefined;

    let coverage = getChallengeCoverage();
    if (coverage.syncedDays === 0 && coverage.scoredDays > 0) {
        await interaction.deferReply();
        await syncMissingChallenges();
        coverage = getChallengeCoverage();
    }

    const sendEmbed = async (embed: EmbedBuilder): Promise<void> => {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.reply({ embeds: [embed] });
        }
    };

    if (!rawArea) {
        const overview = getWorldCrownsOverview(requestedMinRounds);
        await sendEmbed(createWorldCrownsEmbed(overview));
        return;
    }

    const resolved = resolveGeoArea(rawArea);
    if (!resolved) {
        const notFoundEmbed = new EmbedBuilder()
            .setTitle('🌍 Unknown Region or Country')
            .setDescription(
                `Could not match **"${rawArea.slice(0, 80)}"**.\n\n` +
                    'Try a continent (`Europe`, `North America`, `Asia`), a UN subregion (`Western Europe`, `Northern America`, `East Asia`, `West Asia`), or any country (`Japan`, `Poland`, `US`).'
            )
            .setColor(0xe74c3c);
        await sendEmbed(notFoundEmbed);
        return;
    }

    const result = getGeoLeaderboard(resolved, requestedMinRounds);
    await sendEmbed(createGeoLeaderboardEmbed(result));
}
