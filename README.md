# PRReviewer

> An AI-powered GitHub PR review bot. Open a pull request → get inline code review comments posted by a bot within 30 seconds.

Supports **Anthropic Claude**, **Groq (LLaMA 3.3)**, and **Google Gemini 2.5** — switch between them with one environment variable.

---

## What This Project Does

When a developer opens or updates a pull request on a GitHub repo where this bot is installed:

1. GitHub sends a webhook event to this server
2. The server fetches the PR diff via GitHub API
3. Each changed file is sent to an AI model for review
4. The bot posts **inline comments** on specific lines + a **summary review** on the PR

The bot comments look like:

> **[ERROR]** This function has no error handling for null input. If `user` is undefined this will throw at runtime.

> **[WARNING]** This SQL query is built with string concatenation — use parameterized queries to prevent injection.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | NestJS 10 (Fastify adapter) |
| Language | TypeScript (strict mode) |
| AI — Option 1 | Anthropic Claude via `@anthropic-ai/sdk` |
| AI — Option 2 | Groq LLaMA 3.3 via `groq-sdk` |
| AI — Option 3 | Google Gemini 2.5 via `@google/generative-ai` |
| GitHub Auth | GitHub App (JWT → installation token) via `@octokit/auth-app` |
| GitHub API | Octokit REST via `@octokit/rest` |
| Webhook Verification | HMAC-SHA256 via `@octokit/webhooks` |
| Local Tunneling | ngrok (or smee.io) |
| Deploy Target | Railway (single service) |

---

## Project Structure

```
prreviewer/
├── .env                          ← your secrets (never commit this)
├── .env.example                  ← template showing all required variables
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── main.ts                   ← entry point, starts Fastify server
    ├── app.module.ts             ← root NestJS module
    ├── config/
    │   └── configuration.ts     ← typed config loaded from env vars
    ├── ai/
    │   ├── ai.service.ts        ← unified AI service, delegates to active provider
    │   ├── ai.module.ts
    │   ├── prompts.ts           ← all prompt templates live here, nowhere else
    │   └── providers/
    │       ├── provider.interface.ts   ← AiProvider interface
    │       ├── anthropic.provider.ts  ← Claude backend
    │       ├── groq.provider.ts       ← Groq/LLaMA backend
    │       ├── gemini.provider.ts     ← Gemini backend
    │       └── index.ts
    ├── github/
    │   ├── github.service.ts    ← GitHub App auth, diff fetching, posting reviews
    │   ├── github.module.ts
    │   └── diff.parser.ts       ← parses unified diff into structured hunks
    ├── review/
    │   ├── review.service.ts    ← orchestrates the full review flow
    │   └── review.module.ts
    └── webhook/
        ├── webhook.controller.ts  ← POST /webhook + GET /health
        ├── webhook.service.ts     ← verifies HMAC signature, routes events
        └── webhook.module.ts
```

---

## Prerequisites

- Node.js 20+
- A GitHub account
- An ngrok account (free tier works): https://ngrok.com
- At least one AI API key (Groq has a free tier): https://console.groq.com

---

## Full Setup Guide

### 1. Clone and install

```bash
git clone <your-repo>
cd prreviewer
npm install
```

---

### 2. Create a GitHub App

1. Go to **github.com → Settings → Developer Settings → GitHub Apps → New GitHub App**

2. Fill in the form:
   - **GitHub App name**: anything unique e.g. `my-prreviewer-bot`
   - **Homepage URL**: `http://localhost:3000` (for now)
   - **Webhook URL**: leave blank for now — you'll fill this after ngrok is running
   - **Webhook secret**: generate a random string and save it — e.g. run `openssl rand -hex 20` or just type something random like `mysecretkey123`

3. Set **Permissions** (under Repository permissions):
   - Pull requests → **Read & Write**
   - Contents → **Read**

4. Under **Subscribe to events** tick:
   - **Pull request**

5. Under **Where can this GitHub App be installed?** select **Only on this account**

6. Click **Create GitHub App**

7. On the next page you'll see your **App ID** — copy it

