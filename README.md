# ThreatWatch AI

ThreatWatch AI is an AI-assisted security triage platform that combines:

- a presentation-ready React frontend in [`threatwatch-dashboard/`](./threatwatch-dashboard)
- an n8n workflow export in [`ThreatWatch AI.json`](./ThreatWatch%20AI.json)
- a Python workflow engine and supporting modules in the repository root

This repository now reflects the actual project structure behind the ThreatWatch AI website, rather than only the presentation frontend.

## Repository Structure

```text
.
├── ThreatWatch AI.json            # n8n workflow export
├── BPMN Main Workflow.png         # main BPMN diagram
├── BPMN Red Box Flow.png          # red-box BPMN diagram
├── main.py                        # Python workflow runner
├── config.py                      # environment-based configuration
├── models.py                      # shared workflow data models
├── scenarios.py                   # deterministic scenario library
├── modules/                       # workflow modules
│   ├── alert_builder.py
│   ├── precheck.py
│   ├── ai_analyzer.py
│   ├── normalizer.py
│   ├── scenario_switch.py
│   ├── decision_router.py
│   ├── email_notifier.py
│   └── sheets_logger.py
├── requirements.txt               # Python dependencies
└── threatwatch-dashboard/         # deployed frontend site
```

## What Each Layer Does

### 1. Frontend

The frontend in [`threatwatch-dashboard/`](./threatwatch-dashboard):

- presents the ThreatWatch AI product website
- runs deterministic demo scenarios
- supports bilingual UI (Korean / English)
- sends live webhook payloads to n8n
- supports recipient email delivery experiences through the product workspace

### 2. n8n Workflow

The workflow export in [`ThreatWatch AI.json`](./ThreatWatch%20AI.json):

- receives alert payloads through a webhook
- enriches and pre-checks the case
- performs LLM-based assessment
- normalizes output
- routes by severity
- triggers email and logging actions

### 3. Python Backend / Workflow Engine

The Python layer mirrors the triage logic used across the project:

- builds alert payloads
- validates data completeness
- calls the LLM or uses mock analysis in demo mode
- normalizes final payloads
- applies scenario overrides for controlled demonstrations
- decides whether escalation email should be sent
- logs cases to Google Sheets

This backend code is useful for local testing, workflow validation, and showing the operational logic outside of n8n.

## Local Run

### Python workflow

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py P1
```

You can replace `P1` with:

- `P2`
- `P3`
- or a specific scenario id

### Frontend

```bash
cd threatwatch-dashboard
npm install
npm run dev
```

### Frontend production build

```bash
cd threatwatch-dashboard
npm run build
```

## Environment Setup

Create a local `.env` file for the Python workflow when running outside demo mode.

Expected variables include:

- `ANTHROPIC_API_KEY`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `ALERT_RECIPIENT`
- `GOOGLE_SHEETS_CREDENTIALS_PATH`
- `GOOGLE_SHEET_ID`
- `MAX_RETRIES`
- `DEMO_MODE`

## Website / Backend Alignment

The deployed website uses:

- the frontend from [`threatwatch-dashboard/`](./threatwatch-dashboard)
- the n8n webhook workflow for live runs
- deterministic scenario fallback when live calls fail

This repository is organized to reflect that exact split:

- **UI / product experience** lives in `threatwatch-dashboard/`
- **live automation flow** lives in `ThreatWatch AI.json`
- **workflow logic reference / execution engine** lives in the root Python code

## Notes

- Secrets are not committed.
- `.env`, `node_modules`, `dist`, virtual environments, and cache files should remain ignored.
- The frontend presentation repo used for Vercel deployment can stay separate, but this repository is now the source-of-truth repo for the full ThreatWatch AI project structure.
