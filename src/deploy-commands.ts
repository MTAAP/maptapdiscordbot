import { REST, Routes } from 'discord.js';
import { config } from './config';
import { getCommandData } from './bot/commands';

export async function syncGuildCommands(): Promise<void> {
    const commands = getCommandData();
    const rest = new REST({ version: '10' }).setToken(config.discord.token);

    console.log(`Registering ${commands.length} guild command(s)...`);
    await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commands }
    );
    console.log('Guild commands registered.');
}

if (require.main === module) {
    syncGuildCommands().catch(error => {
        console.error('Failed to deploy commands:', error);
        process.exit(1);
    });
}
