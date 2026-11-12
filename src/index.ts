import fs from 'fs';
import { Events } from 'discord.js';
import { checkpointDatabase, db, initializeDatabase } from './database';
import { startBot } from './bot/client';
import { syncGuildCommands } from './deploy-commands';
import { backfillIfDatabaseEmpty } from './services/channelImport';
import { syncMissingChallenges } from './services/challengeSync';
import { shutdownLlmPlayer } from './services/llmPlayer';
import {
    startDailyScheduler,
    startLlmPlayerScheduler,
    startWeeklyScheduler,
} from './services/scheduler';

const HEARTBEAT_FILE = '/tmp/mappy-heartbeat';

function writeHeartbeat(): void {
    fs.writeFileSync(HEARTBEAT_FILE, String(Date.now()));
}

async function main(): Promise<void> {
    console.log('Starting Mappy - MapTap Score Tracker');

    initializeDatabase();
    await syncGuildCommands();

    const client = await startBot();
    if (!client.isReady()) {
        await new Promise<void>(resolve => client.once(Events.ClientReady, () => resolve()));
    }

    writeHeartbeat();
    const heartbeatTimer = setInterval(() => {
        if (client.isReady()) {
            writeHeartbeat();
        }
    }, 30_000);
    heartbeatTimer.unref();

    await backfillIfDatabaseEmpty(client);
    const challengeSync = await syncMissingChallenges();
    if (challengeSync.attempted > 0) {
        console.log(
            `Daily challenge sync complete: synced=${challengeSync.synced}/${challengeSync.attempted} day(s)`
        );
    }

    startDailyScheduler(client);
    startWeeklyScheduler(client);
    startLlmPlayerScheduler();

    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log('Shutting down Mappy...');
        clearInterval(heartbeatTimer);
        client.destroy();
        await shutdownLlmPlayer().catch(error => {
            console.warn('LLM player shutdown cleanup failed:', error);
        });
        try {
            checkpointDatabase();
        } catch (error) {
            console.warn('WAL checkpoint on shutdown failed:', error);
        }
        db.close();
        process.exit(0);
    };

    process.on('SIGINT', () => {
        void shutdown();
    });
    process.on('SIGTERM', () => {
        void shutdown();
    });
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
