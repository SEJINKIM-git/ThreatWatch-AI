# ThreatWatch AI Dashboard

LLM-powered security alert triage dashboard with a presentation-friendly scenario walkthrough and a live workspace backed by the real AWS triage pipeline.

## Screens

| Screen | Path | Data source |
|---|---|---|
| Overview + Scenario walkthrough | `/` | `public/demo-scenarios.json` (static) |
| Live Workspace | `/workspace` | AWS pipeline (real runs) |
| Depeg Early Warning | `/depeg` | `public/depeg/replay.json` (static, generated from the depeg engine) |

### Depeg Early Warning (`/depeg`)

Explains the stablecoin depeg early-warning system that sits on top of ThreatWatch (Phase A): the ten steps from market data to the human approval outcome with owners and status, an hour-by-hour replay of the March 2023 USDC depeg, and the literal alert the adapter sends into ThreatWatch.

The page computes nothing. Every number comes from `public/depeg/replay.json`, which `scripts/build_depeg_replay.py` produces by calling the real engine (`compute_risk_score`) and adapter (`to_alert_request`) in the `depeg-early-warning` repository. Regenerate it whenever the engine or data changes:

```bash
# from this repo, using the depeg-early-warning virtualenv
python scripts/build_depeg_replay.py --engine-repo ../depeg-early-warning --out public/depeg/replay.json
```

Step status labels are maintained by hand in `src/depeg/content.js` (`STATUS_AS_OF`).

**Live today (Scene 1).** The top of `/depeg` calls `api/depeg-live.py`, a read-only Python function that pulls the latest completed Bitstamp USDC/USD hourly candles and the last 24 hours of GDELT headlines, classifies headlines with a fixed rubric (`api/_depeg/news_rubric.py` — no AI judgement, so results are reproducible), adds the latest hand-verified Circle filing, and scores everything with a verbatim copy of the depeg engine (`api/_depeg/risk_score.py`). It sends nothing and uses no secrets; responses are CDN-cached for 10 minutes. Refresh the engine copy with `scripts/sync_depeg_engine.sh ../depeg-early-warning`. Offline tests: `python -m pytest tests/test_depeg_live.py`.

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

### Scene 3 — simulated crisis (`/depeg#sim`)

Upload a crisis file (CSV or JSON; template at `public/depeg/sim-template.csv`). `api/depeg-sim.py` scores every hour with the copied engine (only that hour's values, empty columns left out) and the page plays it back. The first time the score reaches 85 during playback, the page asks the same function to send **one** alert: the server re-scores that hour, builds the AlertRequest with the copied adapter (`description` prefixed `[DEMO SIMULATION · file · time]`), signs it like `send_signed.py`, and posts it to ThreatWatch. The case then follows the normal P1 path (approval email → approve/reject link), and the page polls `/api/tw-cases` until the decision shows.

Real sending needs `DEPEG_DEMO_KEY` set in Vercel (Production) and the same key typed on the page; without it the page only shows where the alert would have gone. The key is compared on the server and never returned. Tests: `python -m pytest tests/test_depeg_sim.py`.
