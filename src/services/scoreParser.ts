import { getDatePartsInTimezone } from '../utils/dates';

export interface ParsedMapTapScore {
    gameDate: string;
    roundScores: number[];
    finalScore: number;
}

const MAX_FINAL_SCORE = 1000;
const MAX_ROUND_SCORE = 200;
const MAX_ROUNDS = 5;

const MONTHS: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
};

export function parseMapTapMessage(content: string): ParsedMapTapScore | null {
    if (!content.startsWith('www.maptap.gg')) {
        return null;
    }

    const lines = content.split(/\r?\n/);
    if (lines.length < 3) {
        return null;
    }

    // Extract date from first line: "www.maptap.gg November 11"
    const dateMatch = lines[0].match(/^www\.maptap\.gg\s+(.+)$/);
    if (!dateMatch) {
        return null;
    }
    const gameDate = dateMatch[1].trim();

    // Find "Final score: 827" line so trailing user text/emojis do not pollute round parsing
    let finalLineIndex = -1;
    let finalScore = NaN;
    for (let i = 1; i < lines.length; i++) {
        const scoreMatch = lines[i].match(/Final score:\s*(\d+)\b/i);
        if (scoreMatch) {
            finalLineIndex = i;
            finalScore = Number(scoreMatch[1]);
            break;
        }
    }

    if (
        finalLineIndex === -1 ||
        !Number.isSafeInteger(finalScore) ||
        finalScore < 0 ||
        finalScore > MAX_FINAL_SCORE
    ) {
        return null;
    }

    // Extract round scores (1-3 digits not preceded by another digit, followed by an emoji)
    const roundsSection = lines.slice(1, finalLineIndex).join('\n');
    const roundScores: number[] = [];
    const roundPattern = /(?<!\d)(\d{1,3})\s*\p{Extended_Pictographic}/gu;
    let match: RegExpExecArray | null;
    while ((match = roundPattern.exec(roundsSection)) !== null) {
        const roundScore = Number(match[1]);
        if (!Number.isSafeInteger(roundScore) || roundScore < 0 || roundScore > MAX_ROUND_SCORE) {
            return null;
        }
        roundScores.push(roundScore);
        if (roundScores.length > MAX_ROUNDS) {
            return null;
        }
    }

    if (roundScores.length === 0) {
        return null;
    }

    return {
        gameDate,
        roundScores,
        finalScore,
    };
}

export function normalizeGameDate(
    gameDateStr: string,
    timezone: string,
    referenceDate: Date = new Date()
): string | null {
    // Strictly convert "November 11" to "2026-11-11" format
    const match = gameDateStr.trim().match(/^([a-z]+)\s+(\d{1,2})$/i);
    if (!match) {
        return null;
    }

    const monthNum = MONTHS[match[1].toLowerCase()];
    if (!monthNum) {
        return null;
    }

    const dayNum = Number(match[2]);
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
        return null;
    }

    // Determine the correct year
    // If game date is December and current month is January, use previous year
    // If game date is January and current month is December, use next year
    const { year: currentYear, month: currentMonth } = getDatePartsInTimezone(timezone, referenceDate);

    let year = currentYear;
    if (monthNum === 12 && currentMonth === 1) {
        year = currentYear - 1;
    } else if (monthNum === 1 && currentMonth === 12) {
        year = currentYear + 1;
    }

    const candidate = new Date(Date.UTC(year, monthNum - 1, dayNum));
    if (
        candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() !== monthNum - 1 ||
        candidate.getUTCDate() !== dayNum
    ) {
        return null;
    }

    const month = String(monthNum).padStart(2, '0');
    const day = String(dayNum).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
