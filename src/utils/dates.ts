export interface CalendarDateParts {
    year: number;
    month: number;
    day: number;
}

export function getDatePartsInTimezone(
    timezone: string,
    referenceDate: Date = new Date()
): CalendarDateParts {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(referenceDate);

    const year = Number(parts.find(p => p.type === 'year')?.value);
    const month = Number(parts.find(p => p.type === 'month')?.value);
    const day = Number(parts.find(p => p.type === 'day')?.value);

    return { year, month, day };
}

export function formatUtcDate(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function getTodayDate(timezone: string, now: Date = new Date()): string {
    const { year, month, day } = getDatePartsInTimezone(timezone, now);
    return formatUtcDate(new Date(Date.UTC(year, month - 1, day)));
}

export function getYesterdayDate(timezone: string, now: Date = new Date()): string {
    const { year, month, day } = getDatePartsInTimezone(timezone, now);
    return formatUtcDate(new Date(Date.UTC(year, month - 1, day - 1)));
}

export function getCurrentWeekDateRange(
    timezone: string,
    now: Date = new Date()
): { startDate: string; endDate: string } {
    const { year, month, day } = getDatePartsInTimezone(timezone, now);
    const todayUtc = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = todayUtc.getUTCDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const mondayUtc = new Date(Date.UTC(year, month - 1, day - daysToMonday));
    const sundayUtc = new Date(Date.UTC(year, month - 1, day - daysToMonday + 6));

    return {
        startDate: formatUtcDate(mondayUtc),
        endDate: formatUtcDate(sundayUtc),
    };
}

export function getLastWeekDateRange(
    timezone: string,
    now: Date = new Date()
): { startDate: string; endDate: string } {
    const { year, month, day } = getDatePartsInTimezone(timezone, now);
    const yesterdayUtc = new Date(Date.UTC(year, month - 1, day - 1));
    const dayOfWeek = yesterdayUtc.getUTCDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const mondayUtc = new Date(
        Date.UTC(
            yesterdayUtc.getUTCFullYear(),
            yesterdayUtc.getUTCMonth(),
            yesterdayUtc.getUTCDate() - daysToMonday
        )
    );
    const sundayUtc = new Date(
        Date.UTC(
            mondayUtc.getUTCFullYear(),
            mondayUtc.getUTCMonth(),
            mondayUtc.getUTCDate() + 6
        )
    );

    return {
        startDate: formatUtcDate(mondayUtc),
        endDate: formatUtcDate(sundayUtc),
    };
}
