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
]);

export async function handleInteraction(interaction: Interaction): Promise<void> {
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
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
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
        );

    return [maptapCommand.toJSON()];
}
