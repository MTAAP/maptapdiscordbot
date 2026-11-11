# MapTap Discord Score Tracker Bot - Implementation Plan

## Overview
A Discord bot that monitors a specific channel for MapTap game scores (messages starting with "www.maptap.gg"), tracks statistics, and provides daily summaries and leaderboards.

---

## Core Features

### 1. Score Detection & Parsing
- Monitor a configured channel for new messages
- Detect messages starting with `www.maptap.gg`
- Parse the score data from the message content
- Associate scores with Discord user IDs and usernames

### 2. Data Storage
- Store all scores with metadata:
  - User ID & username
  - Score value
  - Timestamp/date
  - Message ID (for reference)

### 3. Daily Statistics
- **Daily Average**: Calculate average score across all players for the day
- **Daily Top 3**: Show top 3 highest scores of the day with usernames
- **Record Breaking**: Detect and highlight when an all-time high score is achieved

### 4. Long-term Statistics
- **Overall Top 3 Average**: Users with the best average scores (minimum games threshold)
- **All-time Top Scores**: Highest individual scores ever recorded
  - Show: score, user, date, and what the daily average was that day
- **Biggest Delta**: Largest positive difference between a user's score and daily average
  - Track both single-game deltas and potentially user's best delta

### 5. Automated Daily Overview
- Scheduled message at midnight (configurable timezone)
- Contents:
  - Daily Top 3 scores
  - Daily average
  - Any records broken that day
  - Brief stats summary

### 6. On-Demand Commands
- `/maptap daily` - Show today's statistics
- `/maptap leaderboard` - Show overall top 3 by average
- `/maptap records` - Show all-time top scores with context
- `/maptap stats [@user]` - Show a specific user's statistics
- `/maptap delta` - Show biggest delta achievements

---

## Technical Architecture

### Technology Stack
```
- Runtime: Node.js (v18+) or Bun
- Discord Library: discord.js v14
- Database: SQLite (simple, file-based, no external dependencies)
- ORM: better-sqlite3 (synchronous, fast) or Drizzle ORM
- Scheduler: node-cron for daily summaries
- Language: TypeScript
```

### Project Structure
```
maptapdiscordbot/
├── src/
│   ├── index.ts              # Entry point, bot initialization
│   ├── config.ts             # Configuration (env vars, constants)
│   ├── bot/
│   │   ├── client.ts         # Discord client setup
│   │   ├── events/
│   │   │   ├── ready.ts      # Bot ready event
│   │   │   └── messageCreate.ts  # Message monitoring
│   │   └── commands/
│   │       ├── index.ts      # Command registration
│   │       ├── daily.ts      # /maptap daily
│   │       ├── leaderboard.ts
│   │       ├── records.ts
│   │       ├── stats.ts
│   │       └── delta.ts
│   ├── database/
│   │   ├── index.ts          # Database connection
│   │   ├── schema.ts         # Table definitions
│   │   └── queries.ts        # Reusable query functions
│   ├── services/
│   │   ├── scoreParser.ts    # Parse MapTap messages
│   │   ├── statistics.ts     # Calculate stats
│   │   └── scheduler.ts      # Cron job for daily summary
│   └── utils/
│       ├── embeds.ts         # Discord embed builders
│       └── formatters.ts     # Number/date formatting
├── .env                      # Environment variables
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

### Database Schema

```sql
-- Scores table: stores every individual score
CREATE TABLE scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,           -- Discord user ID
    username TEXT NOT NULL,          -- Discord username (cached)
    score INTEGER NOT NULL,
    message_id TEXT UNIQUE NOT NULL, -- Prevent duplicates
    recorded_at DATETIME NOT NULL,
    date TEXT NOT NULL               -- YYYY-MM-DD for easy daily grouping
);

-- Daily stats cache (optional, for performance)
CREATE TABLE daily_stats (
    date TEXT PRIMARY KEY,           -- YYYY-MM-DD
    average_score REAL NOT NULL,
    total_games INTEGER NOT NULL,
    top_score INTEGER NOT NULL,
    top_score_user_id TEXT NOT NULL
);

-- Records table: track all-time records
CREATE TABLE records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_type TEXT NOT NULL,       -- 'top_score', 'best_delta', etc.
    user_id TEXT NOT NULL,
    value INTEGER NOT NULL,
    previous_value INTEGER,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_scores_date ON scores(date);
CREATE INDEX idx_scores_user ON scores(user_id);
CREATE INDEX idx_scores_score ON scores(score DESC);
```

---

## Implementation Phases

### Phase 1: Foundation
1. Set up project with TypeScript, discord.js, SQLite
2. Create database schema and connection
3. Implement basic bot connection and event handling
4. Create configuration system (env vars)

### Phase 2: Score Collection
1. Implement message listener for the target channel
2. Create MapTap score parser (regex for www.maptap.gg messages)
3. Store scores in database
4. Add duplicate detection (same message ID)

### Phase 3: Statistics Engine
1. Implement daily statistics calculations
2. Implement all-time statistics
3. Create delta calculations
4. Add record-breaking detection

### Phase 4: Commands
1. Register slash commands with Discord
2. Implement `/maptap daily`
3. Implement `/maptap leaderboard`
4. Implement `/maptap records`
5. Implement `/maptap stats`
6. Implement `/maptap delta`

### Phase 5: Automated Summary
1. Set up node-cron scheduler
2. Create daily summary embed
3. Configure timezone handling
4. Include record announcements

### Phase 6: Polish & Deploy
1. Error handling and logging
2. Rate limiting considerations
3. Graceful shutdown handling
4. Deployment setup (systemd, PM2, or Docker)

---

## Score Parsing Strategy

### Actual Message Format
```
www.maptap.gg November 11
96🏅 93🏆 94🏅 96🔥 54😔
Final score: 827
```

### Parsing Logic
```typescript
interface MapTapScore {
    date: string;           // "November 11"
    roundScores: number[];  // [96, 93, 94, 96, 54]
    finalScore: number;     // 827
}