8. Scroll to the bottom → **Private keys** section → click **Generate a private key**
   - A `.pem` file downloads automatically

---

### 3. Convert the private key for the .env file

The private key needs all newlines replaced with `\n` to fit on one line. Run this PowerShell command where the `.pem` file downloaded:

```powershell
(Get-Content ".\your-app-name.YYYY-MM-DD.private-key.pem" -Raw) -replace "`r`n","\n" -replace "`n","\n"
```

Copy the entire output — it should start with `-----BEGIN RSA PRIVATE KEY-----\n` and end with `\n-----END RSA PRIVATE KEY-----\n`.

---

### 4. Get an AI API key

Pick one — you only need one to start:

| Provider | Free Tier | Get Key |
|----------|-----------|---------|
| **Groq** | Yes — generous free tier, very fast | https://console.groq.com |
| **Gemini** | Yes — free tier available | https://aistudio.google.com/app/apikey |
| **Anthropic** | No — paid only | https://console.anthropic.com |

Groq is recommended for getting started — free, fast, no card required.

---

### 5. Fill in your .env file

Open `prreviewer\.env` and fill in all values:

```env
# GitHub App credentials
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEo...(long string)...\n-----END RSA PRIVATE KEY-----\n"
GITHUB_WEBHOOK_SECRET=mysecretkey123
GITHUB_APP_NAME=my-prreviewer-bot

# AI Provider — choose one: anthropic | groq | gemini
AI_PROVIDER=groq

# Only fill the key for the provider you chose above
ANTHROPIC_API_KEY=
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
GEMINI_API_KEY=

# App
PORT=3000
NODE_ENV=development
```

> **Important:** `GITHUB_APP_NAME` is the slug shown in the URL on your app's settings page e.g. `https://github.com/apps/my-prreviewer-bot` → name is `my-prreviewer-bot`

---

### 6. Start ngrok

In a **separate terminal**, run:

```bash
ngrok http 3000
```

You'll see output like:

```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:3000
```

Copy the `https://` URL — you need it in the next step.

> **Note:** Free ngrok URLs change every time you restart ngrok. When that happens you need to update the Webhook URL in your GitHub App settings again.

---

### 7. Set the Webhook URL in GitHub

1. Go back to your GitHub App settings page
2. Under **General → Webhook**
3. Set **Webhook URL** to: `https://abc123.ngrok-free.app/webhook`
4. Make sure **Active** is checked
5. Click **Save changes**

---

### 8. Start the server

```bash
npm run start:dev
```

You should see:

```
[NestFactory] Starting Nest application...
[RoutesResolver] WebhookController {/}
[RouterExplorer] Mapped {/webhook, POST}
[RouterExplorer] Mapped {/health, GET}
[NestApplication] Nest application successfully started
PRReviewer listening on port 3000
```

---

### 9. Verify the server is working

**Test the health endpoint:**

```powershell
curl http://localhost:3000/health
```

Expected:
```json
{"status":"ok"}
```

**Test webhook signature rejection:**

```powershell
curl -X POST http://localhost:3000/webhook `
  -H "Content-Type: application/json" `
  -H "x-hub-signature-256: sha256=invalidsignature" `
  -d '{"action":"opened"}'
