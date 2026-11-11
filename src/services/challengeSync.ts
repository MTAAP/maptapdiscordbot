import vm from 'vm';
import { config } from '../config';
import { getTodayDate } from '../utils/dates';
import { classifyLocation } from './geography';
import {
    DailyChallengeRoundInput,
    getMissingChallengeDates,
    hasChallengeForDate,
    upsertDailyChallengeRounds,
} from '../database/queries';

const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

const MAPTAP_DAILY_BASE_URL = 'https://maptap.gg/data/this_day_in_history';
const FETCH_TIMEOUT_MS = 10_000;
const SYNC_CONCURRENCY = 4;

interface RawMapTapCity {
    id?: string;
    name?: string;
    correction?: string;
    title?: string;
    lat?: number;
    lng?: number;
    country?: string;
    highlight?: string;
}

export function isoDateToPlayDay(isoDate: string): string | null {
    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const monthIdx = Number(match[2]) - 1;
    const dayNum = Number(match[3]);
    if (monthIdx < 0 || monthIdx > 11 || dayNum < 1 || dayNum > 31) return null;
    return `${MONTH_NAMES[monthIdx]}${dayNum}`;
}

function executeMapTapDataSnippet(code: string): RawMapTapCity[] | null {
    const sandbox: Record<string, unknown> = Object.create(null);
    sandbox.cities = [];
    sandbox.fiveFromMany = 0;
    sandbox.topFive = 0;
    sandbox.theme = '';
    sandbox.prompt = '';
    sandbox.wrapWidth = 50;
    sandbox.arcTheJourney = 0;
    sandbox.arcList = [];
    sandbox.arcPoints = [];
    sandbox.randomAddedText = [];
    sandbox.randomAddedPoles = [];
    sandbox.pictureLocations = [];
    sandbox.secretMessages = [];
    sandbox.endGameSound = '';
    sandbox.planetAltitude = 1.45;
    sandbox.triviaFocus = 1;
    sandbox.scoreTrack = '';
    sandbox.firstGame = 0;
    sandbox.mapURL = '';
    sandbox.mapTitle = '';
    sandbox.author = '';
    sandbox.description = '';

    try {
        vm.runInNewContext(code, sandbox, { timeout: 500 });
    } catch {
        return null;
    }

    if (!Array.isArray(sandbox.cities) || sandbox.cities.length === 0) {
        return null;
    }
    return sandbox.cities as RawMapTapCity[];
}

function extractArchivedYearSnippet(fullScript: string, targetYear: string): string | null {
    const headerRegex = new RegExp(`^\\s*//\\s*=+\\s*${targetYear}\\s*=+\\s*$`, 'm');
    const headerMatch = headerRegex.exec(fullScript);
    if (!headerMatch) return null;

    const rest = fullScript.slice(headerMatch.index + headerMatch[0].length);
    const nextYearMatch = /^\s*\/\/\s*=+\s*\d{4}\s*=+\s*$/m.exec(rest);
    const block = nextYearMatch ? rest.slice(0, nextYearMatch.index) : rest;

    // Uncomment single-line "// " prefixes used in MapTap's archived year sections
    const uncommented = block
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*\/\/\s?/, ''))
        .filter(line => !line.trim().startsWith('*/') && !line.trim().startsWith('/*'))
        .join('\n');

    return uncommented;
}

function detectExplicitYear(cities: RawMapTapCity[]): string | null {
    for (const c of cities) {
        if (typeof c.id === 'string') {
            const m = c.id.match(/^(\d{4})-\d{2}-\d{2}\b/);
            if (m) return m[1];
        }
    }
    return null;
}

