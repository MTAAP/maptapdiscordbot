import { Client } from 'discord.js';

export function handleReady(client: Client): void {
    console.log(`✅ Mappy is online! Logged in as ${client.user?.tag}`);
    console.log(`📊 Monitoring for MapTap scores...`);

    client.user?.setActivity('MapTap scores', { type: 3 }); // Type 3 = Watching
}
