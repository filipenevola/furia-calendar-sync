# FURIA Calendar Sync 🎮

Automatically sync FURIA CS matches to your Google Calendar.

## Features

- 🌐 **Web Dashboard** - Simple UI to view sync status and trigger manual syncs
- 📊 **Enhanced Logging** - Detailed logs with Slack error notifications
- 🔄 **Daily Automatic Sync** - Runs automatically every day using in-app cron scheduling
- 📅 Creates/updates Google Calendar events
- 🎯 Shows match format (MD3, MD5)
- 📺 Shows stream info when available
- ⏰ 1-hour and 15-minute reminders
- 🏆 Covers all tournaments (Majors, IEM, PGL, ESL, etc.)

## Data Source

The app fetches match data from [draft5.gg](https://draft5.gg/equipe/330-FURIA), a Brazilian CS esports coverage site. No API key required - data is extracted from server-rendered pages.

## Setup

### 1. Google Calendar Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Google Calendar API**
4. Go to **IAM & Admin > Service Accounts**
5. Create a service account
6. Create a JSON key and download it
7. Base64 encode the JSON: `base64 -i service-account.json`
8. Add as GitHub secret: `GOOGLE_CREDENTIALS`

### 2. Share Calendar with Service Account

1. Open Google Calendar
2. Go to calendar settings
3. Under "Share with specific people", add the service account email
4. Give it "Make changes to events" permission
5. Copy the calendar ID (for your primary calendar, use your email)
6. Add as GitHub secret: `GOOGLE_CALENDAR_ID`

### 3. Quave Cloud Deployment

The app is configured to deploy automatically to Quave Cloud via GitHub Actions.

1. Add your Quave Cloud environment token as a GitHub secret:
   - Go to your repository **Settings** > **Secrets and variables** > **Actions**
   - Click **New repository secret**
   - Name: `QUAVE_CLOUD_ENV_TOKEN`
   - Value: Your environment token (get it from [Quave Cloud](https://app.quave.cloud))
2. The GitHub Actions workflow will automatically deploy when you push to `main`
3. App environment: `filipenevola-furia-calendar-sync-production`

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `GOOGLE_CREDENTIALS` | Base64 encoded service account JSON |
| `GOOGLE_CALENDAR_ID` | Google Calendar ID (or `primary`) |
| `SLACK_ERROR_WEBHOOK` | Slack webhook URL for error notifications (optional) |
| `CRON_SCHEDULE` | Cron schedule for daily sync (default: `"0 2 * * *"` = 2 AM UTC daily) |
| `QUAVE_CLOUD_ENV_TOKEN` | Quave Cloud environment token (required for deployment) |

## How It Works

1. The app runs on Quave Cloud and syncs FURIA CS matches to your Google Calendar
2. **Automatic Daily Sync**: Runs every day at 2 AM UTC (configurable via `CRON_SCHEDULE` env var)
3. Fetches upcoming FURIA matches from draft5.gg
4. Creates/updates events in your Google Calendar
5. Each event includes:
   - Match title with opponent and format
   - Tournament/competition name
   - Venue information (LAN or Online)
   - Stream info when available
   - Automatic reminders

### Deployment

- **Automatic**: Pushing to `main` branch triggers deployment via GitHub Actions
- **Manual**: Use the "Run workflow" button in the GitHub Actions tab

## Web Dashboard

Once deployed, the app includes a web dashboard accessible at your app's URL:

- **View Status**: See the latest sync run details
- **Trigger Sync**: Click the button to manually trigger a new sync
- **Auto-refresh**: Status updates every 10 seconds

The dashboard is available at the root URL of your deployed app (e.g., `https://furia.filipenevola.com/`).

## Local Development

This project uses [Bun](https://bun.sh) for fast JavaScript runtime and package management.

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Set environment variables
export GOOGLE_CREDENTIALS="base64-encoded-credentials"
export GOOGLE_CALENDAR_ID="your-calendar-id"
export SLACK_ERROR_WEBHOOK="https://hooks.slack.com/services/..."  # Optional
export CRON_SCHEDULE="0 2 * * *"  # Optional (default: 2 AM UTC daily)

# Start the web server (includes dashboard)
bun run start

# The server will be available at http://localhost:3000
# API endpoints:
# - GET /api/status - Get latest sync status
# - POST /api/sync - Trigger a new sync
# - GET /health - Health check endpoint
```

## License

MIT

---

🎮 GO FURIA! 🎮
