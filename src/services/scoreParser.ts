export interface ParsedMapTapScore {
    gameDate: string;
    roundScores: number[];
    finalScore: number;
}

export function parseMapTapMessage(content: string): ParsedMapTapScore | null {
    if (!content.startsWith('www.maptap.gg')) {
        return null;
    }

    const lines = content.split('\n');
    if (lines.length < 3) {
        return null;
    }

    // Extract date from first line: "www.maptap.gg November 11"
    const dateMatch = lines[0].match(/www\.maptap\.gg\s+(.+)/);
    if (!dateMatch) {
        return null;
    }
    const gameDate = dateMatch[1].trim();

    // Extract final score from last relevant line: "Final score: 827"
    const scoreMatch = content.match(/Final score:\s*(\d+)/i);
    if (!scoreMatch) {
        return null;
    }
    const finalScore = parseInt(scoreMatch[1], 10);

    // Extract round scores (numbers followed by any emoji)
    // Match numbers followed by emoji - uses Unicode emoji range
    const roundScores: number[] = [];
    // This pattern matches digits followed by any emoji (using Unicode property)
    const roundPattern = /(\d+)\s*[\u{1F300}-\u{1F9FF}]/gu;
    let match;
    while ((match = roundPattern.exec(content)) !== null) {
        roundScores.push(parseInt(match[1], 10));
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
): string {
    // Convert "November 11" to "2026-11-11" format
    const months: Record<string, string> = {
        'january': '01', 'february': '02', 'march': '03', 'april': '04',
        'may': '05', 'june': '06', 'july': '07', 'august': '08',
        'september': '09', 'october': '10', 'november': '11', 'december': '12'
    };

    const parts = gameDateStr.toLowerCase().split(/\s+/);
    if (parts.length < 2) {
        return gameDateStr;
    }

    const month = months[parts[0]];
    const day = parts[1].padStart(2, '0');

    if (!month) {
        return gameDateStr;
    }

    // Determine the correct year
    // If game date is December and current month is January, use previous year
    // If game date is January and current month is December, use next year
    const currentMonth = referenceDate.toLocaleDateString('en-CA', { timeZone: timezone, month: '2-digit' });
    const currentYear = parseInt(referenceDate.toLocaleDateString('en-CA', { timeZone: timezone, year: 'numeric' }), 10);

    let year = currentYear;
    if (month === '12' && currentMonth === '01') {
        year = currentYear - 1;
    } else if (month === '01' && currentMonth === '12') {
        year = currentYear + 1;
    }

    return `${year}-${month}-${day}`;
}