```

Expected: `401 Unauthorized` — this confirms signature verification is working.

---

### 10. Install the GitHub App on a test repo

1. Go to your GitHub App page → **Install App** (left sidebar)
2. Click **Install** next to your account
3. Choose **Only select repositories** and pick a test repo you own
4. Click **Install**

---

### 11. Open a Pull Request — watch the bot work

Go to that test repo and open a PR with any code change. In your server terminal you should see:

```
[WebhookService] Handling pull_request.opened
[ReviewService] [PRReviewer] Starting review for yourname/testrepo#PR1 (commit: abc1234)
[ReviewService] [PRReviewer] Reviewing 3 files...
[AiService] Groq response: 312 output tokens
[AiService] Groq response: 289 output tokens
[AiService] Groq response: 201 output tokens
[GithubService] Review posted on yourname/testrepo#1 with verdict REQUEST_CHANGES
[ReviewService] [PRReviewer] Review posted — 5 comments across 3 files
```

On GitHub, the PR will show the bot's inline comments and a summary review.

---

## AI Provider Toggle

Switch AI providers with one env var — no code changes needed:

```env
AI_PROVIDER=groq       # LLaMA 3.3 70B — fastest, free
AI_PROVIDER=gemini     # Gemini 2.5 Flash — good quality, free tier
AI_PROVIDER=anthropic  # Claude Sonnet — best quality, paid
```

| Provider | Model | Speed | Quality | Cost |
|----------|-------|-------|---------|------|
| `groq` | `llama-3.3-70b-versatile` | ⚡⚡⚡ Very fast | Good | Free tier |
| `gemini` | `gemini-2.5-flash-preview-05-20` | ⚡⚡ Fast | Very good | Free tier |
| `anthropic` | `claude-sonnet-4-20250514` | ⚡ Normal | Best | Paid |

Only the API key for the **selected** provider needs to be set. The others are ignored at startup.

---

## What the Bot Reviews

- Bugs and logic errors
- Security vulnerabilities (SQL injection, XSS, missing auth checks, hardcoded secrets)
- Missing error handling
- Performance issues
- TypeScript / type safety problems
- Naming and readability issues

## What the Bot Ignores

- Code formatting and style (use a linter for that)
- Personal preferences
- Lock files (`package-lock.json`, `yarn.lock`, `go.sum`, etc.)
- Generated files (`*.min.js`, `*.generated.ts`, `dist/`, `build/`)
- Deleted files
- Binary files
- Files with zero additions
- PRs larger than 20 files — only the first 20 are reviewed, with a note in the summary

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook` | Receives GitHub webhook events |
| `GET` | `/health` | Returns `{"status":"ok"}` — use for uptime monitoring |

---

## How It Works Internally

### Webhook flow

```
GitHub PR opened/updated
        │
        ▼
POST /webhook
        │
        ▼
WebhookService.verifyAndRoute()
  - Verifies HMAC-SHA256 signature against GITHUB_WEBHOOK_SECRET
  - If invalid → 401 Unauthorized
  - If valid → routes based on action
        │
        ▼ (action: opened / synchronize / reopened)
ReviewService.reviewPullRequest()   ← fire-and-forget, webhook returns 200 immediately
        │
        ├─ Get authenticated Octokit for this installation
        ├─ Check if bot already reviewed this exact commit SHA → skip if so
        ├─ Fetch raw unified diff from GitHub API
        ├─ Parse diff → DiffHunk[] (per-file structured data)
        ├─ Filter out: deleted, binary, lock files, generated files, 0-addition files
        ├─ Cap at 20 files
        │
        ▼ (for each file, sequentially with 500ms delay)
AiService.reviewFile(hunk)
  - Sends patch to AI provider
  - Parses JSON response
  - Validates line numbers against actual diff lines
  - Returns FileReview { filename, summary, comments[] }
        │
        ▼
AiService.buildPRSummary(allReviews)
  - Sends all per-file summaries to AI
  - Returns markdown summary with APPROVE / REQUEST_CHANGES / COMMENT verdict
        │
        ▼
GithubService.postReviewComments()
  - Calls octokit.pulls.createReview() with all inline comments in one API call
  - If GitHub rejects due to invalid line numbers → falls back to issue comment
```

### GitHub App Authentication

The bot uses **GitHub App authentication** (not a personal access token):

1. Signs a JWT using the app's private key + app ID
2. Exchanges the JWT for an **installation access token** scoped to the specific repo
3. Tokens are cached in memory until 1 minute before expiry (tokens last 1 hour)
4. Each installation (repo) gets its own token

### Diff Parsing

The unified diff from GitHub is parsed into structured `DiffHunk` objects:

- Tracks exact line numbers for added, removed, and context lines
- Maps file extensions to language names (TypeScript, Python, Go, etc.)
- Detects binary files and skips them
- Flags files with >500 added lines as `truncated: true`

### Why Sequential AI Calls (not parallel)

Files are reviewed one at a time with a 500ms gap between calls. Using `Promise.all` for parallel calls would hit API rate limits on all three providers and get 429 errors. Sequential processing is slower but reliable.

