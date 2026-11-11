import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from '../config';
import { handleReady } from './events/ready';
import { handleMessage } from './events/messageCreate';
import { handleInteraction } from './commands';

export function createClient(): Client {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Message],
    });

    client.once('ready', () => handleReady(client));
    client.on('messageCreate', handleMessage);
    client.on('interactionCreate', handleInteraction);

    return client;
}

export async function startBot(): Promise<Client> {
    const client = createClient();
    await client.login(config.discord.token);
    return client;
}
