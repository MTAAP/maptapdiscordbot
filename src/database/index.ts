import fs from 'fs';
import path from 'path';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { config } from '../config';

fs.mkdirSync(path.dirname(path.resolve(config.database.path)), { recursive: true });

export const db: DatabaseType = new Database(config.database.path);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

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

        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_challenges (
            game_date TEXT NOT NULL,
            round_num INTEGER NOT NULL CHECK (round_num BETWEEN 1 AND 5),
            location_id TEXT,
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            country_code TEXT NOT NULL,
            country_name TEXT NOT NULL,
            continent TEXT NOT NULL,
            subregion TEXT NOT NULL,
            title TEXT,
            fetched_at TEXT NOT NULL,
            PRIMARY KEY (game_date, round_num)
        );

        CREATE INDEX IF NOT EXISTS idx_daily_challenges_country ON daily_challenges(country_code);
        CREATE INDEX IF NOT EXISTS idx_daily_challenges_continent ON daily_challenges(continent);
        CREATE INDEX IF NOT EXISTS idx_daily_challenges_subregion ON daily_challenges(subregion);

        CREATE TABLE IF NOT EXISTS llm_daily_runs (
            game_date TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            mode TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
            total_score INTEGER,
            raw_score INTEGER,
            round_scores TEXT,
            round_details TEXT,
            total_steps INTEGER,
            wall_clock_ms INTEGER,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            reasoning_tokens INTEGER,
            gif_path TEXT,
            error_message TEXT,
            started_at TEXT NOT NULL,
            completed_at TEXT
        );
    `);
}

export function checkpointDatabase(): void {
    db.pragma('wal_checkpoint(TRUNCATE)');
}
