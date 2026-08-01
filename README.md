# ThreatWatch AI

ThreatWatch AI is an AI-assisted security triage platform that combines:

- a presentation-ready React frontend, maintained in a separate repository: [ThreatWatch-AI-Presentation-Site](https://github.com/SEJINKIM-git/ThreatWatch-AI-Presentation-Site)
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
├── data/
│   └── demo-scenarios.json        # shared demo scenario data
├── modules/                       # workflow modules
│   ├── alert_builder.py
│   ├── precheck.py
│   ├── ai_analyzer.py
│   ├── llm_parser.py
│   ├── data_validator.py
│   ├── normalizer.py
│   ├── scenario_switch.py
│   ├── decision_router.py
│   ├── email_notifier.py
│   ├── sheets_logger.py
│   └── s3_logger.py
└── requirements.txt               # Python dependencies
```

## What Each Layer Does

### 1. Frontend

The frontend lives in a separate repository, [ThreatWatch-AI-Presentation-Site](https://github.com/SEJINKIM-git/ThreatWatch-AI-Presentation-Site), deployed on Vercel. It:

- presents the ThreatWatch AI product website
- runs deterministic demo scenarios
- supports bilingual UI (Korean / English)
- sends live webhook payloads to n8n
- supports recipient email delivery experiences through the product workspace

For frontend setup and build instructions, see that repository's README.

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
- logs cases to Google Sheets and to an S3 audit bucket

This backend code is useful for local testing, workflow validation, and showing the operational logic outside of n8n.

## AWS Migration

The backend is being migrated to AWS in phases:

- **Phase 0 — Account / IAM groundwork** · Complete
- **Phase 1 — Lift & Shift** · Complete
  - Secret resolution via SSM Parameter Store
  - S3 audit logging (Hive-style `dt=` partitions, Athena-query ready)
  - Runs on EC2 with an IAM role (no static access keys)
  - Least-privilege IAM: `s3:PutObject` (cases/), `s3:GetObject` (deploy/), `ssm:GetParameter` (/threatwatch/*)
  - Access via Session Manager only, zero inbound security group rules
- **Phase 2 — Serverless re-architecture** · Planned
  - API Gateway (REST) → SQS/DLQ → Lambda → DynamoDB / S3 / SNS
  - Gateway-level JSON Schema request validation, API key + Usage Plan
  - Step Functions-based HITL approval path
- **Phase 3 — Data engineering layer** · Planned
  - Glue Crawler + Athena, Terraform IaC, GitHub Actions CI/CD, CloudWatch

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

The frontend is developed and built in its own repository. Refer to the README of [ThreatWatch-AI-Presentation-Site](https://github.com/SEJINKIM-git/ThreatWatch-AI-Presentation-Site) for install, dev, and production build instructions.

## Environment Setup

Create a local `.env` file for the Python workflow when running outside demo mode.

Expected variables include:

- `ANTHROPIC_API_KEY` — resolved from the local `.env` or from SSM Parameter Store (`/threatwatch/anthropic-api-key`)
- `AWS_REGION` — AWS region (default `ap-northeast-2`)
- `S3_AUDIT_BUCKET` — target S3 bucket for audit case logs
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `ALERT_RECIPIENT`
- `GOOGLE_SHEETS_CREDENTIALS_PATH`
- `GOOGLE_SHEET_ID`
- `MAX_RETRIES`
- `DEMO_MODE`

## Website / Backend Alignment

The deployed website uses:

- the frontend from [ThreatWatch-AI-Presentation-Site](https://github.com/SEJINKIM-git/ThreatWatch-AI-Presentation-Site)
- the n8n webhook workflow for live runs
- deterministic scenario fallback when live calls fail

This repository is organized to reflect that exact split:

- **UI / product experience** lives in the separate presentation-site repository
- **live automation flow** lives in `ThreatWatch AI.json`
- **workflow logic reference / execution engine** lives in the root Python code

## Notes

- Secrets are not committed.
- `.env`, `node_modules`, `dist`, virtual environments, and cache files should remain ignored.
- The frontend presentation repo used for Vercel deployment stays separate; this repository is the source-of-truth repo for the backend workflow and AWS migration work.