export function parseChallengeScript(
    scriptContent: string,
    expectedIsoDate: string,
    referenceNow: Date = new Date()
): DailyChallengeRoundInput[] | null {
    const expectedYear = expectedIsoDate.slice(0, 4);
    let rawCities = executeMapTapDataSnippet(scriptContent);

    if (rawCities) {
        const explicitYear = detectExplicitYear(rawCities);
        if (explicitYear && explicitYear !== expectedYear) {
            const archived = extractArchivedYearSnippet(scriptContent, expectedYear);
            rawCities = archived ? executeMapTapDataSnippet(archived) : null;
        } else if (!explicitYear) {
            // When no explicit year id is present, reject dates >330 days away from referenceNow
            const ageDays =
                Math.abs(Date.parse(`${expectedIsoDate}T12:00:00Z`) - referenceNow.getTime()) /
                86_400_000;
            if (ageDays > 330) {
                const archived = extractArchivedYearSnippet(scriptContent, expectedYear);
                rawCities = archived ? executeMapTapDataSnippet(archived) : null;
            }
        }
    }

    if (!rawCities || rawCities.length < 5) {
        return null;
    }

    const rounds: DailyChallengeRoundInput[] = [];
    for (let i = 0; i < 5; i++) {
        const c = rawCities[i];
        const displayName = (c.correction || c.name || '').trim();
        if (!displayName) return null;

        const lat = typeof c.lat === 'number' && Number.isFinite(c.lat) ? c.lat : 0;
        const lng = typeof c.lng === 'number' && Number.isFinite(c.lng) ? c.lng : 0;

        const geo = classifyLocation({
            name: displayName,
            lat,
            lng,
            country: c.country,
            highlight: c.highlight,
        });

        rounds.push({
            gameDate: expectedIsoDate,
            roundNum: i + 1,
            locationId: typeof c.id === 'string' ? c.id : null,
            name: displayName,
            lat,
            lng,
            countryCode: geo.countryCode,
            countryName: geo.countryName,
            continent: geo.continent,
            subregion: geo.subregion,
            title: typeof c.title === 'string' ? c.title : null,
        });
    }

    return rounds;
}

export async function fetchAndStoreChallengeForDate(
    isoDate: string,
    options: { baseUrl?: string; fetchImpl?: typeof fetch; referenceNow?: Date } = {}
): Promise<boolean> {
    const playDay = isoDateToPlayDay(isoDate);
    if (!playDay) return false;

    const baseUrl = options.baseUrl ?? MAPTAP_DAILY_BASE_URL;
    const fetchFn = options.fetchImpl ?? fetch;
    const url = `${baseUrl}/${playDay}.js?v=1`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetchFn(url, { signal: controller.signal });
        if (!response.ok) {
            return false;
        }
        const scriptText = await response.text();
        const parsed = parseChallengeScript(scriptText, isoDate, options.referenceNow);
        if (!parsed) {
            return false;
        }
        upsertDailyChallengeRounds(parsed);
        return true;
    } catch (error) {
        console.warn(`Challenge sync skipped for ${isoDate} (${playDay}):`, error);
        return false;
    } finally {
        clearTimeout(timer);
    }
}

export async function ensureChallengeSyncedForDate(isoDate: string): Promise<boolean> {
    if (process.env.MAPTAP_DISABLE_AUTO_CHALLENGE_SYNC === '1') {
        return false;
    }
    if (hasChallengeForDate(isoDate)) {
        return true;
    }
    return fetchAndStoreChallengeForDate(isoDate);
}

export async function syncMissingChallenges(
    options: { includeToday?: boolean; baseUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<{ attempted: number; synced: number }> {
    const missingSet = new Set(getMissingChallengeDates());
    if (options.includeToday !== false) {
        const today = getTodayDate(config.timezone);
        if (!hasChallengeForDate(today)) {
            missingSet.add(today);
        }
    }

    const dates = [...missingSet].sort();
    if (dates.length === 0) {
        return { attempted: 0, synced: 0 };
    }

    let index = 0;
    let synced = 0;

    async function worker(): Promise<void> {
        while (index < dates.length) {
            const isoDate = dates[index++];
            const ok = await fetchAndStoreChallengeForDate(isoDate, {
                baseUrl: options.baseUrl,
                fetchImpl: options.fetchImpl,
            });
            if (ok) synced++;
        }
    }

    const workerCount = Math.min(SYNC_CONCURRENCY, dates.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return { attempted: dates.length, synced };
}
