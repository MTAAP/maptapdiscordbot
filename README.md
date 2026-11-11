# Mappy - MapTap Discord Score Tracker

A Discord bot that tracks MapTap geography game scores, provides daily summaries, and maintains leaderboards.

## Features

- **Automatic Score Detection**: Monitors a channel for MapTap score messages (starting with `www.maptap.gg`)
- **Daily Statistics**: Average scores, top 3 players
- **All-Time Leaderboards**: Best averages, highest scores, biggest deltas
- **Record Tracking**: Announces when all-time high scores are broken
- **Daily Summary**: Automated midnight recap of the day's games

## Commands

- `/maptap daily` - Show today's statistics
- `/maptap leaderboard` - Show all-time leaderboard
- `/maptap records` - Show top 10 all-time scores
- `/maptap stats [@user]` - Show stats for a user
- `/maptap delta` - Show biggest deltas (score vs daily average)

## Setup

### 1. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and name it **Mappy**
3. Go to "Bot" section and click "Add Bot"
4. Copy the bot token
5. Enable these Privileged Gateway Intents:
   - Message Content Intent
6. Go to OAuth2 → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Add Reactions`, `Use Slash Commands`
7. Use the generated URL to invite the bot to your server

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:
```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_bot_client_id
GUILD_ID=your_server_id
CHANNEL_ID=channel_to_monitor
TIMEZONE=Europe/Amsterdam
SUMMARY_HOUR=0
```

To find IDs:
- Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
- Right-click server → Copy Server ID
- Right-click channel → Copy Channel ID

### 3. Install & Run

```bash
# Install dependencies
npm install

# Deploy slash commands (run once, or when commands change)
npm run deploy-commands

# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

## Deployment

Pushes to `master` run `.github/workflows/build-and-deploy.yml` on GitHub Actions (`ubuntu-latest`). After typechecking and building in `ci.yml`, the workflow publishes `ghcr.io/mtaap/maptapdiscordbot:master` and triggers a stop-then-start deployment on Coolify (`free-fsn1-01`).

Runtime configuration comes from Infisical EU (`maptapdiscordbot`, environment `prod`, folder `/app`), and SQLite persists on the `/data` volume (`DATABASE_PATH=/data/maptap.db`). On startup the bot registers guild slash commands and backfills channel score history if the database is empty.

## Score Format

The bot detects messages starting with `www.maptap.gg`:

```
www.maptap.gg November 11
96🏅 93🏆 94🏅 96🔥 54😔
Final score: 827
```

When a valid score is detected, the bot:
1. Reacts with ✅ to confirm
2. Stores the score in the database
3. Announces if it's a new all-time record

## Database

SQLite database stored in `maptap.db`. Contains:
- `scores` - All individual game scores
- `records` - Record-breaking achievements

## License

MIT
