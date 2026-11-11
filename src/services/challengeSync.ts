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
const MAX_PARSE_DEPTH = 16;

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

/**
 * Static data-only parser for MapTap's `cities = [ { ... }, ... ]` files.
 * Never executes JavaScript (`vm`, `eval`, or `Function`), eliminating untrusted code execution.
 */
class StaticCitiesParser {
    private pos = 0;
    private readonly len: number;

    constructor(private readonly src: string) {
        this.len = src.length;
    }

    private skipWsAndComments(): void {
        while (this.pos < this.len) {
            const ch = this.src.charCodeAt(this.pos);
            if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 0xfeff) {
                this.pos++;
                continue;
            }
            if (ch === 47 && this.pos + 1 < this.len) {
                const next = this.src.charCodeAt(this.pos + 1);
                if (next === 47) {
                    this.pos += 2;
                    while (this.pos < this.len && this.src.charCodeAt(this.pos) !== 10) {
                        this.pos++;
                    }
                    continue;
                }
                if (next === 42) {
                    this.pos += 2;
                    while (this.pos + 1 < this.len) {
                        if (
                            this.src.charCodeAt(this.pos) === 42 &&
                            this.src.charCodeAt(this.pos + 1) === 47
                        ) {
                            this.pos += 2;
                            break;
                        }
                        this.pos++;
                    }
                    continue;
                }
            }
            break;
        }
    }

    private isIdentStart(ch: number): boolean {
        return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95 || ch === 36;
    }

    private isIdentPart(ch: number): boolean {
        return this.isIdentStart(ch) || (ch >= 48 && ch <= 57);
    }

    private readIdentifier(): string {
        const start = this.pos;
        while (this.pos < this.len && this.isIdentPart(this.src.charCodeAt(this.pos))) {
            this.pos++;
        }
        return this.src.slice(start, this.pos);
    }

    private readStringLiteral(): string | null {
        const quote = this.src[this.pos];
        if (quote !== '"' && quote !== "'" && quote !== '`') return null;
        this.pos++;
        let out = '';
        while (this.pos < this.len) {
            const ch = this.src[this.pos++];
            if (ch === quote) {
                return out;
            }
            if (ch === '\\' && this.pos < this.len) {
                const esc = this.src[this.pos++];
                if (esc === 'n') out += '\n';
                else if (esc === 'r') out += '\r';
                else if (esc === 't') out += '\t';
                else if (esc === 'u') {
                    if (this.src[this.pos] === '{') {
                        const close = this.src.indexOf('}', this.pos + 1);
                        if (close === -1) return null;
                        const cp = parseInt(this.src.slice(this.pos + 1, close), 16);
                        if (Number.isFinite(cp)) out += String.fromCodePoint(cp);
                        this.pos = close + 1;
                    } else {
                        const hex = this.src.slice(this.pos, this.pos + 4);
                        const cp = parseInt(hex, 16);
                        if (Number.isFinite(cp)) out += String.fromCharCode(cp);
                        this.pos += 4;
                    }
                } else if (esc === 'x') {
                    const hex = this.src.slice(this.pos, this.pos + 2);
                    const cp = parseInt(hex, 16);
                    if (Number.isFinite(cp)) out += String.fromCharCode(cp);
                    this.pos += 2;
                } else {
                    out += esc;
                }
                continue;
            }
            if (quote === '`' && ch === '$' && this.src[this.pos] === '{') {
                // Never evaluate template expressions; drain through closing backtick and return null
                this.skipBalanced('{', '}');
                while (this.pos < this.len) {
                    const rem = this.src[this.pos++];
                    if (rem === '\\') {
                        this.pos++;
                        continue;
                    }
                    if (rem === '`') break;
                }
                return null;
            }
            out += ch;
        }
        return null;
    }

    private skipBalanced(openChar: string, closeChar: string): void {
        if (this.src[this.pos] !== openChar) return;
        this.pos++;
        let depth = 1;
        while (this.pos < this.len && depth > 0) {
            this.skipWsAndComments();
            if (this.pos >= this.len) break;
            const c = this.src[this.pos];
            if (c === '"' || c === "'" || c === '`') {
                this.skipRawQuoted();
                continue;
            }
            if (c === openChar) depth++;
            else if (c === closeChar) depth--;
            this.pos++;
        }
    }

    private skipRawQuoted(): void {
        const q = this.src[this.pos++];
        while (this.pos < this.len) {
            const c = this.src[this.pos++];
            if (c === '\\') {
                this.pos++;
                continue;
            }
            if (c === q) break;
        }
    }

    private skipUnsupportedValue(stopA: string, stopB: string): void {
        let brace = 0;
        let bracket = 0;
        let paren = 0;
        while (this.pos < this.len) {
            this.skipWsAndComments();
            if (this.pos >= this.len) break;
            const c = this.src[this.pos];
            if (brace === 0 && bracket === 0 && paren === 0 && (c === stopA || c === stopB)) {
                return;
            }
            if (c === '"' || c === "'" || c === '`') {
                this.skipRawQuoted();
                continue;
            }
            if (c === '{') brace++;
            else if (c === '}') brace = Math.max(0, brace - 1);
            else if (c === '[') bracket++;
            else if (c === ']') bracket = Math.max(0, bracket - 1);
            else if (c === '(') paren++;
            else if (c === ')') paren = Math.max(0, paren - 1);
            this.pos++;
        }
    }

    private parseValue(depth: number, stopA: string, stopB: string): unknown {
        if (depth > MAX_PARSE_DEPTH) {
            this.skipUnsupportedValue(stopA, stopB);
            return undefined;
        }
        this.skipWsAndComments();
        if (this.pos >= this.len) return undefined;

        const c = this.src[this.pos];
        if (c === '"' || c === "'" || c === '`') {
            let acc = this.readStringLiteral();
            if (acc === null) {
                this.skipUnsupportedValue(stopA, stopB);
                return undefined;
            }
            while (this.pos < this.len) {
                this.skipWsAndComments();
                if (this.src[this.pos] !== '+') break;
                this.pos++;
                this.skipWsAndComments();
                const q2 = this.src[this.pos];
                if (q2 !== '"' && q2 !== "'" && q2 !== '`') {
                    this.skipUnsupportedValue(stopA, stopB);
                    return undefined;
                }
                const nextPart = this.readStringLiteral();
                if (nextPart === null) {
                    this.skipUnsupportedValue(stopA, stopB);
                    return undefined;
                }
                acc += nextPart;
            }
            this.skipWsAndComments();
            const after = this.src[this.pos];
            if (after && after !== stopA && after !== stopB) {
                this.skipUnsupportedValue(stopA, stopB);
                return undefined;
            }
            return acc;
        }

        if (c === '{') {
            return this.parseObject(depth + 1);
        }

        if (c === '[') {
            return this.parseArray(depth + 1);
        }

        if (c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9')) {
            const numMatch = this.src
                .slice(this.pos)
                .match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
            if (numMatch) {
                this.pos += numMatch[0].length;
                this.skipWsAndComments();
                const after = this.src[this.pos];
                if (!after || after === stopA || after === stopB) {
                    const n = Number(numMatch[0]);
                    return Number.isFinite(n) ? n : undefined;
                }
            }
            this.skipUnsupportedValue(stopA, stopB);
            return undefined;
        }

        if (this.isIdentStart(this.src.charCodeAt(this.pos))) {
            const ident = this.readIdentifier();
            this.skipWsAndComments();
            const after = this.src[this.pos];
            if (!after || after === stopA || after === stopB) {
                if (ident === 'true') return true;
                if (ident === 'false') return false;
                if (ident === 'null') return null;
                return undefined;
            }
        }

        this.skipUnsupportedValue(stopA, stopB);
        return undefined;
    }

    private parseObject(depth: number): Record<string, unknown> | null {
        if (this.src[this.pos] !== '{') return null;
        this.pos++;
        const obj: Record<string, unknown> = Object.create(null);

        while (this.pos < this.len) {
            this.skipWsAndComments();
            if (this.pos >= this.len) return null;
            if (this.src[this.pos] === '}') {
                this.pos++;
                return obj;
            }
            if (this.src[this.pos] === ',') {
                this.pos++;
                continue;
            }

            let key: string | null = null;
            const ch = this.src[this.pos];
            if (ch === '"' || ch === "'" || ch === '`') {
                key = this.readStringLiteral();
            } else if (this.isIdentStart(this.src.charCodeAt(this.pos))) {
                key = this.readIdentifier();
            }

            if (!key) {
                this.skipUnsupportedValue(',', '}');
                if (this.src[this.pos] === ',') this.pos++;
                continue;
            }

            this.skipWsAndComments();
            if (this.src[this.pos] !== ':') {
                this.skipUnsupportedValue(',', '}');
                if (this.src[this.pos] === ',') this.pos++;
                continue;
            }
            this.pos++;

            const val = this.parseValue(depth, ',', '}');
            if (val !== undefined) {
                obj[key] = val;
            }

            this.skipWsAndComments();
            if (this.src[this.pos] === ',') {
                this.pos++;
            }
        }
        return null;
    }

    private parseArray(depth: number): unknown[] | null {
        if (this.src[this.pos] !== '[') return null;
        this.pos++;
        const arr: unknown[] = [];

        while (this.pos < this.len) {
            this.skipWsAndComments();
            if (this.pos >= this.len) return null;
            if (this.src[this.pos] === ']') {
                this.pos++;
                return arr;
            }
            if (this.src[this.pos] === ',') {
                this.pos++;
                continue;
            }
            const item = this.parseValue(depth, ',', ']');
            if (item !== undefined) {
                arr.push(item);
            }
            this.skipWsAndComments();
            if (this.src[this.pos] === ',') {
                this.pos++;
            }
        }
        return null;
    }

    extractCitiesArray(): RawMapTapCity[] | null {
        while (this.pos < this.len) {
            this.skipWsAndComments();
            if (this.pos >= this.len) break;

            const ch = this.src[this.pos];
            if (ch === '"' || ch === "'" || ch === '`') {
                this.skipRawQuoted();
                continue;
            }

            if (this.isIdentStart(this.src.charCodeAt(this.pos))) {
                const ident = this.readIdentifier();
                if (ident === 'cities') {
                    this.skipWsAndComments();
                    if (this.src[this.pos] === '=' && this.src[this.pos + 1] !== '=') {
                        this.pos++;
                        this.skipWsAndComments();
                        if (this.src[this.pos] === '[') {
                            const parsed = this.parseArray(1);
                            if (Array.isArray(parsed) && parsed.length > 0) {
                                return parsed.filter(
                                    (x): x is RawMapTapCity => Boolean(x && typeof x === 'object')
                                );
                            }
                        }
                    }
                }
                continue;
            }

            this.pos++;
        }
        return null;
    }
}

