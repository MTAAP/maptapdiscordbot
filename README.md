# Mappy: MapTap Discord Score Tracker

A Discord bot that tracks MapTap geography game scores, posts daily and weekly summaries, and maintains server leaderboards.

## Features

- **Automatic Score Detection**: Monitors a channel for MapTap score messages (`www.maptap.gg`, `https://maptap.gg`, or `MapTap <Month> <Day>`, including flag-prefixed round scores)
- **Daily and Weekly Summaries**: Automated daily recap at `SUMMARY_HOUR:00` and Monday weekly recap at `SUMMARY_HOUR:05` in `TIMEZONE`
- **Regional Standings and Passports**: Syncs daily challenge locations from `maptap.gg` and ranks players by UN M49 continent, subregion, and country
- **Daily `local-smart` Challenger**: Optional headless Chromium player that navigates `maptap.gg/?letmeplay=1` using only screenshots and keyboard controls (`WASD`, `QE`, `Shift`, `Space`), shows a spoiler-free daytime benchmark, and attaches an animated replay GIF to the `SUMMARY_HOUR:00` recap on days with recorded games (or on demand via `/maptap llm`)
- **All-Time Leaderboards**: Best averages, highest scores, worst scores, per-round breakdowns, and biggest daily deltas
- **Record Tracking**: Announces when all-time high scores are broken

## Commands

- `/maptap daily`: Show today's statistics and spoiler-free `local-smart` benchmark
- `/maptap weekly`: Show the current Monday-to-Sunday standings
- `/maptap leaderboard`: Show the all-time leaderboard
- `/maptap records`: Show top 10 all-time scores
- `/maptap worst`: Show the 10 lowest scores recorded
- `/maptap allplayers`: Show all players ranked by average score
- `/maptap fullstats`: Show mean, median, standard deviation, and per-round stats
- `/maptap stats [@user]`: Show stats and geography snapshot for a user (defaults to you)
- `/maptap region [area] [min_rounds]`: Show World Crowns or standings for a continent, subregion, or country
- `/maptap passport [@user]`: Show a user's strongest subregions, blind spots, and best countries
- `/maptap llm [date]`: Show human vs. `local-smart` head-to-head records and today's spoiler-free `Round 1` to `Round 5` breakdown, or reveal a completed past date's round locations, monologues, and replay GIF
- `/maptap delta`: Show biggest deltas (score vs daily average)
- `/maptap import`: Backfill historical scores from channel history since 2024-01-01 (Administrator only)

## Setup

### 1. Create Discord Bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and name it **Mappy**
3. Open the "Bot" section, add a bot user, and copy the bot token (use a separate application and guild for local development so local sessions do not share the production token)
4. Enable the **Message Content Intent** under Privileged Gateway Intents
5. Open OAuth2 -> URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Add Reactions`, `Use Slash Commands`
6. Invite the bot to your Discord server with the generated URL

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
# Optional: separate channel for daily and weekly summaries (defaults to CHANNEL_ID)
# SUMMARY_CHANNEL_ID=channel_for_summaries
TIMEZONE=Europe/Amsterdam
SUMMARY_HOUR=0
DATABASE_PATH=./maptap.db
# Optional: SVPG Inference Gateway key for the daily headless Chromium local-smart player
# SVPG_API_KEY=your_svpg_gateway_key
# LLM_REASONING_EFFORT=low
```

To find Discord IDs:
- Enable Developer Mode in Discord (Settings -> Advanced -> Developer Mode)
- Right-click the server -> Copy Server ID
- Right-click the channel -> Copy Channel ID

### 3. Install, Test, and Run

`.npmrc` enforces `min-release-age=2` (48-hour minimum package age) and `ignore-scripts=true`.

```bash
# Install dependencies (lifecycle scripts disabled)
npm ci --ignore-scripts

# Verify lockfile release age, typecheck, and run tests
npm run check:lockfile -- --all
npm test

# Development (with hot reload; guild slash commands sync automatically on startup)
npm run dev

# Optional: register slash commands without starting the bot
npm run deploy-commands

# Production
npm run build
npm start
```

## Deployment

Pushes to `master` run `.github/workflows/build-and-deploy.yml` on GitHub Actions (`ubuntu-latest`). After `ci.yml` verifies lockfile package ages, typechecks, and runs tests, the workflow publishes the private image `ghcr.io/mtaap/maptapdiscordbot:master` and triggers Coolify's per-app HMAC-signed GitHub webhook on `free-fsn1-01` (`custom_internal_name: maptapdiscordbot`, running as non-root `node` on an isolated bridge network).

GitHub Actions configuration:
- Variables: `DEPLOY_ENABLED` (`true`), `IMAGE_NAME` (`ghcr.io/mtaap/maptapdiscordbot`), `RUNNER` (`ubuntu-latest`)
- Secret: `COOLIFY_WEBHOOK_SECRET` (backed up in Infisical EU project `maptapdiscordbot`, environment `prod`, folder `/ci`)

Runtime configuration is synced by Coolify from Infisical EU (`maptapdiscordbot`, environment `prod`, folder `/app`), and SQLite persists on `/data` (`DATABASE_PATH=/data/maptap.db`). On first boot the bot registers guild slash commands, backfills channel history since 2024-01-01, seeds the baseline high-score record, and marks `meta.initial_backfill_complete`. Daily hot SQLite backups run on `free-fsn1-01` via `maptap-sqlite-backup.timer` (`/var/backups/maptap`, 14-day retention) alongside Hetzner's nightly VM snapshot.

## Score Format

The bot detects messages starting with `www.maptap.gg`:

```text
www.maptap.gg November 11
96🏅 93🏆 94🏅 96🔥 54😔
Final score: 827
```

When a valid score is detected, the bot:
1. Inserts the score into SQLite (`UNIQUE(user_id, game_date)`)
2. Announces if it sets a new all-time high score
3. Reacts with ✅ to confirm

## Database

SQLite database stored at `DATABASE_PATH` (`./maptap.db` locally, `/data/maptap.db` in Docker):
- `scores`: Individual human daily game scores
- `records`: All-time record-breaking achievements
- `daily_challenges`: Synced 5-round daily challenge locations and ISO/UN M49 geography tags
- `llm_daily_runs`: Separate `local-smart` daily runs, round monologues, token counts, and replay GIF paths (`replays/<YYYY-MM-DD>.gif`, pruned past 30 days on each daily run)
- `meta`: Operational state markers (`initial_backfill_complete`)

## License

ISC
