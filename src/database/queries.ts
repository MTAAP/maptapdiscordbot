import { db } from './index';

export interface Score {
    id: number;
    user_id: string;
    username: string;
    score: number;
    round_scores: string | null;
    game_date: string;
    message_id: string;
    recorded_at: string;
}

export interface DailyStats {
    average: number;
    totalGames: number;
    topScores: Array<{ user_id: string; username: string; score: number }>;
}

export interface UserStats {
    totalGames: number;
    averageScore: number;
    bestScore: number;
    bestScoreDate: string;
}

export interface RecordInfo {
    id: number;
    record_type: string;
    user_id: string;
    username: string;
    value: number;
    previous_value: number | null;
    previous_holder_id: string | null;
    previous_holder_name: string | null;
    game_date: string;
    created_at: string;
}

export function insertScore(
    userId: string,
    username: string,
    score: number,
    roundScores: number[],
    gameDate: string,
    messageId: string
): boolean {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO scores (user_id, username, score, round_scores, game_date, message_id, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        userId,
        username,
        score,
        JSON.stringify(roundScores),
        gameDate,
        messageId,
        new Date().toISOString()
    );
    return result.changes > 0;
}

export function getScoresForDate(date: string): Score[] {
    const stmt = db.prepare('SELECT * FROM scores WHERE game_date = ? ORDER BY score DESC');
    return stmt.all(date) as Score[];
}

export function getDailyStats(date: string): DailyStats {
    const scores = getScoresForDate(date);

    if (scores.length === 0) {
        return { average: 0, totalGames: 0, topScores: [] };
    }

    const total = scores.reduce((sum, s) => sum + s.score, 0);
    const average = total / scores.length;

    return {
        average,
        totalGames: scores.length,
        topScores: scores.slice(0, 3).map(s => ({
            user_id: s.user_id,
            username: s.username,
            score: s.score,
        })),
    };
}

export function getAllTimeTopScores(limit: number = 3): Array<Score & { daily_average: number }> {
    const stmt = db.prepare(`
        SELECT s.*,
            (SELECT AVG(score) FROM scores WHERE game_date = s.game_date) as daily_average
        FROM scores s
        ORDER BY s.score DESC
        LIMIT ?
    `);
    return stmt.all(limit) as Array<Score & { daily_average: number }>;
}

export function getTopUsersByAverage(limit: number = 3): Array<{ user_id: string; username: string; average: number; games: number }> {
    const stmt = db.prepare(`
        SELECT user_id, username, AVG(score) as average, COUNT(*) as games
        FROM scores
        GROUP BY user_id
        ORDER BY average DESC
        LIMIT ?
    `);
    return stmt.all(limit) as Array<{ user_id: string; username: string; average: number; games: number }>;
}

export function getBiggestDeltas(limit: number = 3): Array<{ user_id: string; username: string; score: number; daily_average: number; delta: number; game_date: string }> {
    const stmt = db.prepare(`
        SELECT
            s.user_id,
            s.username,
            s.score,
            s.game_date,
            (SELECT AVG(score) FROM scores WHERE game_date = s.game_date) as daily_average,
            s.score - (SELECT AVG(score) FROM scores WHERE game_date = s.game_date) as delta
        FROM scores s
        ORDER BY delta DESC
        LIMIT ?
    `);
    return stmt.all(limit) as Array<{ user_id: string; username: string; score: number; daily_average: number; delta: number; game_date: string }>;
}

export function getUserStats(userId: string): UserStats | null {
    const stmt = db.prepare(`
        SELECT
            COUNT(*) as totalGames,
            AVG(score) as averageScore,
            MAX(score) as bestScore,
            (SELECT game_date FROM scores WHERE user_id = ? ORDER BY score DESC LIMIT 1) as bestScoreDate
        FROM scores
        WHERE user_id = ?
    `);
    const result = stmt.get(userId, userId) as { totalGames: number; averageScore: number; bestScore: number; bestScoreDate: string } | undefined;

    if (!result || result.totalGames === 0) {
        return null;
    }

    return result;
}

export function getCurrentTopScore(): { score: number; user_id: string; username: string } | null {
    const stmt = db.prepare('SELECT score, user_id, username FROM scores ORDER BY score DESC LIMIT 1');
    return stmt.get() as { score: number; user_id: string; username: string } | null;
}

export function insertRecord(
    recordType: string,
    userId: string,
    username: string,
    value: number,
    previousValue: number | null,
    previousHolderId: string | null,
    previousHolderName: string | null,
    gameDate: string
): void {
    const stmt = db.prepare(`
        INSERT INTO records (record_type, user_id, username, value, previous_value, previous_holder_id, previous_holder_name, game_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(recordType, userId, username, value, previousValue, previousHolderId, previousHolderName, gameDate, new Date().toISOString());
}

export function getRecordsForDate(date: string): RecordInfo[] {
    const stmt = db.prepare('SELECT * FROM records WHERE game_date = ? ORDER BY created_at DESC');
    return stmt.all(date) as RecordInfo[];
}

export function getTodayDate(timezone: string): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}
