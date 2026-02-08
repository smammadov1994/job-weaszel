# Job Weaszel

Automated job application system that searches and applies to Software Engineering roles across Indeed, LinkedIn, Glassdoor, and ZipRecruiter. Powered by [OpenClaw](https://openclaw.dev) as the AI agent gateway, running in a Docker container with a real Chrome browser profile to avoid bot detection.

## How It Works

1. **Agent searches** for matching jobs across enabled platforms on a cron schedule
2. **Agent applies** by filling out forms, uploading your resume, and generating tailored cover letters
3. **CAPTCHAs** are auto-solved via 2Captcha, with a manual WhatsApp fallback if needed
4. **Every application** is logged to SQLite and visible in the admin dashboard
5. **WhatsApp notifications** keep you updated: batch summaries, failures, CAPTCHAs needing help, daily reports

## Quick Start

```bash
git clone https://github.com/smammadov1994/job-weaszel.git
cd job-weaszel/wizard
npm install
node index.mjs
```

The wizard walks you through everything:
- Entering your API keys
- Setting up your profile and job preferences
- Copying your resume
- Building and launching the Docker container
- Logging into job platforms via noVNC

## Prerequisites

- **Docker** and **Docker Compose** (v2)
- **Anthropic API key** for Claude (used by OpenClaw)
- **2Captcha API key** (optional, for auto-solving CAPTCHAs)
- **WhatsApp** on your phone (optional, for notifications)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Docker Container (job-weaszel)                          │
│                                                          │
│  ┌──────────┐   CDP    ┌───────────────────────┐        │
│  │ OpenClaw ├─────────►│ Chrome (real profile) │        │
│  │ Gateway  │          │ on Xvfb :99           │        │
│  └────┬─────┘          └───────────┬───────────┘        │
│       │                            │                    │
│  ┌────┴─────┐              ┌───────┴──────┐             │
│  │  Plugin  │              │ x11vnc/noVNC │             │
│  │ (SQLite, │              │  (port 6080) │             │
│  │  2Captcha│              └──────────────┘             │
│  │  Dashboard)                                          │
│  └──────────┘                                           │
│                                                          │
│  Managed by supervisord                                  │
└──────────────────────────────┬───────────────────────────┘
                               │ WhatsApp
                               ▼
                         Your Phone
```

**Key anti-detection measures:**
- Real Google Chrome (not Chromium) with a persistent user profile
- No `--headless` flag — uses Xvfb virtual display instead
- `--disable-blink-features=AutomationControlled` removes `navigator.webdriver`
- Human-like delays (2-8s), natural scrolling, and rate-limited applications (max 30/platform/day)

## Project Structure

```
job-weaszel/
├── Dockerfile                # All-in-one container (Chrome, noVNC, OpenClaw)
├── docker-compose.yml        # Ports, volumes, healthcheck
├── docker-entrypoint.sh      # Env var injection, permission fixes
├── supervisord.conf          # Process manager for 6 services
│
├── wizard/
│   ├── index.mjs             # Interactive setup CLI
│   ├── package.json
│   └── templates/            # Config templates used by wizard
│
├── openclaw/
│   ├── openclaw.json         # OpenClaw gateway config
│   └── workspace/
│       ├── AGENTS.md         # Agent persona & operating rules
│       ├── SOUL.md           # Behavioral rules
│       ├── USER.md           # Your profile
│       └── skills/           # Job search, apply, captcha skills
│
├── plugin/
│   ├── openclaw.plugin.json  # Plugin manifest
│   ├── package.json
│   └── src/                  # Dashboard, tools, DB, captcha
│
├── data/
│   ├── profile.json          # Search criteria & platform config
│   └── resume.pdf            # Your resume (gitignored)
│
├── infra/legacy/             # AWS EC2 deployment scripts (advanced)
├── .env.example
└── .gitignore
```

## Manual Setup (Without Wizard)

If you prefer to configure things manually:

1. Copy `.env.example` to `.env` and fill in your keys
2. Edit `openclaw/workspace/USER.md` with your profile
3. Edit `data/profile.json` with your job search criteria
4. Place your resume at `data/resume.pdf`
5. Build and run:

```bash
docker compose build
docker compose up -d
```

6. Open `http://localhost:6080/vnc.html` and log into job platforms
7. Access the dashboard at `http://localhost:18789/plugins/job-dashboard/`

## Useful Commands

```bash
# View logs
docker compose logs -f

# Stop
docker compose down

# Restart
docker compose up -d

# Rebuild after changes
docker compose build && docker compose up -d

# Shell into container
docker exec -it job-weaszel bash

# Check Chrome CDP
docker exec job-weaszel curl -s http://localhost:9222/json/version

# Check OpenClaw health
docker exec job-weaszel curl -s http://localhost:18789/health
```

## Dashboard

Access the admin dashboard at `http://localhost:18789/plugins/job-dashboard/`

The dashboard shows:
- **Summary cards** — total applied, today's count, success rate, platform breakdown
- **Daily chart** — bar chart of applications per day (last 30 days)
- **Applications table** — sortable, filterable list with status badges
- **Activity log** — real-time feed of agent actions

## Advanced: AWS EC2 Deployment

The original AWS deployment scripts are preserved in `infra/legacy/`. See the scripts for details:

- `infra/legacy/deploy.sh` — Creates VPC, security group, EC2 instance
- `infra/legacy/setup-ec2.sh` — Installs everything on the EC2 instance
- `infra/legacy/teardown.sh` — Deletes all AWS resources

## Cost Estimate (Docker / local)

| Resource | Cost |
|---|---|
| Docker | Free |
| Anthropic API (Claude) | ~$5-20/month depending on usage |
| 2Captcha | ~$3 per 1000 CAPTCHAs |

## License

MIT
