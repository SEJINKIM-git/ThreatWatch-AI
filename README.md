# ThreatWatch AI Dashboard

LLM-powered security alert triage dashboard with real-time n8n workflow integration.

## Setup

```bash
npm install
npm run dev
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Import Project → Select this repo
3. Vercel auto-detects Vite — just click Deploy

## n8n Webhook Integration

1. Replace `01_Start_Manual_Test` node with a **Webhook** node (POST, path: `threatwatch`)
2. Set Webhook's **Respond** to `Using 'Respond to Webhook' Node`
3. Add **Respond to Webhook** node at the end of the pipeline
4. Enter your Webhook URL in the dashboard's config panel

## Authors

Sejin Kim / Chaehoon Lee — IS 3060-301 Spring
