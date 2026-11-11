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

    // Extract round scores (numbers followed by emojis)
    // Handles: 🏅🏆🔥😔😢😭🎯 and potentially others
    const roundScores: number[] = [];
    const roundPattern = /(\d+)\s*[🏅🏆🔥😔😢😭🎯⭐💯🥇🥈🥉]/g;
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

export function normalizeGameDate(gameDateStr: string, timezone: string): string {
    // Convert "November 11" to "2026-11-11" format
    // Assume current year if not provided
    const currentYear = new Date().toLocaleDateString('en-CA', { timeZone: timezone, year: 'numeric' }).split('-')[0];

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

    return `${currentYear}-${month}-${day}`;
}