function parseMapTapMessage(content: string): MapTapScore | null {
    if (!content.startsWith('www.maptap.gg')) return null;

    // Extract date from first line
    const dateMatch = content.match(/www\.maptap\.gg\s+(.+)/);
    const date = dateMatch ? dateMatch[1].trim() : '';

    // Extract final score
    const scoreMatch = content.match(/Final score:\s*(\d+)/);
    if (!scoreMatch) return null;
    const finalScore = parseInt(scoreMatch[1], 10);

    // Extract round scores (numbers before emojis)
    const roundScores = [...content.matchAll(/(\d+)[🏅🏆🔥😔😢😭🎯]/g)]
        .map(m => parseInt(m[1], 10));

    return { date, roundScores, finalScore };
}
```

### Key Insights
- Game can only be played once per day per user
- Each game has 5 rounds with individual scores
- Final score is the sum (max possible: 1000 total, ~200 per round)
- Emojis indicate performance tier per round

---

## Daily Overview Format

```
🗺️ MapTap Daily Summary - November 11, 2026

📊 Today's Stats
• Games Played: 12
• Daily Average: 4,250 pts

🏆 Top 3 Today
1. 🥇 @Player1 - 5,000 pts (+750 above avg)
2. 🥈 @Player2 - 4,800 pts
3. 🥉 @Player3 - 4,600 pts

🆕 Records Broken!
• New All-Time High: 5,000 pts by @Player1!
  (Previous: 4,950 by @OldChamp on Oct 15)

See full stats with /maptap leaderboard
```

---

## Extended Data View (/maptap leaderboard)

```
🗺️ MapTap All-Time Leaderboard

👑 Top 3 by Average Score (min. 10 games)
1. @Player1 - 4,520 avg (45 games)
2. @Player2 - 4,380 avg (32 games)
3. @Player3 - 4,210 avg (28 games)

⭐ All-Time Top Scores
1. 5,000 pts - @Player1 (Nov 11) [Avg: 4,250]
2. 4,950 pts - @Player2 (Oct 15) [Avg: 4,100]
3. 4,900 pts - @Player3 (Sep 22) [Avg: 4,050]

📈 Biggest Deltas (Score vs Daily Avg)
1. +1,200 - @Player1 (Oct 3)
2. +1,150 - @Player4 (Nov 1)
3. +1,050 - @Player2 (Aug 15)
```

---

## Configuration Requirements

```env
# .env file
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
GUILD_ID=your_server_id
CHANNEL_ID=channel_to_monitor
SUMMARY_CHANNEL_ID=channel_for_daily_summaries (optional, same as above if not set)
TIMEZONE=Europe/Amsterdam
SUMMARY_HOUR=0  # Midnight
MIN_GAMES_FOR_AVERAGE=5  # Minimum games to appear on average leaderboard
```

---

## Configuration

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
GUILD_ID=your_server_id
CHANNEL_ID=channel_to_monitor
TIMEZONE=Europe/Amsterdam
SUMMARY_HOUR=0  # Midnight
```

---

## Hosting Options

### Option 1: Your Mac (Free, Recommended for Starting)
**Pros:**
- Free, you already have it
- Full control, easy to debug
- No external dependencies

**Cons:**
- Mac needs to stay on 24/7
- Uses power/resources
- If Mac sleeps or restarts, bot goes offline

**Setup:** Use `launchd` (macOS native) or PM2 to auto-start the bot on boot and keep it running.

### Option 2: Railway.app (Free Tier Available)
**Pros:**
- Free tier: 500 hours/month (enough for ~20 days continuous)
- Easy deployment via GitHub
- No server management

**Cons:**
- Free tier limited, may need to pause bot occasionally or pay $5/month for hobby tier
- Cold starts if using free tier tricks

### Option 3: Fly.io (Free Tier)
**Pros:**
- Generous free tier (3 shared VMs)
- Persistent volumes for SQLite
- Good for always-on bots

**Cons:**
- Slightly more complex setup
- Free tier requires credit card on file

### Option 4: Oracle Cloud Free Tier (Always Free)
**Pros:**
- Actually free forever (ARM instances)
- Full Linux VM, very capable
- 24GB RAM, 4 cores available

**Cons:**
- More complex initial setup
- Oracle account required
- Occasional availability issues in some regions

### Option 5: Raspberry Pi (One-time Cost ~$50-80)
**Pros:**
- Low power consumption
- Always on, dedicated hardware
- Full control, no recurring costs

**Cons:**
- Upfront hardware cost
- Need to manage yourself
- Relies on your home internet

---

### Recommendation

**Start with your Mac** while developing and testing. Once stable:
- **Easiest free long-term:** Fly.io or Oracle Cloud Free Tier
- **Simplest paid option:** Railway.app at $5/month
- **Best set-and-forget:** Raspberry Pi if you want local control

---

## Next Steps

Ready to implement! Order of development:
1. Initialize project with TypeScript + discord.js + SQLite
2. Set up database schema
3. Create the score parser
4. Implement message monitoring
5. Build statistics calculations
6. Add slash commands
7. Set up the daily scheduler
8. Create deployment scripts for your Mac
