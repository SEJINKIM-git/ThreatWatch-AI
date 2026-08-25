# ThreatWatch AI Dashboard

LLM-powered security alert triage dashboard with a presentation-friendly scenario walkthrough and a live workspace backed by the real AWS triage pipeline.

## Screens

| Screen | Path | Data source |
|---|---|---|
| Overview + Scenario walkthrough | `/` | `public/demo-scenarios.json` (static) |
| Live Workspace | `/workspace` | AWS pipeline (real runs) |

The overview page (`src/App.jsx`) explains the product and includes a scenario walkthrough section driven entirely by fixed scenario data, so it works offline. The Live Workspace (`src/Workspace.jsx`) submits alerts to the actual pipeline — API Gateway → SQS → Lambda (LLM triage) → DynamoDB/S3/SNS, with Step Functions approval for P1 cases — and shows how each submission is processed.

Routing is intentionally minimal: `src/main.jsx` branches on `window.location.pathname` instead of adding React Router, to keep dependencies down.

## Setup

```bash
npm install
npm run dev
```

## Demo-First Flow

- `Demo Mode`: runs deterministic scenario outputs from `public/demo-scenarios.json`
- `Live Mode`: sends the generated alert payload through the serverless proxy to the AWS pipeline
- `Seed Replay`: rerun the same seed to reproduce the same scenario during a presentation
- `Auto Demo`: loops weighted-random scenarios for kiosk or showcase mode

## Serverless Functions

The `api/` directory holds Vercel serverless functions that sit between the browser and the AWS pipeline.

| Function | Role |
|---|---|
| `tw-alerts.js` | Signs the request with HMAC on the server, then forwards the alert |
| `tw-cases.js` | Lists cases or fetches a single case (read-only) |
| `tw-status.js` | Reports whether Live mode is configured (never returns secret values) |
| `n8n-webhook.js` | (legacy) proxy for the earlier n8n workflow |

The API key and HMAC secret are handled only inside these functions. Anything bundled into the browser is readable by anyone who opens DevTools, so putting credentials in client code makes the authentication meaningless — an attacker could sign their own requests. For the same reason, **never add the `VITE_` prefix to these variables**: Vite inlines `VITE_*` values into the client bundle at build time, which would expose them.

## Environment Variables

Set these in the Vercel dashboard (Project → Settings → Environment Variables):

| Variable | Purpose |
|---|---|
| `TW_API_URL` | API Gateway base URL for the prod stage (no trailing slash) |
| `TW_API_KEY` | API key sent as `x-api-key` |
| `TW_HMAC_SECRET` | Shared secret for HMAC request signing |

Environment variables are injected at build time, so **a redeploy is required after changing any of them**. Deployments without these variables (local dev, forks) simply run in Scenario mode — `tw-status.js` reports Live mode as unavailable.

## SPA Rewrites

`vercel.json` rewrites `/workspace` (and subpaths) to `index.html`. This is required because the app is a single-page app: there is no static file at `/workspace`, so a direct visit or refresh would 404 without the rewrite. Once `index.html` loads, `main.jsx` reads the pathname and renders the right screen. `/api/*` paths are not rewritten — they go straight to the serverless functions.

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Import Project → Select this repo
3. Vercel auto-detects Vite — just click Deploy
4. Add the environment variables above and redeploy to enable Live mode

## n8n Webhook Integration (legacy)

An earlier iteration ran triage through n8n; `api/n8n-webhook.js` remains as part of the project history.

1. Replace `01_Start_Manual_Test` node with a **Webhook** node (POST, path: `threatwatch`)
2. Set Webhook's **Respond** to `Using 'Respond to Webhook' Node`
3. Add **Respond to Webhook** node at the end of the pipeline
4. Enter your Webhook URL in the dashboard's config panel
5. Use `Demo Mode` for 발표 and `Live Mode` when you want to show the real n8n response path

## Authors

Sejin Kim / Chaehoon Lee — IS 3060-301 Spring
