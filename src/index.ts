import fs from 'fs';
import { db, initializeDatabase } from './database';
import { startBot } from './bot/client';
import { syncGuildCommands } from './deploy-commands';
import { backfillIfDatabaseEmpty } from './services/channelImport';
import { startDailyScheduler, startWeeklyScheduler } from './services/scheduler';

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
        await new Promise<void>(resolve => client.once('ready', () => resolve()));
    }

    writeHeartbeat();
    const heartbeatTimer = setInterval(() => {
        if (client.isReady()) {
            writeHeartbeat();
        }
    }, 30_000);
    heartbeatTimer.unref();

    startDailyScheduler(client);
    startWeeklyScheduler(client);

    void backfillIfDatabaseEmpty(client);

    const shutdown = () => {
        console.log('Shutting down Mappy...');
        clearInterval(heartbeatTimer);
        client.destroy();
        db.close();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
