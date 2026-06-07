# PRReviewer

> AI code review bot for GitHub PRs. Open a PR → get line-level feedback in 30 seconds.
>
> Supports **Anthropic Claude**, **Groq (LLaMA 3)**, and **Google Gemini** — switchable with one env var.

## AI Provider Toggle

Set `AI_PROVIDER` in your `.env` to choose the backend:

| Value | Model used | Notes |
|-------|-----------|-------|
| `anthropic` *(default)* | `claude-sonnet-4-20250514` | Best quality, paid |
| `groq` | `llama-3.3-70b-versatile` | Fastest, free tier available |
| `gemini` | `gemini-2.0-flash` | Google, free tier available |

Only the API key for the **selected** provider needs to be set. The others are ignored.

```bash
# Switch to Groq
AI_PROVIDER=groq
GROQ_API_KEY=gsk_...

# Switch to Gemini
AI_PROVIDER=gemini
GEMINI_API_KEY=AIza...

# Use Anthropic (default)
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Setup

### 1. Create a GitHub App

1. Go to GitHub → Settings → Developer Settings → GitHub Apps → New GitHub App
2. Set:
   - **Homepage URL**: your Railway URL (or `http://localhost:3000` for dev)
   - **Webhook URL**: your Railway URL + `/webhook`
   - **Webhook secret**: generate a random string, save it
3. Permissions:
   - Pull requests: **Read & Write**
   - Contents: **Read**
4. Subscribe to events: **Pull request**
5. Generate a private key → download the `.pem` file

### 2. Configure environment

```bash
cp .env.example .env
# Fill in your chosen AI provider key + GitHub App credentials
```

### 3. Run locally

```bash
npm install
npm run start:dev

# In another terminal — forward GitHub webhooks to localhost:
npx smee -u https://smee.io/your-channel -t http://localhost:3000/webhook
```

### 4. Deploy to Railway

```bash
npm i -g @railway/cli
railway login
railway init
railway up
# Set env vars in Railway dashboard
```

---

## How it works

1. GitHub sends a webhook on every PR open/update
2. Bot fetches the PR diff via GitHub API
3. Each changed file is sent to the configured AI for review (sequentially)
4. Bot posts inline comments + a summary review on the PR

## What it reviews

- Bugs and logic errors
- Security issues (missing auth, injection risks, secrets in code)
- Missing error handling
- Type safety issues (TypeScript)

## What it ignores

- Formatting/style (use a linter)
- Lock files, generated files, deleted files
- Files with no additions
- Binary files

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook` | GitHub webhook receiver |
| `GET` | `/health` | Health check — returns `{"status":"ok"}` |

## Verifying the setup

```bash
# 1. Webhook signature rejection
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=invalidsignature" \
  -d '{"action":"opened"}'
# Expected: 401 Unauthorized

# 2. Health check
curl http://localhost:3000/health
# Expected: {"status":"ok"}
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | Active AI backend: `anthropic` \| `groq` \| `gemini` (default: `anthropic`) |
| `ANTHROPIC_API_KEY` | Anthropic API key (required when `AI_PROVIDER=anthropic`) |
| `GROQ_API_KEY` | Groq API key (required when `AI_PROVIDER=groq`) |
| `GEMINI_API_KEY` | Google Gemini API key (required when `AI_PROVIDER=gemini`) |
| `GITHUB_APP_ID` | Numeric ID of your GitHub App |
| `GITHUB_PRIVATE_KEY` | RSA private key from the `.pem` file (newlines as `\n`) |
| `GITHUB_WEBHOOK_SECRET` | Secret string set in your GitHub App config |
| `GITHUB_APP_NAME` | GitHub App slug name (default: `prreviewer-bot`) |
| `PORT` | HTTP port (default: `3000`) |
| `NODE_ENV` | `development` or `production` |

## Project structure

```
src/
├── main.ts                        # Fastify bootstrap
├── app.module.ts
├── config/
│   └── configuration.ts           # Typed env config + provider selection
├── ai/
│   ├── ai.service.ts              # Unified AI service (delegates to active provider)
│   ├── prompts.ts                 # All prompt templates
│   ├── ai.module.ts
│   └── providers/
│       ├── provider.interface.ts  # AiProvider interface
│       ├── anthropic.provider.ts  # Claude backend
│       ├── groq.provider.ts       # Groq/LLaMA backend
│       ├── gemini.provider.ts     # Gemini backend
│       └── index.ts
├── github/
│   ├── diff.parser.ts             # Unified diff → DiffHunk[]
│   ├── github.service.ts          # GitHub App auth + API calls
│   └── github.module.ts
├── review/
│   ├── review.service.ts          # Orchestrator
│   └── review.module.ts
└── webhook/
    ├── webhook.controller.ts      # POST /webhook, GET /health
    ├── webhook.service.ts         # HMAC verification + routing
    └── webhook.module.ts
```
