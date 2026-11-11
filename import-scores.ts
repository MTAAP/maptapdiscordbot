import Database from 'better-sqlite3';

const db = new Database('./maptap.db');

// Scores to import
const scores = [
    // November 10 (Yesterday)
    { username: 'DocteurGui', visibleName: 'Gecko', score: 941, rounds: [100, 100, 93, 88, 97], date: '2026-11-10' },
    { username: 'panic', visibleName: 'panic', score: 942, rounds: [100, 98, 87, 94, 96], date: '2026-11-10' },
    { username: 'Grissom', visibleName: '1/4 Mile', score: 973, rounds: [100, 100, 97, 94, 99], date: '2026-11-10' },
    { username: 'Toby', visibleName: 'Bathtub', score: 947, rounds: [100, 100, 93, 93, 94], date: '2026-11-10' },
    { username: 'ElTonio', visibleName: 'Cyclops', score: 912, rounds: [100, 100, 92, 86, 90], date: '2026-11-10' },
    { username: 'Peekaboo', visibleName: 'Jackass', score: 953, rounds: [100, 100, 93, 96, 93], date: '2026-11-10' },

    // November 11 (Today)
    { username: 'DocteurGui', visibleName: 'Gecko', score: 710, rounds: [99, 95, 96, 91, 17], date: '2026-11-11' },
    { username: 'panic', visibleName: 'panic', score: 735, rounds: [97, 99, 97, 100, 15], date: '2026-11-11' },
    { username: 'VELTRO3Davide', visibleName: 'Gordon', score: 807, rounds: [96, 97, 94, 100, 42], date: '2026-11-11' },
    { username: 'Peekaboo', visibleName: 'Jackass', score: 956, rounds: [93, 92, 96, 95, 98], date: '2026-11-11' },
    { username: 'Toby', visibleName: 'Bathtub', score: 883, rounds: [98, 95, 93, 95, 73], date: '2026-11-11' },
    { username: 'Grissom', visibleName: '1/4 Mile', score: 982, rounds: [93, 96, 98, 99, 100], date: '2026-11-11' },
    { username: 'ElTonio', visibleName: 'Cyclops', score: 920, rounds: [97, 96, 95, 92, 87], date: '2026-11-11' },
    { username: 'Activity', visibleName: 'Timemachine', score: 827, rounds: [96, 93, 94, 96, 54], date: '2026-11-11' },
];

const stmt = db.prepare(`
    INSERT OR IGNORE INTO scores (user_id, username, score, round_scores, game_date, message_id, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

let imported = 0;
for (const s of scores) {
    // Use username as a fake user_id for imported data (we don't have real Discord IDs)
    const result = stmt.run(
        `imported_${s.username.toLowerCase()}`,
        `${s.visibleName} (${s.username})`,
        s.score,
        JSON.stringify(s.rounds),
        s.date,
        `imported_${s.username}_${s.date}`,
        new Date().toISOString()
    );
    if (result.changes > 0) {
        imported++;
        console.log(`✅ Imported: ${s.visibleName} - ${s.score} pts (${s.date})`);
    } else {
        console.log(`⏭️  Skipped (already exists): ${s.visibleName} - ${s.date}`);
    }
}

console.log(`\n📊 Imported ${imported} scores`);
db.close();
