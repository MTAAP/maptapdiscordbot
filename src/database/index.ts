import Database, { Database as DatabaseType } from 'better-sqlite3';
import { config } from '../config';

export const db: DatabaseType = new Database(config.database.path);

db.pragma('journal_mode = WAL');

export function initializeDatabase(): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            score INTEGER NOT NULL,
            round_scores TEXT,
            game_date TEXT NOT NULL,
            message_id TEXT UNIQUE NOT NULL,
            recorded_at TEXT NOT NULL,
            UNIQUE(user_id, game_date)
        );

        CREATE INDEX IF NOT EXISTS idx_scores_game_date ON scores(game_date);
        CREATE INDEX IF NOT EXISTS idx_scores_user_id ON scores(user_id);
        CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);

        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            record_type TEXT NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            value INTEGER NOT NULL,
            previous_value INTEGER,
            previous_holder_id TEXT,
            previous_holder_name TEXT,
            game_date TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
    `);
}