---

## Deploying to Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Then in the Railway dashboard:
1. Go to your service → **Variables**
2. Add all the same env vars from your `.env` file
3. Set `NODE_ENV=production`
4. The deploy URL will be something like `https://prreviewer-production.up.railway.app`
5. Update your GitHub App's Webhook URL to `https://prreviewer-production.up.railway.app/webhook`

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` on webhook | Webhook secret mismatch | Make sure `GITHUB_WEBHOOK_SECRET` in `.env` matches exactly what you set in GitHub App settings |
| `GROQ_API_KEY is not configured` | Missing key in `.env` | Add the key for your chosen provider |
| No bot comment on PR | App not installed on repo | Go to GitHub App → Install App → select the repo |
| `gemini-2.0-flash is no longer available` | Deprecated model | Already fixed — model is now `gemini-2.5-flash-preview-05-20` |
| `Invalid installationId` | App was uninstalled | Reinstall the app on the repo |
| Bot reviewed same PR twice | Restart bug — commit SHA cache reset | Expected on server restart — won't double-post in production |
| ngrok URL changed | Free ngrok restarts change URL | Update Webhook URL in GitHub App settings after each ngrok restart |
| `404` on webhook from GitHub | Wrong webhook URL | Make sure URL ends with `/webhook` not just the ngrok base URL |
| Review posted but 0 comments | AI returned no valid line numbers | Check AI provider logs — may be a JSON parsing issue |
| `nest build` errors | TypeScript issue | Run `npm run build` and read the error — usually a missing import |

---

## What Was Learned / Key Decisions

### Raw body for webhook verification
NestJS + Fastify by default parses the JSON body before your controller sees it. But GitHub's HMAC-SHA256 signature is computed against the **raw bytes**. If you verify against the parsed-then-re-serialized body the signature will never match. The fix is `rawBody: true` in the Fastify adapter config and reading `req.rawBody` in the controller.

### GitHub App auth vs Personal Access Token
A PAT is tied to a user account and would require that user to have access to every repo. A GitHub App gets its own identity, can be installed on any repo/org, and the installation token is scoped to exactly the repos it's installed on. More secure and portable.

### One `createReview` call for all comments
GitHub's API lets you post a review body + all inline comments in a single `pulls.createReview()` call. Posting each comment separately with `createComment()` would generate a notification for every single comment — bad experience. One review = one notification.

### Why the bot must always return 200
If the webhook endpoint returns any non-200 status on an error, GitHub marks the delivery as failed and retries it — potentially many times. All errors are caught, logged, and swallowed. The endpoint always returns `{ ok: true }`.

### Filtering before sending to AI
Lock files, generated files, and deleted files contain no reviewable logic. Sending `package-lock.json` (thousands of lines) to an AI wastes tokens and produces useless comments. Filtering first keeps costs low and quality high.

### Code fence stripping
Some AI providers (especially Gemini) wrap their JSON response in ` ```json ``` ` markdown fences even when explicitly told not to. The `stripCodeFences()` function handles this so JSON parsing doesn't fail.

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_APP_ID` | Yes | Numeric ID shown on your GitHub App settings page |
| `GITHUB_PRIVATE_KEY` | Yes | RSA private key from the `.pem` file — newlines as `\n`, wrapped in quotes |
| `GITHUB_WEBHOOK_SECRET` | Yes | The secret string you set when creating the GitHub App |
| `GITHUB_APP_NAME` | No | App slug name (default: `prreviewer-bot`) — used to detect duplicate reviews |
| `AI_PROVIDER` | No | `anthropic` \| `groq` \| `gemini` (default: `anthropic`) |
| `ANTHROPIC_API_KEY` | If using Anthropic | Get from https://console.anthropic.com |
| `GROQ_API_KEY` | If using Groq | Get from https://console.groq.com |
| `GEMINI_API_KEY` | If using Gemini | Get from https://aistudio.google.com/app/apikey |
| `PORT` | No | HTTP port (default: `3000`) |
| `NODE_ENV` | No | `development` or `production` |
