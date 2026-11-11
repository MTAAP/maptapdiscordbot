import dotenv from 'dotenv';
dotenv.config();

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export const config = {
    discord: {
        token: requireEnv('DISCORD_TOKEN'),
        clientId: requireEnv('DISCORD_CLIENT_ID'),
        guildId: requireEnv('GUILD_ID'),
        channelId: requireEnv('CHANNEL_ID'),
        summaryChannelId: process.env.SUMMARY_CHANNEL_ID || requireEnv('CHANNEL_ID'),
    },
    timezone: process.env.TIMEZONE || 'Europe/Amsterdam',
    summaryHour: parseInt(process.env.SUMMARY_HOUR || '0', 10),
    database: {
        path: process.env.DATABASE_PATH || './maptap.db',
    },
};
