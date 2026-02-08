# Job Weaszel

Automated job application system that searches and applies to Software Engineering roles across LinkedIn, Indeed, Glassdoor, and ZipRecruiter. Powered by [OpenClaw](https://openclaw.dev) as the AI agent gateway, running on a locked-down AWS EC2 instance with a real Chrome browser profile to avoid bot detection.

## How It Works

1. **Agent searches** for matching jobs across all four platforms on a cron schedule
2. **Agent applies** by filling out forms, uploading your resume, and generating tailored cover letters
3. **CAPTCHAs** are auto-solved via 2Captcha, with a manual WhatsApp fallback if needed
4. **Every application** is logged to SQLite and visible in the admin dashboard
5. **WhatsApp notifications** keep you updated: batch summaries, failures, CAPTCHAs needing help, daily reports

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  AWS EC2 (t3.large)                                     │
│                                                         │
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
│                                                         │
└──────────────────────────┬──────────────────────────────┘
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
job-apply/
├── infra/
│   ├── deploy.sh              # AWS deployment orchestrator
│   ├── teardown.sh            # Clean up all AWS resources
│   ├── setup-ec2.sh           # Runs ON the EC2 instance after launch
│   └── config.env.example     # Template for secrets & AWS config
│
├── openclaw/
│   ├── openclaw.json          # OpenClaw gateway config (browser, WhatsApp, plugins)
│   └── workspace/
│       ├── AGENTS.md          # Agent persona & operating rules
│       ├── SOUL.md            # Behavioral rules (human-like browsing, honesty)
│       ├── USER.md            # Your profile — fill this in before deploying
│       └── skills/
│           ├── job-search/SKILL.md    # How to search each platform
│           ├── job-apply/SKILL.md     # How to fill & submit applications
│           └── captcha-solve/SKILL.md # CAPTCHA detection & resolution flow
│
├── plugin/
│   ├── openclaw.plugin.json   # Plugin manifest
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # Plugin entry — registers tools + HTTP routes
│       ├── db.ts              # SQLite schema & queries (sql.js)
│       ├── captcha.ts         # 2Captcha API integration
│       └── dashboard/
│           ├── routes.ts      # REST API for dashboard data
│           └── ui/index.html  # Single-page admin dashboard
│
├── data/
│   ├── profile.json           # Search criteria & platform config
│   └── resume.pdf             # Your resume (gitignored)
│
├── .env.example
└── .gitignore
```

## Prerequisites

- **AWS account** with CLI configured (`aws configure`)
- **Anthropic API key** for Claude (used by OpenClaw)
- **2Captcha API key** (optional, for auto-solving CAPTCHAs)
- **WhatsApp** on your phone (for notifications and manual CAPTCHA fallback)
- Node.js 18+ locally (only needed if building the plugin locally)

## Setup

### 1. Clone & Configure

```bash
git clone https://github.com/smammadov1994/job-weaszel.git
cd job-weaszel

# Copy config templates
cp infra/config.env.example infra/config.env
cp .env.example .env

# Edit with your values
nano infra/config.env
```

Required values in `config.env`:
| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `TWOCAPTCHA_API_KEY` | 2Captcha API key (optional) |
| `WHATSAPP_ALLOW_FROM` | Your phone number in E.164 format (e.g. `+15551234567`) |

Auto-detected/generated values (leave blank):
| Variable | Description |
|---|---|
| `MY_IP` | Your public IP (auto-detected via `checkip.amazonaws.com`) |
| `EC2_AMI` | Ubuntu 24.04 AMI (auto-detected for your region) |
| `OPENCLAW_GATEWAY_TOKEN` | Random 64-char auth token (auto-generated) |

### 2. Fill In Your Profile

Edit `openclaw/workspace/USER.md` with your:
- Name, email, phone, location
- Target roles and salary range
- Skills and experience
- Work authorization status

Edit `data/profile.json` to customize:
- Search queries and locations
- Platform-specific settings (enable/disable, daily limits)
- Keyword filters and excluded companies

### 3. Add Your Resume

```bash
cp /path/to/your/resume.pdf data/resume.pdf
```

### 4. Deploy to AWS

```bash
bash infra/deploy.sh
```

This creates:
- VPC with public subnet
- Security group (SSH + noVNC locked to your IP)
- EC2 t3.large instance (2 vCPU, 8GB RAM, 30GB disk)
- Elastic IP
- All software installed and configured via user-data

The script outputs your SSH command and noVNC URL when done.

### 5. Log Into Job Platforms

1. Open noVNC in your browser: `http://<elastic-ip>:6080`
2. You'll see Chrome running on the virtual desktop
3. Manually log into each platform:
   - [linkedin.com](https://linkedin.com)
   - [indeed.com](https://indeed.com)
   - [glassdoor.com](https://glassdoor.com)
   - [ziprecruiter.com](https://ziprecruiter.com)
4. Your sessions are saved in Chrome's persistent profile

### 6. Connect WhatsApp

```bash
ssh -i infra/job-apply-key.pem ubuntu@<elastic-ip>

# On the EC2 instance:
openclaw channels login
```

Scan the QR code with your phone (WhatsApp > Linked Devices > Link a Device).

### 7. Start the Agent

```bash
# On the EC2 instance:
sudo systemctl start openclaw
sudo systemctl status openclaw
```

### 8. Set Up Cron Schedules

```bash
# Search and apply every 4 hours on weekdays
openclaw cron add --schedule "0 9,13,17 * * 1-5" \
  "Search for new Software Engineering jobs and apply to the top matches. Check memory to avoid duplicates. Send me a WhatsApp summary when done."

# Daily summary at 8 PM
openclaw cron add --schedule "0 20 * * *" \
  "Send me a daily summary via WhatsApp: how many jobs applied to today, any failures, any CAPTCHAs that needed manual solving, and notable companies."
```

## Admin Dashboard

Access the dashboard via SSH tunnel (it's not exposed to the internet):

```bash
ssh -L 8080:127.0.0.1:18789 -i infra/job-apply-key.pem ubuntu@<elastic-ip>
```

Then open [http://localhost:8080/plugins/job-dashboard/](http://localhost:8080/plugins/job-dashboard/)

The dashboard shows:
- **Summary cards** — total applied, today's count, success rate, platform breakdown
- **Daily chart** — bar chart of applications per day (last 30 days)
- **Applications table** — sortable, filterable list with status badges
- **Activity log** — real-time feed of agent actions
- **Screenshot viewer** — click any application to see its submission screenshot

## Plugin Tools

The OpenClaw agent has access to these tools:

| Tool | Description |
|---|---|
| `log_application` | Log an application attempt with platform, company, title, URL, status, notes, screenshot |
| `check_applied` | Check if a job URL or company+title combo has already been applied to |
| `solve_captcha` | Send a reCAPTCHA v2 or hCaptcha to 2Captcha for solving |
| `get_daily_stats` | Get today's application counts (attempted, applied, failed, skipped) |

## Skills

| Skill | Invocable | Description |
|---|---|---|
| `job-search` | Yes | Searches all four platforms with filters, extracts listings, deduplicates |
| `job-apply` | Yes | Fills forms, uploads resume, generates cover letters, takes screenshots |
| `captcha-solve` | No (auto-triggered) | Detects CAPTCHAs, tries 2Captcha, falls back to WhatsApp |

## Agent Behavior

Defined in `AGENTS.md` and `SOUL.md`:

- **Human-like browsing** — random 2-8s delays, natural scrolling, mouse movement before clicks
- **Rate limited** — max 30 applications/platform/day, 30s minimum between applications
- **Honest** — never fabricates experience, skills, or qualifications
- **Smart filtering** — skips jobs requiring too many years of experience, wrong locations, or already applied
- **Cover letters** — generates tailored 3-4 paragraph letters when required
- **Persistent memory** — never applies to the same job twice

## Teardown

To delete all AWS resources:

```bash
bash infra/teardown.sh
```

This reads the saved resource IDs from `infra/.deployed-resources.json` and deletes everything (with confirmation prompts for each step).

## Cost Estimate

| Resource | Approximate Cost |
|---|---|
| EC2 t3.large (on-demand) | ~$0.0832/hr (~$60/month) |
| EBS 30GB gp3 | ~$2.40/month |
| Elastic IP (while attached) | Free |
| 2Captcha | ~$3 per 1000 CAPTCHAs |
| **Total** | **~$65/month** |

Use a Reserved Instance or Spot Instance to reduce EC2 costs significantly.

## Troubleshooting

**Chrome won't start:**
```bash
sudo systemctl status chrome-debug
journalctl -u chrome-debug -n 50
```

**OpenClaw not responding:**
```bash
sudo systemctl restart openclaw
openclaw health
```

**WhatsApp disconnected:**
```bash
openclaw channels status
openclaw channels login  # re-scan QR if needed
```

**CAPTCHA solving failures:**
- Check your 2Captcha balance
- Verify `TWOCAPTCHA_API_KEY` in `.env`
- The agent will automatically fall back to WhatsApp for manual solving

**Setup script failed on EC2:**
```bash
ssh -i infra/job-apply-key.pem ubuntu@<elastic-ip>
tail -100 /var/log/job-apply-setup.log
tail -100 /var/log/cloud-init-output.log
```

## License

MIT
