import { initializeDatabase } from './database';
import { startBot } from './bot/client';
import { startDailyScheduler, startWeeklyScheduler } from './services/scheduler';

async function main(): Promise<void> {
    console.log('🗺️  Starting Mappy - MapTap Score Tracker');
    console.log('=========================================');

    // Initialize database
    console.log('📦 Initializing database...');
    initializeDatabase();

    // Start the bot
    console.log('🤖 Connecting to Discord...');
    const client = await startBot();

    // Start the schedulers
    startDailyScheduler(client);
    startWeeklyScheduler(client);

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down Mappy...');
        client.destroy();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n👋 Shutting down Mappy...');
        client.destroy();
        process.exit(0);
    });
}

main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
