import { REST, Routes } from 'discord.js';
import { config } from './config';
import { getCommandData } from './bot/commands';

async function deployCommands(): Promise<void> {
    const commands = getCommandData();
    const rest = new REST({ version: '10' }).setToken(config.discord.token);

    console.log(`🚀 Deploying ${commands.length} command(s)...`);

    try {
        await rest.put(
            Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
            { body: commands }
        );
        console.log('✅ Commands deployed successfully!');
    } catch (error) {
        console.error('❌ Failed to deploy commands:', error);
        process.exit(1);
    }
}

deployCommands();
