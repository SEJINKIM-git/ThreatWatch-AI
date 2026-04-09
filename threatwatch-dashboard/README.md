# ThreatWatch AI Dashboard

LLM-powered security alert triage dashboard with presentation-friendly demo mode and real-time n8n workflow integration.

## Setup

```bash
npm install
npm run dev
```

## Demo-First Flow

- `Demo Mode`: runs deterministic scenario outputs from `public/demo-scenarios.json`
- `Live Mode`: sends the generated alert payload to an n8n webhook
- `Seed Replay`: rerun the same seed to reproduce the same scenario during a presentation
- `Auto Demo`: loops weighted-random scenarios for kiosk or showcase mode

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Import Project → Select this repo
3. Vercel auto-detects Vite — just click Deploy

## n8n Webhook Integration

1. Replace `01_Start_Manual_Test` node with a **Webhook** node (POST, path: `threatwatch`)
2. Set Webhook's **Respond** to `Using 'Respond to Webhook' Node`
3. Add **Respond to Webhook** node at the end of the pipeline
4. Enter your Webhook URL in the dashboard's config panel
5. Use `Demo Mode` for 발표 and `Live Mode` when you want to show the real n8n response path

## Authors

Sejin Kim / Chaehoon Lee — IS 3060-301 Spring
