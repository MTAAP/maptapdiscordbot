import fs from 'fs';
import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
} from 'discord.js';
import { config } from '../../config';
import {
    getDailyChallengeBreakdown,
    getHumanRoundLobbyMeans,
    getLlmDailyRun,
    getLlmDayPlacement,
    getLlmVsHumansStats,
    getTodayDate,
} from '../../database/queries';
import { ensureChallengeSyncedForDate } from '../../services/challengeSync';
import { isLlmPlayerConfigured } from '../../services/llmPlayer';
import {
    createLlmDayRevealEmbed,
    createLlmRivalryEmbed,
    createLlmTodaySpoilerFreeEmbed,
} from '../../utils/embeds';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleLlm(interaction: ChatInputCommandInteraction): Promise<void> {
    const requestedDate = interaction.options.getString('date')?.trim() ?? '';
    const today = getTodayDate(config.timezone);

    if (!requestedDate) {
        const summary = getLlmVsHumansStats();
        const todayRun = getLlmDailyRun(today);
        const todayPlacement = getLlmDayPlacement(today);
        const todayLobbyRoundMeans = getHumanRoundLobbyMeans(today);
        const embed = createLlmRivalryEmbed(
            summary,
            todayRun,
            todayPlacement,
            isLlmPlayerConfigured(),
            todayLobbyRoundMeans
        );
        await interaction.reply({ embeds: [embed] });
        return;
    }

    if (!ISO_DATE_RE.test(requestedDate)) {
        const badDate = new EmbedBuilder()
            .setTitle('🤖 Invalid Date Format')
            .setDescription('Pass a date in `YYYY-MM-DD` format (for example `2026-11-11`), or leave `date` blank for the overall rivalry table.')
            .setColor(0xe74c3c);
        await interaction.reply({ embeds: [badDate], flags: MessageFlags.Ephemeral });
        return;
    }

    if (requestedDate > today) {
        const futureEmbed = new EmbedBuilder()
            .setTitle('🕵️ Future Date Locked')
            .setDescription(
                `No challenge run exists yet for **${requestedDate}** (${config.timezone}).`
            )
            .setColor(0xf39c12);
        await interaction.reply({ embeds: [futureEmbed], flags: MessageFlags.Ephemeral });
        return;
    }

    if (requestedDate === today) {
        const todayRun = getLlmDailyRun(today);
        if (todayRun?.status === 'running') {
            const runningEmbed = new EmbedBuilder()
                .setTitle(`⏳ Today's Run in Progress (${today})`)
                .setDescription(
                    '`local-smart` is currently playing today\'s 5-round globe challenge in headless Chromium. Try again in a few minutes.'
                )
                .setColor(0x9b59b6);
            await interaction.reply({ embeds: [runningEmbed] });
            return;
        }
        if (!todayRun || todayRun.status !== 'completed') {
            const missingToday = new EmbedBuilder()
                .setTitle(`🤖 No Completed Run for ${today}`)
                .setDescription(
                    todayRun?.status === 'failed'
                        ? `The \`local-smart\` run for **${today}** did not complete (${todayRun.error_message || 'unknown error'}).`
                        : `No \`local-smart\` challenge run is recorded yet for **${today}**.`
                )
                .setColor(0x808080);
            await interaction.reply({ embeds: [missingToday] });
            return;
        }

        const embed = createLlmTodaySpoilerFreeEmbed(
            today,
            todayRun,
            getLlmDayPlacement(today),
            getHumanRoundLobbyMeans(today),
            config.timezone
        );
        await interaction.reply({ embeds: [embed] });
        return;
    }

    const run = getLlmDailyRun(requestedDate);
    if (!run || run.status !== 'completed') {
        const missingEmbed = new EmbedBuilder()
            .setTitle(`🤖 No Completed Run for ${requestedDate}`)
            .setDescription(
                run?.status === 'failed'
                    ? `The \`local-smart\` run for **${requestedDate}** did not complete (${run.error_message || 'unknown error'}).`
                    : `No \`local-smart\` challenge run is recorded for **${requestedDate}**.`
            )
            .setColor(0x808080);
        await interaction.reply({ embeds: [missingEmbed] });
        return;
    }

    await interaction.deferReply();
    await ensureChallengeSyncedForDate(requestedDate);
    const breakdown = getDailyChallengeBreakdown(requestedDate);
    const placement = getLlmDayPlacement(requestedDate);

    const hasGif = Boolean(run.gif_path && fs.existsSync(run.gif_path));
    const attachmentName = hasGif ? `maptap-local-smart-${requestedDate}.gif` : undefined;
    const embed = createLlmDayRevealEmbed(
        requestedDate,
        run,
        placement,
        breakdown,
        attachmentName
    );

    if (hasGif && run.gif_path && attachmentName) {
        const attachment = new AttachmentBuilder(run.gif_path, { name: attachmentName });
        await interaction.editReply({ embeds: [embed], files: [attachment] });
        return;
    }

    await interaction.editReply({ embeds: [embed] });
}
