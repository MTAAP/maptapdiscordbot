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
    worstScore: { user_id: string; username: string; score: number } | null;
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
        return { average: 0, totalGames: 0, topScores: [], worstScore: null };
    }

    const total = scores.reduce((sum, s) => sum + s.score, 0);
    const average = total / scores.length;

    // Get the worst score (last in the array since it's sorted DESC)
    const worst = scores[scores.length - 1];

    return {
        average,
        totalGames: scores.length,
        topScores: scores.slice(0, 3).map(s => ({
            user_id: s.user_id,
            username: s.username,
            score: s.score,
        })),
        worstScore: {
            user_id: worst.user_id,
            username: worst.username,
            score: worst.score,
        },
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

// Enhanced statistics

export interface EnhancedStats {
    totalGames: number;
    totalPlayers: number;
    mean: number;
    median: number;
    stdDev: number;
    min: number;
    max: number;
}

export interface RoundStats {
    round: number;
    mean: number;
    median: number;
    stdDev: number;
    bestScore: number;
    bestPlayers: Array<{ username: string; score: number; game_date: string }>;
}

export function getAllScores(): Score[] {
    const stmt = db.prepare('SELECT * FROM scores ORDER BY score DESC');
    return stmt.all() as Score[];
}

export function getEnhancedStats(): EnhancedStats {
    const scores = getAllScores();

    if (scores.length === 0) {
        return { totalGames: 0, totalPlayers: 0, mean: 0, median: 0, stdDev: 0, min: 0, max: 0 };
    }

    const values = scores.map(s => s.score);
    const uniquePlayers = new Set(scores.map(s => s.user_id)).size;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return {
        totalGames: scores.length,
        totalPlayers: uniquePlayers,
        mean,
        median,
        stdDev,
        min: sorted[0],
        max: sorted[sorted.length - 1],
    };
}

export function getRoundStats(): RoundStats[] {
    const scores = getAllScores();
    const roundStats: RoundStats[] = [];

    for (let round = 0; round < 5; round++) {
        const roundScores: Array<{ score: number; username: string; game_date: string }> = [];

        for (const s of scores) {
            if (!s.round_scores) continue;
            try {
                const rounds = JSON.parse(s.round_scores) as number[];
                if (rounds[round] !== undefined) {
                    roundScores.push({ score: rounds[round], username: s.username, game_date: s.game_date });
                }
            } catch {
                continue;
            }
        }

        if (roundScores.length === 0) {
            roundStats.push({
                round: round + 1,
                mean: 0,
                median: 0,
                stdDev: 0,
                bestScore: 0,
                bestPlayers: [],
            });
            continue;
        }

        const values = roundScores.map(r => r.score);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const sorted = [...values].sort((a, b) => a - b);
        const median = sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)];
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

        const bestScore = Math.max(...values);
        const bestPlayers = roundScores
            .filter(r => r.score === bestScore)
            .slice(0, 3)
            .map(r => ({ username: r.username, score: r.score, game_date: r.game_date }));

        roundStats.push({
            round: round + 1,
            mean,
            median,
            stdDev,
            bestScore,
            bestPlayers,
        });
    }

    return roundStats;
}

export function getUserEnhancedStats(userId: string): (EnhancedStats & { roundAverages: number[] }) | null {
    const stmt = db.prepare('SELECT * FROM scores WHERE user_id = ? ORDER BY score DESC');
    const scores = stmt.all(userId) as Score[];

    if (scores.length === 0) {
        return null;
    }

    const values = scores.map(s => s.score);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Calculate round averages
    const roundTotals = [0, 0, 0, 0, 0];
    const roundCounts = [0, 0, 0, 0, 0];

    for (const s of scores) {
        if (!s.round_scores) continue;
        try {
            const rounds = JSON.parse(s.round_scores) as number[];
            for (let i = 0; i < 5; i++) {
                if (rounds[i] !== undefined) {
                    roundTotals[i] += rounds[i];
                    roundCounts[i]++;
                }
            }
        } catch {
            continue;
        }
    }

    const roundAverages = roundTotals.map((total, i) => roundCounts[i] > 0 ? total / roundCounts[i] : 0);

    return {
        totalGames: scores.length,
        totalPlayers: 1,
        mean,
        median,
        stdDev,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        roundAverages,
    };
}
