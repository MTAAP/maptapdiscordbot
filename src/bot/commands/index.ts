import {
    Interaction,
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { handleDaily } from './daily';
import { handleLeaderboard } from './leaderboard';
import { handleStats } from './stats';
import { handleRecords } from './records';
import { handleDelta } from './delta';
import { handleImport } from './import';
import { handleFullStats } from './fullstats';
import { handleWorst } from './worst';
import { handleAllPlayers } from './allplayers';
import { handleWeekly } from './weekly';
import { handleRegion, handleRegionAutocomplete } from './region';
import { handlePassport } from './passport';
import { handleLlm } from './llm';

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

const commands: Map<string, CommandHandler> = new Map([
    ['daily', handleDaily],
    ['leaderboard', handleLeaderboard],
    ['stats', handleStats],
    ['records', handleRecords],
    ['delta', handleDelta],
    ['import', handleImport],
    ['fullstats', handleFullStats],
    ['worst', handleWorst],
    ['allplayers', handleAllPlayers],
    ['weekly', handleWeekly],
    ['region', handleRegion],
    ['passport', handlePassport],
    ['llm', handleLlm],
]);

export async function handleInteraction(interaction: Interaction): Promise<void> {
    if (typeof interaction.isAutocomplete === 'function' && interaction.isAutocomplete()) {
        if (interaction.commandName !== 'maptap') return;
        if (interaction.options.getSubcommand(false) === 'region') {
            await handleRegionAutocomplete(interaction).catch(err => {
                console.warn('Region autocomplete failed:', err);
            });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    // All maptap commands are subcommands of /maptap
    if (interaction.commandName !== 'maptap') return;

    const subcommand = interaction.options.getSubcommand();
    const handler = commands.get(subcommand);

    if (handler) {
        try {
            await handler(interaction);
        } catch (error) {
            console.error(`Error handling /${interaction.commandName} ${subcommand}:`, error);
            const reply = {
                content: 'An error occurred while processing this command.',
                ephemeral: true,
            };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply).catch(replyErr => {
                    console.warn('Failed to send error followUp:', replyErr);
                });
            } else {
                await interaction.reply(reply).catch(replyErr => {
                    console.warn('Failed to send error reply:', replyErr);
                });
            }
        }
    }
}

export function getCommandData(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    const maptapCommand = new SlashCommandBuilder()
        .setName('maptap')
        .setDescription('MapTap score tracking commands')
        .addSubcommand(sub =>
            sub.setName('daily')
                .setDescription('Show today\'s MapTap statistics')
        )
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('Show the all-time leaderboard')
        )
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('Show stats for a user')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('The user to show stats for (defaults to you)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('records')
                .setDescription('Show all-time top scores')
        )
        .addSubcommand(sub =>
            sub.setName('delta')
                .setDescription('Show biggest deltas (score vs daily average)')
        )
        .addSubcommand(sub =>
            sub.setName('import')
                .setDescription('Import historical scores from channel (admin only)')
        )
        .addSubcommand(sub =>
            sub.setName('fullstats')
                .setDescription('Show full statistics with mean, median, std dev, and per-round stats')
        )
        .addSubcommand(sub =>
            sub.setName('worst')
                .setDescription('Show the worst scores ever recorded')
        )
        .addSubcommand(sub =>
            sub.setName('allplayers')
                .setDescription('Show all players ranked by average score')
        )
        .addSubcommand(sub =>
            sub.setName('weekly')
                .setDescription('Show current week\'s progress and standings')
        )
        .addSubcommand(sub =>
            sub.setName('region')
                .setDescription('Show standings by continent, subregion (e.g. Western Europe), or country')
                .addStringOption(opt =>
                    opt.setName('area')
                        .setDescription('Continent, subregion, or country (leave blank for World Crowns)')
                        .setRequired(false)
                        .setAutocomplete(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('min_rounds')
                        .setDescription('Minimum rounds in area to qualify')
                        .setMinValue(1)
                        .setMaxValue(100)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('passport')
                .setDescription('Show a player\'s strongest regions, blind spots, and top countries')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('The user to inspect (defaults to you)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('llm')
                .setDescription('Compare players against local-smart or view a past day\'s visual replay')
                .addStringOption(opt =>
                    opt.setName('date')
                        .setDescription('Date in YYYY-MM-DD (today: spoiler-free rounds; past: full replay & GIF)')
                        .setRequired(false)
                )
        );

    return [maptapCommand.toJSON()];
}