function parseStaticCitiesSnippet(code: string): RawMapTapCity[] | null {
    const parser = new StaticCitiesParser(code);
    return parser.extractCitiesArray();
}

function extractArchivedYearSnippet(fullScript: string, targetYear: string): string | null {
    const headerRegex = new RegExp(`^\\s*//\\s*=+\\s*${targetYear}\\s*=+\\s*$`, 'm');
    const headerMatch = headerRegex.exec(fullScript);
    if (!headerMatch) return null;

    const rest = fullScript.slice(headerMatch.index + headerMatch[0].length);
    const nextYearMatch = /^\s*\/\/\s*=+\s*\d{4}\s*=+\s*$/m.exec(rest);
    const block = nextYearMatch ? rest.slice(0, nextYearMatch.index) : rest;

    return block
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*\/\/\s?/, ''))
        .filter(line => !line.trim().startsWith('*/') && !line.trim().startsWith('/*'))
        .join('\n');
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
    let rawCities = parseStaticCitiesSnippet(scriptContent);

    if (rawCities) {
        const explicitYear = detectExplicitYear(rawCities);
        if (explicitYear && explicitYear !== expectedYear) {
            const archived = extractArchivedYearSnippet(scriptContent, expectedYear);
            rawCities = archived ? parseStaticCitiesSnippet(archived) : null;
        } else if (!explicitYear) {
            const ageDays =
                Math.abs(Date.parse(`${expectedIsoDate}T12:00:00Z`) - referenceNow.getTime()) /
                86_400_000;
            if (ageDays > 330) {
                const archived = extractArchivedYearSnippet(scriptContent, expectedYear);
                rawCities = archived ? parseStaticCitiesSnippet(archived) : null;
            }
        }
    }

    if (!rawCities || rawCities.length < 5) {
        return null;
    }

    const rounds: DailyChallengeRoundInput[] = [];
    for (let i = 0; i < 5; i++) {
        const c = rawCities[i];
        const displayName = (
            (typeof c.correction === 'string' && c.correction) ||
            (typeof c.name === 'string' && c.name) ||
            ''
        ).trim();
        if (!displayName) return null;

        const lat = typeof c.lat === 'number' && Number.isFinite(c.lat) ? c.lat : 0;
        const lng = typeof c.lng === 'number' && Number.isFinite(c.lng) ? c.lng : 0;

        const geo = classifyLocation({
            name: displayName,
            lat,
            lng,
            country: typeof c.country === 'string' ? c.country : undefined,
            highlight: typeof c.highlight === 'string' ? c.highlight : undefined,
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
