import dotenv from 'dotenv';
dotenv.config();

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function parseReasoningEffort(raw?: string): 'low' | 'medium' | 'xhigh' {
    if (raw === 'low' || raw === 'medium' || raw === 'xhigh') {
        return raw;
    }
    return 'low';
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
    llm: {
        apiKey: process.env.SVPG_API_KEY || '',
        baseUrl: (process.env.SVPG_BASE_URL || 'https://inference.svpg.dev/v1').replace(/\/+$/, ''),
        model: process.env.LLM_PLAYER_MODEL || 'local-smart',
        reasoningEffort: parseReasoningEffort(process.env.LLM_REASONING_EFFORT),
        runDelayMinutes: Math.max(1, Math.min(59, parseInt(process.env.LLM_RUN_DELAY_MINUTES || '5', 10) || 5)),
        chromePath: process.env.CHROME_PATH || '',
        maptapUrl: process.env.MAPTAP_PLAY_URL || 'https://maptap.gg/?letmeplay=1',
    },
};
