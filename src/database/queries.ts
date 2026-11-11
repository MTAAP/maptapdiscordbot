import { db } from './index';
import { config } from '../config';
import { getTodayDate } from '../utils/dates';
import { countryCodeToFlag, findCountryIsoByQuery, getCountryMetadata } from '../services/geography';

export { getTodayDate };

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

export interface ScoreBatchInput {
    userId: string;
    username: string;
    score: number;
    roundScores: number[];
    gameDate: string;
    messageId: string;
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

export function insertScoresBatch(rows: ScoreBatchInput[]): { imported: number; skipped: number } {
    if (rows.length === 0) {
        return { imported: 0, skipped: 0 };
    }
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO scores (user_id, username, score, round_scores, game_date, message_id, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const runBatch = db.transaction((items: ScoreBatchInput[]) => {
        let imported = 0;
        let skipped = 0;
        const nowIso = new Date().toISOString();
        for (const item of items) {
            const res = stmt.run(
                item.userId,
                item.username,
                item.score,
                JSON.stringify(item.roundScores),
                item.gameDate,
                item.messageId,
                nowIso
            );
            if (res.changes > 0) {
                imported++;
            } else {
                skipped++;
            }
        }
        return { imported, skipped };
    });

    return runBatch(rows);
}

export function getScoresForDate(date: string): Score[] {
    const stmt = db.prepare('SELECT * FROM scores WHERE game_date = ? ORDER BY score DESC');
    return stmt.all(date) as Score[];
}

export function getScoreCount(): number {
    const row = db.prepare('SELECT COUNT(*) as count FROM scores').get() as { count: number };
    return row.count;
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

export function ensureBaselineTopRecord(): boolean {
    const seedTx = db.transaction(() => {
        const topScore = db
            .prepare(
                'SELECT user_id, username, score, game_date FROM scores ORDER BY score DESC, game_date ASC, id ASC LIMIT 1'
            )
            .get() as { user_id: string; username: string; score: number; game_date: string } | undefined;

        if (!topScore) {
            return false;
        }

        const existingTopRecord = db
            .prepare(
                "SELECT value, user_id, username FROM records WHERE record_type = 'top_score' ORDER BY value DESC, id DESC LIMIT 1"
            )
            .get() as { value: number; user_id: string; username: string } | undefined;

        if (existingTopRecord && existingTopRecord.value >= topScore.score) {
            return false;
        }

        insertRecord(
            'top_score',
            topScore.user_id,
            topScore.username,
            topScore.score,
            existingTopRecord?.value ?? null,
            existingTopRecord?.user_id ?? null,
            existingTopRecord?.username ?? null,
            topScore.game_date
        );
        return true;
    });

    return seedTx();
}

export function getMetaValue(key: string): string | null {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
}

export function setMetaValue(key: string, value: string): void {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
        key,
        value
    );
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

// Weekly statistics

export interface WeeklyPlayerStats {
    user_id: string;
    username: string;
    games: number;
    totalScore: number;
    average: number;
    best: number;
    worst: number;
}

export interface WeeklyStats {
    startDate: string;
    endDate: string;
    totalGames: number;
    totalPlayers: number;
    overallAverage: number;
    playerStats: WeeklyPlayerStats[];
    bestScore: { username: string; score: number; game_date: string } | null;
    worstScore: { username: string; score: number; game_date: string } | null;
}

export function getWeeklyStats(startDate: string, endDate: string): WeeklyStats {
    const stmt = db.prepare(`
        SELECT * FROM scores
        WHERE game_date >= ? AND game_date <= ?
        ORDER BY score DESC
    `);
    const scores = stmt.all(startDate, endDate) as Score[];

    if (scores.length === 0) {
        return {
            startDate,
            endDate,
            totalGames: 0,
            totalPlayers: 0,
            overallAverage: 0,
            playerStats: [],
            bestScore: null,
            worstScore: null,
        };
    }

    // Calculate per-player stats
    const playerMap = new Map<string, { username: string; scores: number[] }>();
    for (const s of scores) {
        const existing = playerMap.get(s.user_id);
        if (existing) {
            existing.scores.push(s.score);
        } else {
            playerMap.set(s.user_id, { username: s.username, scores: [s.score] });
        }
    }

    const playerStats: WeeklyPlayerStats[] = [];
    for (const [user_id, data] of playerMap) {
        const total = data.scores.reduce((a, b) => a + b, 0);
        playerStats.push({
            user_id,
            username: data.username,
            games: data.scores.length,
            totalScore: total,
            average: total / data.scores.length,
            best: Math.max(...data.scores),
            worst: Math.min(...data.scores),
        });
    }

    // Sort by average score descending
    playerStats.sort((a, b) => b.average - a.average);

    const overallAverage = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
    const best = scores[0];
    const worst = scores[scores.length - 1];

    return {
        startDate,
        endDate,
        totalGames: scores.length,
        totalPlayers: playerStats.length,
        overallAverage,
        playerStats,
        bestScore: { username: best.username, score: best.score, game_date: best.game_date },
        worstScore: { username: worst.username, score: worst.score, game_date: worst.game_date },
    };
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

// ============================================================================
// Daily Challenges & Geographic Analytics
// ============================================================================

export interface DailyChallengeRound {
    game_date: string;
    round_num: number;
    location_id: string | null;
    name: string;
    lat: number;
    lng: number;
    country_code: string;
    country_name: string;
    continent: string;
    subregion: string;
    title: string | null;
    fetched_at: string;
}

export interface DailyChallengeRoundInput {
    gameDate: string;
    roundNum: number;
    locationId: string | null;
    name: string;
    lat: number;
    lng: number;
    countryCode: string;
    countryName: string;
    continent: string;
    subregion: string;
    title: string | null;
}

export interface ChallengeRoundBreakdown {
    roundNum: number;
    name: string;
    countryCode: string;
    countryName: string;
    flag: string;
    subregion: string;
    lobbyMean: number | null;
    bestScore: number | null;
    bestPlayers: string[];
}

export interface GeoAreaFilter {
    kind: 'continent' | 'subregion' | 'country';
    value: string;
    label: string;
    icon: string;
}

export interface GeoPlayerStanding {
    user_id: string;
    username: string;
    rounds: number;
    meanAccuracy: number;
    meanDelta: number;
    bestScore: number;
    perfectCount: number;
}

export interface GeoLeaderboardResult {
    area: GeoAreaFilter;
    totalChallengeRounds: number;
    totalPlayerAttempts: number;
    lobbyMeanAccuracy: number;
    effectiveMinRounds: number;
    easiestLocation: { name: string; flag: string; mean: number } | null;
    hardestLocation: { name: string; flag: string; mean: number } | null;
    standings: GeoPlayerStanding[];
}

export interface WorldCrownEntry {
    label: string;
    icon: string;
    challengeRounds: number;
    leaderUsername: string;
    leaderMeanAccuracy: number;
    leaderMeanDelta: number;
    leaderRounds: number;
}

export interface WorldCrownsOverview {
    syncedDays: number;
    scoredDays: number;
    continents: WorldCrownEntry[];
    subregions: WorldCrownEntry[];
}

export interface UserPassportEntry {
    label: string;
    icon: string;
    rounds: number;
    meanAccuracy: number;
    meanDelta: number;
    rank?: number;
    qualifiedPlayers?: number;
}

export interface UserPassport {
    totalSyncedRounds: number;
    continents: UserPassportEntry[];
    strongestSubregions: UserPassportEntry[];
    weakestSubregions: UserPassportEntry[];
    topCountries: UserPassportEntry[];
}

const CONTINENT_ICONS: Record<string, string> = {
    Europe: '🇪🇺',
    'North America': '🌎',
    'South America': '🌎',
    Asia: '🌏',
    Africa: '🌍',
    Oceania: '🏝️',
    Antarctica: '🧊',
    'International Waters': '🌊',
};

const KNOWN_CONTINENTS = [
    'Europe',
    'North America',
    'South America',
    'Asia',
    'Africa',
    'Oceania',
    'Antarctica',
    'International Waters',
];

const KNOWN_SUBREGIONS = [
    'Western Europe',
    'Northern Europe',
    'Southern Europe',
    'Eastern Europe',
    'Northern America',
    'Central America',
    'Caribbean',
    'South America',
    'East Asia',
    'Southeast Asia',
    'South Asia',
    'West Asia',
    'Central Asia',
    'North Africa',
    'West Africa',
    'East Africa',
    'Central Africa',
    'Southern Africa',
    'Australia and New Zealand',
    'Melanesia',
    'Micronesia',
    'Polynesia',
    'Antarctica',
    'International Waters',
];

const AREA_ALIASES: Record<string, { kind: 'continent' | 'subregion'; value: string }> = {
    eu: { kind: 'continent', value: 'Europe' },
    na: { kind: 'continent', value: 'North America' },
    sa: { kind: 'continent', value: 'South America' },
    af: { kind: 'continent', value: 'Africa' },
    as: { kind: 'continent', value: 'Asia' },
    oc: { kind: 'continent', value: 'Oceania' },
    'middle east': { kind: 'subregion', value: 'West Asia' },
    anz: { kind: 'subregion', value: 'Australia and New Zealand' },
    australasia: { kind: 'subregion', value: 'Australia and New Zealand' },
    nordics: { kind: 'subregion', value: 'Northern Europe' },
    latam: { kind: 'continent', value: 'South America' },
};

export function upsertDailyChallengeRounds(rounds: DailyChallengeRoundInput[]): void {
    if (rounds.length === 0 || !db.open) return;
    const stmt = db.prepare(`
        INSERT INTO daily_challenges (
            game_date, round_num, location_id, name, lat, lng,
            country_code, country_name, continent, subregion, title, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_date, round_num) DO UPDATE SET
            location_id = excluded.location_id,
            name = excluded.name,
            lat = excluded.lat,
            lng = excluded.lng,
            country_code = excluded.country_code,
            country_name = excluded.country_name,
            continent = excluded.continent,
            subregion = excluded.subregion,
            title = excluded.title,
            fetched_at = excluded.fetched_at
    `);

    const tx = db.transaction((items: DailyChallengeRoundInput[]) => {
        const nowIso = new Date().toISOString();
        for (const r of items) {
            stmt.run(
                r.gameDate,
                r.roundNum,
                r.locationId,
                r.name,
                r.lat,
                r.lng,
                r.countryCode,
                r.countryName,
                r.continent,
                r.subregion,
                r.title,
                nowIso
            );
        }
    });

    tx(rounds);
}

export function hasChallengeForDate(date: string): boolean {
    const row = db
        .prepare('SELECT COUNT(*) as c FROM daily_challenges WHERE game_date = ?')
        .get(date) as { c: number };
    return row.c >= 5;
}

export function getChallengeForDate(date: string): DailyChallengeRound[] {
    return db
        .prepare('SELECT * FROM daily_challenges WHERE game_date = ? ORDER BY round_num ASC')
        .all(date) as DailyChallengeRound[];
}

export function getMissingChallengeDates(): string[] {
    const rows = db
        .prepare(`
            SELECT DISTINCT s.game_date
            FROM scores s
            LEFT JOIN (
                SELECT game_date, COUNT(*) as round_count
                FROM daily_challenges
                GROUP BY game_date
            ) dc ON dc.game_date = s.game_date
            WHERE dc.round_count IS NULL OR dc.round_count < 5
            ORDER BY s.game_date ASC
        `)
        .all() as Array<{ game_date: string }>;
    return rows.map(r => r.game_date);
}

export function getChallengeCoverage(): { syncedDays: number; scoredDays: number } {
    const todayCutoff = getTodayDate(config.timezone);
    const syncedRow = db
        .prepare('SELECT COUNT(DISTINCT game_date) as c FROM daily_challenges WHERE game_date < ?')
        .get(todayCutoff) as { c: number };
    const scoredRow = db
        .prepare('SELECT COUNT(DISTINCT game_date) as c FROM scores WHERE game_date < ?')
        .get(todayCutoff) as { c: number };
    return { syncedDays: syncedRow.c, scoredDays: scoredRow.c };
}

export function getDailyChallengeBreakdown(date: string): ChallengeRoundBreakdown[] {
    const challengeRounds = getChallengeForDate(date);
    if (challengeRounds.length === 0) return [];

    const scores = getScoresForDate(date);
    const parsedByRound: Array<Array<{ username: string; score: number }>> = [[], [], [], [], []];

    for (const s of scores) {
        if (!s.round_scores) continue;
        try {
            const arr = JSON.parse(s.round_scores) as number[];
            for (let i = 0; i < 5; i++) {
                if (typeof arr[i] === 'number' && Number.isFinite(arr[i])) {
                    parsedByRound[i].push({ username: s.username, score: arr[i] });
                }
            }
        } catch {
            continue;
        }
    }

    return challengeRounds.map(cr => {
        const attempts = parsedByRound[cr.round_num - 1] ?? [];
        if (attempts.length === 0) {
            return {
                roundNum: cr.round_num,
                name: cr.name,
                countryCode: cr.country_code,
                countryName: cr.country_name,
                flag: countryCodeToFlag(cr.country_code),
                subregion: cr.subregion,
                lobbyMean: null,
                bestScore: null,
                bestPlayers: [],
            };
        }
        const lobbyMean = attempts.reduce((acc, a) => acc + a.score, 0) / attempts.length;
        const bestScore = Math.max(...attempts.map(a => a.score));
        const bestPlayers = attempts
            .filter(a => a.score === bestScore)
            .slice(0, 3)
            .map(a => a.username);

        return {
            roundNum: cr.round_num,
            name: cr.name,
            countryCode: cr.country_code,
            countryName: cr.country_name,
            flag: countryCodeToFlag(cr.country_code),
            subregion: cr.subregion,
            lobbyMean,
            bestScore,
            bestPlayers,
        };
    });
}

interface JoinedRoundAttempt {
    userId: string;
    username: string;
    gameDate: string;
    roundNum: number;
    accuracy: number;
    delta: number;
    locationName: string;
    countryCode: string;
    countryName: string;
    continent: string;
    subregion: string;
}

function loadJoinedRoundAttempts(): {
    attempts: JoinedRoundAttempt[];
    challenges: DailyChallengeRound[];
} {
    const todayCutoff = getTodayDate(config.timezone);
    const challenges = db
        .prepare('SELECT * FROM daily_challenges WHERE game_date < ? ORDER BY game_date ASC, round_num ASC')
        .all(todayCutoff) as DailyChallengeRound[];

    if (challenges.length === 0) {
        return { attempts: [], challenges: [] };
    }

    const challengeMap = new Map<string, DailyChallengeRound[]>();
    for (const c of challenges) {
        const list = challengeMap.get(c.game_date);
        if (list) list.push(c);
        else challengeMap.set(c.game_date, [c]);
    }

    const allScores = db
        .prepare('SELECT user_id, username, round_scores, game_date FROM scores ORDER BY game_date ASC, id ASC')
        .all() as Array<{ user_id: string; username: string; round_scores: string | null; game_date: string }>;

    // Track latest username per user_id so renamed users show consistently
    const latestUsername = new Map<string, string>();
    for (const s of allScores) {
        latestUsername.set(s.user_id, s.username);
    }

    // Group scores by date to compute per-(game_date, round_num) lobby mean
    const scoresByDate = new Map<string, Array<{ userId: string; rounds: number[] }>>();
    for (const s of allScores) {
        if (!s.round_scores || !challengeMap.has(s.game_date)) continue;
        try {
            const parsed = JSON.parse(s.round_scores) as number[];
            if (!Array.isArray(parsed) || parsed.length === 0) continue;
            const list = scoresByDate.get(s.game_date);
            if (list) list.push({ userId: s.user_id, rounds: parsed });
            else scoresByDate.set(s.game_date, [{ userId: s.user_id, rounds: parsed }]);
        } catch {
            continue;
        }
    }

    const attempts: JoinedRoundAttempt[] = [];
    for (const [gameDate, dateScores] of scoresByDate) {
        const dayChallenges = challengeMap.get(gameDate);
        if (!dayChallenges) continue;

        for (const ch of dayChallenges) {
            const rIdx = ch.round_num - 1;
            const roundValues: Array<{ userId: string; val: number }> = [];
            for (const ds of dateScores) {
                const v = ds.rounds[rIdx];
                if (typeof v === 'number' && Number.isFinite(v)) {
                    roundValues.push({ userId: ds.userId, val: v });
                }
            }
            if (roundValues.length === 0) continue;

            const lobbyMean = roundValues.reduce((sum, x) => sum + x.val, 0) / roundValues.length;
            for (const rv of roundValues) {
                attempts.push({
                    userId: rv.userId,
                    username: latestUsername.get(rv.userId) ?? rv.userId,
                    gameDate,
                    roundNum: ch.round_num,
                    accuracy: rv.val,
                    delta: rv.val - lobbyMean,
                    locationName: ch.name,
                    countryCode: ch.country_code,
                    countryName: ch.country_name,
                    continent: ch.continent,
                    subregion: ch.subregion,
                });
            }
        }
    }

    return { attempts, challenges };
}

export function resolveGeoArea(rawQuery: string): GeoAreaFilter | null {
    const q = rawQuery.trim();
    if (!q) return null;
    const lower = q.toLowerCase();

    const alias = AREA_ALIASES[lower];
    if (alias) {
        if (alias.kind === 'continent') {
            return {
                kind: 'continent',
                value: alias.value,
                label: alias.value,
                icon: CONTINENT_ICONS[alias.value] ?? '🌍',
            };
        }
        const sampleContinent = KNOWN_CONTINENTS.find(c => alias.value.includes(c)) ?? 'Asia';
        return {
            kind: 'subregion',
            value: alias.value,
            label: alias.value,
            icon: CONTINENT_ICONS[sampleContinent] ?? '🌍',
        };
    }

    const exactContinent = KNOWN_CONTINENTS.find(c => c.toLowerCase() === lower);
    if (exactContinent) {
        return {
            kind: 'continent',
            value: exactContinent,
            label: exactContinent,
            icon: CONTINENT_ICONS[exactContinent] ?? '🌍',
        };
    }

    const exactSubregion = KNOWN_SUBREGIONS.find(s => s.toLowerCase() === lower);
    if (exactSubregion) {
        return {
            kind: 'subregion',
            value: exactSubregion,
            label: exactSubregion,
            icon: '🗺️',
        };
    }

    // Only check 2-letter ISO code after ruling out aliases like EU/NA/SA
    const iso = findCountryIsoByQuery(q);
    if (iso) {
        const meta = getCountryMetadata(iso);
        return {
            kind: 'country',
            value: meta.code,
            label: meta.name,
            icon: countryCodeToFlag(meta.code),
        };
    }

    // Fuzzy substring fallback against subregions, continents, and countries in DB
    const fuzzySub = KNOWN_SUBREGIONS.find(s => s.toLowerCase().includes(lower));
    if (fuzzySub) {
        return { kind: 'subregion', value: fuzzySub, label: fuzzySub, icon: '🗺️' };
    }
    const fuzzyCont = KNOWN_CONTINENTS.find(c => c.toLowerCase().includes(lower));
    if (fuzzyCont) {
        return {
            kind: 'continent',
            value: fuzzyCont,
            label: fuzzyCont,
            icon: CONTINENT_ICONS[fuzzyCont] ?? '🌍',
        };
    }

    const todayCutoff = getTodayDate(config.timezone);
    const dbCountry = db
        .prepare(
            'SELECT country_code, country_name FROM daily_challenges WHERE game_date < ? AND LOWER(country_name) LIKE ? LIMIT 1'
        )
        .get(todayCutoff, `%${lower}%`) as { country_code: string; country_name: string } | undefined;
    if (dbCountry) {
        return {
            kind: 'country',
            value: dbCountry.country_code,
            label: dbCountry.country_name,
            icon: countryCodeToFlag(dbCountry.country_code),
        };
    }

    return null;
}

export function getGeoAutocompleteChoices(query: string): Array<{ name: string; value: string }> {
    const q = query.trim().toLowerCase();
    const todayCutoff = getTodayDate(config.timezone);

    const contRows = db
        .prepare(
            'SELECT continent as label, COUNT(*) as c FROM daily_challenges WHERE game_date < ? GROUP BY continent ORDER BY c DESC'
        )
        .all(todayCutoff) as Array<{ label: string; c: number }>;
    const subRows = db
        .prepare(
            'SELECT subregion as label, COUNT(*) as c FROM daily_challenges WHERE game_date < ? GROUP BY subregion ORDER BY c DESC'
        )
        .all(todayCutoff) as Array<{ label: string; c: number }>;
    const countryRows = db
        .prepare(
            'SELECT country_code, country_name as label, COUNT(*) as c FROM daily_challenges WHERE game_date < ? GROUP BY country_code ORDER BY c DESC'
        )
        .all(todayCutoff) as Array<{ country_code: string; label: string; c: number }>;

    const candidates: Array<{ name: string; value: string; count: number; matchRank: number }> = [];
    const seenValues = new Set<string>();

    const pushCandidate = (icon: string, label: string, kindTag: string, value: string, count: number) => {
        if (seenValues.has(value.toLowerCase())) return;
        const lowerLabel = label.toLowerCase();
        const lowerVal = value.toLowerCase();
        if (q && !lowerLabel.includes(q) && !lowerVal.includes(q)) return;
        seenValues.add(lowerVal);
        const matchRank = !q
            ? 1
            : lowerLabel === q || lowerVal === q
              ? 0
              : lowerLabel.startsWith(q)
                ? 1
                : 2;
        candidates.push({
            name: `${icon} ${label} (${kindTag} · ${count} round${count === 1 ? '' : 's'})`.slice(0, 100),
            value,
            count,
            matchRank,
        });
    };

    for (const r of contRows) {
        pushCandidate(CONTINENT_ICONS[r.label] ?? '🌍', r.label, 'Continent', r.label, r.c);
    }
    for (const r of subRows) {
        pushCandidate('🗺️', r.label, 'Subregion', r.label, r.c);
    }
    for (const r of countryRows) {
        pushCandidate(countryCodeToFlag(r.country_code), r.label, r.country_code, r.label, r.c);
    }

    candidates.sort((a, b) => a.matchRank - b.matchRank || b.count - a.count || a.value.localeCompare(b.value));
    return candidates.slice(0, 25).map(({ name, value }) => ({ name, value }));
}

function aggregateStandings(attempts: JoinedRoundAttempt[]): GeoPlayerStanding[] {
    const byUser = new Map<
        string,
        { username: string; accSum: number; deltaSum: number; rounds: number; best: number; perfects: number }
    >();

    for (const a of attempts) {
        const cur = byUser.get(a.userId);
        if (cur) {
            cur.accSum += a.accuracy;
            cur.deltaSum += a.delta;
            cur.rounds++;
            if (a.accuracy > cur.best) cur.best = a.accuracy;
            if (a.accuracy === 100) cur.perfects++;
        } else {
            byUser.set(a.userId, {
                username: a.username,
                accSum: a.accuracy,
                deltaSum: a.delta,
                rounds: 1,
                best: a.accuracy,
                perfects: a.accuracy === 100 ? 1 : 0,
            });
        }
    }

    const standings: GeoPlayerStanding[] = [];
    for (const [user_id, d] of byUser) {
        standings.push({
            user_id,
            username: d.username,
            rounds: d.rounds,
            meanAccuracy: d.accSum / d.rounds,
            meanDelta: d.deltaSum / d.rounds,
            bestScore: d.best,
            perfectCount: d.perfects,
        });
    }

    standings.sort(
        (a, b) => b.meanAccuracy - a.meanAccuracy || b.meanDelta - a.meanDelta || b.rounds - a.rounds
    );
    return standings;
}

function computeDefaultMinRounds(
    kind: 'continent' | 'subregion' | 'country',
    challengeRounds: number,
    maxPlayerRounds: number
): number {
    const base = kind === 'country' ? 3 : 5;
    const scaled =
        kind === 'country'
            ? Math.min(10, Math.max(base, Math.ceil(challengeRounds * 0.2)))
            : Math.min(20, Math.max(base, Math.ceil(challengeRounds * 0.2)));
    return Math.max(1, Math.min(scaled, maxPlayerRounds));
}

export function getGeoLeaderboard(
    area: GeoAreaFilter,
    requestedMinRounds?: number
): GeoLeaderboardResult {
    const { attempts, challenges } = loadJoinedRoundAttempts();

    const matchesChallenge = (c: DailyChallengeRound): boolean => {
        if (area.kind === 'continent') return c.continent === area.value;
        if (area.kind === 'subregion') return c.subregion === area.value;
        return c.country_code === area.value;
    };

    const matchesAttempt = (a: JoinedRoundAttempt): boolean => {
        if (area.kind === 'continent') return a.continent === area.value;
        if (area.kind === 'subregion') return a.subregion === area.value;
        return a.countryCode === area.value;
    };

    const areaChallenges = challenges.filter(matchesChallenge);
    const areaAttempts = attempts.filter(matchesAttempt);

    if (areaAttempts.length === 0) {
        return {
            area,
            totalChallengeRounds: areaChallenges.length,
            totalPlayerAttempts: 0,
            lobbyMeanAccuracy: 0,
            effectiveMinRounds: requestedMinRounds ?? 1,
            easiestLocation: null,
            hardestLocation: null,
            standings: [],
        };
    }

    const lobbyMeanAccuracy =
        areaAttempts.reduce((sum, a) => sum + a.accuracy, 0) / areaAttempts.length;

    // Easiest and hardest specific challenge round in this area
    const byRoundKey = new Map<string, { name: string; flag: string; sum: number; count: number }>();
    for (const a of areaAttempts) {
        const key = `${a.gameDate}#${a.roundNum}`;
        const cur = byRoundKey.get(key);
        if (cur) {
            cur.sum += a.accuracy;
            cur.count++;
        } else {
            byRoundKey.set(key, {
                name: a.locationName,
                flag: countryCodeToFlag(a.countryCode),
                sum: a.accuracy,
                count: 1,
            });
        }
    }

    const locationMeans = [...byRoundKey.values()]
        .map(x => ({ name: x.name, flag: x.flag, mean: x.sum / x.count }))
        .sort((a, b) => b.mean - a.mean);

    const allStandings = aggregateStandings(areaAttempts);
    const maxPlayerRounds = Math.max(...allStandings.map(s => s.rounds));
    const effectiveMinRounds =
        requestedMinRounds !== undefined
            ? Math.max(1, requestedMinRounds)
            : computeDefaultMinRounds(area.kind, areaChallenges.length, maxPlayerRounds);

    const qualified = allStandings.filter(s => s.rounds >= effectiveMinRounds);

    return {
        area,
        totalChallengeRounds: areaChallenges.length,
        totalPlayerAttempts: areaAttempts.length,
        lobbyMeanAccuracy,
        effectiveMinRounds,
        easiestLocation: locationMeans[0] ?? null,
        hardestLocation: locationMeans.length > 1 ? locationMeans[locationMeans.length - 1] : null,
        standings: qualified,
    };
}

export function getWorldCrownsOverview(requestedMinRounds?: number): WorldCrownsOverview {
    const { syncedDays, scoredDays } = getChallengeCoverage();
    const { attempts, challenges } = loadJoinedRoundAttempts();

    const buildCrowns = (
        groupBy: 'continent' | 'subregion',
        minChallengeRounds: number
    ): WorldCrownEntry[] => {
        const challengeCounts = new Map<string, number>();
        for (const c of challenges) {
            const key = groupBy === 'continent' ? c.continent : c.subregion;
            challengeCounts.set(key, (challengeCounts.get(key) ?? 0) + 1);
        }

        const attemptsByGroup = new Map<string, JoinedRoundAttempt[]>();
        for (const a of attempts) {
            const key = groupBy === 'continent' ? a.continent : a.subregion;
            const list = attemptsByGroup.get(key);
            if (list) list.push(a);
            else attemptsByGroup.set(key, [a]);
        }

        const entries: WorldCrownEntry[] = [];
        for (const [label, cCount] of challengeCounts) {
            if (label === 'International Waters' || label === 'Antarctica') continue;
            if (cCount < minChallengeRounds) continue;

            const grpAttempts = attemptsByGroup.get(label) ?? [];
            if (grpAttempts.length === 0) continue;

            const standings = aggregateStandings(grpAttempts);
            const maxRounds = Math.max(...standings.map(s => s.rounds));
            const floor =
                requestedMinRounds !== undefined
                    ? Math.max(1, Math.min(requestedMinRounds, maxRounds))
                    : computeDefaultMinRounds(groupBy, cCount, maxRounds);
            const leader = standings.find(s => s.rounds >= floor);
            if (!leader) continue;

            entries.push({
                label,
                icon: groupBy === 'continent' ? (CONTINENT_ICONS[label] ?? '🌍') : '🗺️',
                challengeRounds: cCount,
                leaderUsername: leader.username,
                leaderMeanAccuracy: leader.meanAccuracy,
                leaderMeanDelta: leader.meanDelta,
                leaderRounds: leader.rounds,
            });
        }

        entries.sort((a, b) => b.challengeRounds - a.challengeRounds || a.label.localeCompare(b.label));
        return entries;
    };

    return {
        syncedDays,
        scoredDays,
        continents: buildCrowns('continent', 1),
        subregions: buildCrowns('subregion', 3),
    };
}

export function getUserPassport(userId: string): UserPassport | null {
    const { attempts, challenges } = loadJoinedRoundAttempts();
    const userAttempts = attempts.filter(a => a.userId === userId);
    if (userAttempts.length === 0) return null;

    const continentChallengeCounts = new Map<string, number>();
    for (const c of challenges) {
        continentChallengeCounts.set(c.continent, (continentChallengeCounts.get(c.continent) ?? 0) + 1);
    }

    // Continents with server rank
    const attemptsByContinent = new Map<string, JoinedRoundAttempt[]>();
    for (const a of attempts) {
        if (a.continent === 'International Waters' || a.continent === 'Antarctica') continue;
        const list = attemptsByContinent.get(a.continent);
        if (list) list.push(a);
        else attemptsByContinent.set(a.continent, [a]);
    }

    const continents: UserPassportEntry[] = [];
    for (const [continent, contAttempts] of attemptsByContinent) {
        const allStandings = aggregateStandings(contAttempts);
        const me = allStandings.find(s => s.user_id === userId);
        if (!me) continue;

        const maxRounds = Math.max(...allStandings.map(s => s.rounds));
        const floor = computeDefaultMinRounds(
            'continent',
            continentChallengeCounts.get(continent) ?? contAttempts.length,
            maxRounds
        );
        const qualified = allStandings.filter(s => s.rounds >= floor);
        const qIdx = qualified.findIndex(s => s.user_id === userId);

        continents.push({
            label: continent,
            icon: CONTINENT_ICONS[continent] ?? '🌍',
            rounds: me.rounds,
            meanAccuracy: me.meanAccuracy,
            meanDelta: me.meanDelta,
            rank: qIdx >= 0 ? qIdx + 1 : undefined,
            qualifiedPlayers: qIdx >= 0 ? qualified.length : undefined,
        });
    }
    continents.sort((a, b) => b.meanDelta - a.meanDelta || b.meanAccuracy - a.meanAccuracy);

    // Subregions for this user
    const bySubregion = new Map<string, { accSum: number; deltaSum: number; rounds: number }>();
    for (const a of userAttempts) {
        if (a.subregion === 'International Waters' || a.subregion === 'Antarctica') continue;
        const cur = bySubregion.get(a.subregion);
        if (cur) {
            cur.accSum += a.accuracy;
            cur.deltaSum += a.delta;
            cur.rounds++;
        } else {
            bySubregion.set(a.subregion, { accSum: a.accuracy, deltaSum: a.delta, rounds: 1 });
        }
    }

    const subMin = userAttempts.length >= 25 ? 3 : 1;
    const subEntries: UserPassportEntry[] = [...bySubregion.entries()]
        .filter(([, d]) => d.rounds >= subMin)
        .map(([label, d]) => ({
            label,
            icon: '🗺️',
            rounds: d.rounds,
            meanAccuracy: d.accSum / d.rounds,
            meanDelta: d.deltaSum / d.rounds,
        }));

    const strongestSubregions = [...subEntries]
        .sort((a, b) => b.meanDelta - a.meanDelta || b.meanAccuracy - a.meanAccuracy)
        .slice(0, 3);

    const weakestSubregions = [...subEntries]
        .sort((a, b) => a.meanDelta - b.meanDelta || a.meanAccuracy - b.meanAccuracy)
        .slice(0, 3);

    // Top countries for this user
    const byCountry = new Map<string, { name: string; accSum: number; deltaSum: number; rounds: number }>();
    for (const a of userAttempts) {
        if (a.countryCode === 'XX') continue;
        const cur = byCountry.get(a.countryCode);
        if (cur) {
            cur.accSum += a.accuracy;
            cur.deltaSum += a.delta;
            cur.rounds++;
        } else {
            byCountry.set(a.countryCode, {
                name: a.countryName,
                accSum: a.accuracy,
                deltaSum: a.delta,
                rounds: 1,
            });
        }
    }

    const countryMin = userAttempts.length >= 25 ? 2 : 1;
    const topCountries: UserPassportEntry[] = [...byCountry.entries()]
        .filter(([, d]) => d.rounds >= countryMin)
        .map(([code, d]) => ({
            label: d.name,
            icon: countryCodeToFlag(code),
            rounds: d.rounds,
            meanAccuracy: d.accSum / d.rounds,
            meanDelta: d.deltaSum / d.rounds,
        }))
        .sort((a, b) => b.meanAccuracy - a.meanAccuracy || b.meanDelta - a.meanDelta || b.rounds - a.rounds)
        .slice(0, 5);

    return {
        totalSyncedRounds: userAttempts.length,
        continents,
        strongestSubregions,
        weakestSubregions,
        topCountries,
    };
}

export interface LlmRoundDetail {
    round: number;
    multiplier: number;
    cityName: string;
    rawScore: number;
    weightedPoints: number;
    distanceKm: number;
    stepCount: number;
    forcedDrop: boolean;
    confidence: number;
    monologue: string;
    snarkyText: string;
}

export interface LlmDailyRunRecord {
    game_date: string;
    model: string;
    mode: string;
    status: 'running' | 'completed' | 'failed';
    total_score: number | null;
    raw_score: number | null;
    round_scores: string | null;
    round_details: string | null;
    total_steps: number | null;
    wall_clock_ms: number | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    reasoning_tokens: number | null;
    gif_path: string | null;
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
}

export interface CompleteLlmDailyRunInput {
    gameDate: string;
    model: string;
    mode: string;
    totalScore: number;
    rawScore: number;
    roundScores: number[];
    roundDetails: LlmRoundDetail[];
    totalSteps: number;
    wallClockMs: number;
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    gifPath: string | null;
}

export interface LlmDayLobbyPlacement {
    llmScore: number;
    humanCount: number;
    humansBeaten: number;
    humansTied: number;
    virtualRank: number;
    lobbyMean: number | null;
    deltaVsLobby: number | null;
}

export interface LlmPlayerRivalryRow {
    userId: string;
    username: string;
    sharedDays: number;
    humanWins: number;
    llmWins: number;
    ties: number;
    meanMarginVsLlm: number;
}

export interface LlmHeadToHeadSummary {
    completedRuns: number;
    meanScore: number;
    bestScore: number;
    bestScoreDate: string | null;
    worstScore: number;
    worstScoreDate: string | null;
    daysWithHumans: number;
    daysBeatLobbyMean: number;
    firstPlaceFinishes: number;
    rivalries: LlmPlayerRivalryRow[];
}

export function upsertLlmDailyRunStart(gameDate: string, model: string, mode: string): void {
    if (!db.open) return;
    db.prepare(`
        INSERT INTO llm_daily_runs (
            game_date, model, mode, status, error_message, started_at, completed_at
        ) VALUES (?, ?, ?, 'running', NULL, ?, NULL)
        ON CONFLICT(game_date) DO UPDATE SET
            model = excluded.model,
            mode = excluded.mode,
            status = 'running',
            error_message = NULL,
            started_at = excluded.started_at,
            completed_at = NULL
    `).run(gameDate, model, mode, new Date().toISOString());
}

export function completeLlmDailyRun(input: CompleteLlmDailyRunInput): void {
    if (!db.open) return;
    const nowIso = new Date().toISOString();
    db.prepare(`
        INSERT INTO llm_daily_runs (
            game_date, model, mode, status,
            total_score, raw_score, round_scores, round_details,
            total_steps, wall_clock_ms, prompt_tokens, completion_tokens, reasoning_tokens,
            gif_path, error_message, started_at, completed_at
        ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(game_date) DO UPDATE SET
            model = excluded.model,
            mode = excluded.mode,
            status = 'completed',
            total_score = excluded.total_score,
            raw_score = excluded.raw_score,
            round_scores = excluded.round_scores,
            round_details = excluded.round_details,
            total_steps = excluded.total_steps,
            wall_clock_ms = excluded.wall_clock_ms,
            prompt_tokens = excluded.prompt_tokens,
            completion_tokens = excluded.completion_tokens,
            reasoning_tokens = excluded.reasoning_tokens,
            gif_path = excluded.gif_path,
            error_message = NULL,
            completed_at = excluded.completed_at
    `).run(
        input.gameDate,
        input.model,
        input.mode,
        input.totalScore,
        input.rawScore,
        JSON.stringify(input.roundScores),
        JSON.stringify(input.roundDetails),
        input.totalSteps,
        input.wallClockMs,
        input.promptTokens,
        input.completionTokens,
        input.reasoningTokens,
        input.gifPath,
        nowIso,
        nowIso
    );
}

export function failLlmDailyRun(gameDate: string, errorMessage: string): void {
    if (!db.open) return;
    db.prepare(`
        UPDATE llm_daily_runs
        SET status = 'failed',
            error_message = ?,
            completed_at = ?
        WHERE game_date = ?
    `).run(errorMessage.slice(0, 500), new Date().toISOString(), gameDate);
}

export function getLlmDailyRun(gameDate: string): LlmDailyRunRecord | null {
    if (!db.open) return null;
    const row = db
        .prepare('SELECT * FROM llm_daily_runs WHERE game_date = ?')
        .get(gameDate) as LlmDailyRunRecord | undefined;
    return row ?? null;
}

export function parseLlmRoundDetails(run: LlmDailyRunRecord | null): LlmRoundDetail[] {
    if (!run?.round_details) return [];
    try {
        const parsed = JSON.parse(run.round_details) as LlmRoundDetail[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function getLlmDayPlacement(gameDate: string): LlmDayLobbyPlacement | null {
    const run = getLlmDailyRun(gameDate);
    if (!run || run.status !== 'completed' || run.total_score === null) {
        return null;
    }

    const humanScores = getScoresForDate(gameDate);
    const llmScore = run.total_score;
    if (humanScores.length === 0) {
        return {
            llmScore,
            humanCount: 0,
            humansBeaten: 0,
            humansTied: 0,
            virtualRank: 1,
            lobbyMean: null,
            deltaVsLobby: null,
        };
    }

    const humansAbove = humanScores.filter(s => s.score > llmScore).length;
    const humansBeaten = humanScores.filter(s => s.score < llmScore).length;
    const humansTied = humanScores.filter(s => s.score === llmScore).length;
    const lobbyMean = humanScores.reduce((acc, s) => acc + s.score, 0) / humanScores.length;

    return {
        llmScore,
        humanCount: humanScores.length,
        humansBeaten,
        humansTied,
        virtualRank: humansAbove + 1,
        lobbyMean,
        deltaVsLobby: llmScore - lobbyMean,
    };
}

export function getLlmVsHumansStats(): LlmHeadToHeadSummary {
    const runs = db
        .prepare(
            "SELECT * FROM llm_daily_runs WHERE status = 'completed' AND total_score IS NOT NULL ORDER BY game_date ASC"
        )
        .all() as LlmDailyRunRecord[];

    if (runs.length === 0) {
        return {
            completedRuns: 0,
            meanScore: 0,
            bestScore: 0,
            bestScoreDate: null,
            worstScore: 0,
            worstScoreDate: null,
            daysWithHumans: 0,
            daysBeatLobbyMean: 0,
            firstPlaceFinishes: 0,
            rivalries: [],
        };
    }

    let scoreSum = 0;
    let bestScore = -1;
    let bestScoreDate: string | null = null;
    let worstScore = Number.MAX_SAFE_INTEGER;
    let worstScoreDate: string | null = null;
    let daysWithHumans = 0;
    let daysBeatLobbyMean = 0;
    let firstPlaceFinishes = 0;

    const rivalryByUser = new Map<
        string,
        { username: string; sharedDays: number; humanWins: number; llmWins: number; ties: number; marginSum: number }
    >();

    for (const r of runs) {
        const llmScore = r.total_score!;
        scoreSum += llmScore;
        if (llmScore > bestScore) {
            bestScore = llmScore;
            bestScoreDate = r.game_date;
        }
        if (llmScore < worstScore) {
            worstScore = llmScore;
            worstScoreDate = r.game_date;
        }

        const humanScores = getScoresForDate(r.game_date);
        if (humanScores.length > 0) {
            daysWithHumans++;
            const lobbyMean = humanScores.reduce((s, x) => s + x.score, 0) / humanScores.length;
            if (llmScore > lobbyMean) daysBeatLobbyMean++;
            if (humanScores.every(h => llmScore >= h.score)) firstPlaceFinishes++;

            for (const h of humanScores) {
                const cur = rivalryByUser.get(h.user_id) ?? {
                    username: h.username,
                    sharedDays: 0,
                    humanWins: 0,
                    llmWins: 0,
                    ties: 0,
                    marginSum: 0,
                };
                cur.username = h.username;
                cur.sharedDays++;
                cur.marginSum += h.score - llmScore;
                if (h.score > llmScore) cur.humanWins++;
                else if (h.score < llmScore) cur.llmWins++;
                else cur.ties++;
                rivalryByUser.set(h.user_id, cur);
            }
        }
    }

    const rivalries: LlmPlayerRivalryRow[] = [...rivalryByUser.entries()]
        .map(([userId, d]) => ({
            userId,
            username: d.username,
            sharedDays: d.sharedDays,
            humanWins: d.humanWins,
            llmWins: d.llmWins,
            ties: d.ties,
            meanMarginVsLlm: d.marginSum / d.sharedDays,
        }))
        .sort(
            (a, b) =>
                b.humanWins - a.humanWins ||
                b.meanMarginVsLlm - a.meanMarginVsLlm ||
                b.sharedDays - a.sharedDays
        );

    return {
        completedRuns: runs.length,
        meanScore: scoreSum / runs.length,
        bestScore,
        bestScoreDate,
        worstScore,
        worstScoreDate,
        daysWithHumans,
        daysBeatLobbyMean,
        firstPlaceFinishes,
        rivalries,
    };
}
