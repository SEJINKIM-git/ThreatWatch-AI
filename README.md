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
├── main.py                        # Python workflow runner (local demo path)
├── lambda_handler.py              # AWS Lambda entry point (SQS event source)
├── build.sh                       # Lambda deployment package build (arm64 / py3.12)
├── config.py                      # environment-based configuration
├── models.py                      # shared workflow data models
├── scenarios.py                   # deterministic scenario library
├── data/
│   └── demo-scenarios.json        # shared demo scenario data
├── modules/                       # workflow modules
│   ├── alert_builder.py           # demo alerts + real payloads (build_from_payload)
│   ├── precheck.py
│   ├── ai_analyzer.py
│   ├── llm_parser.py
│   ├── data_validator.py
│   ├── normalizer.py
│   ├── scenario_switch.py
│   ├── decision_router.py
│   ├── email_notifier.py          # SMTP notifier (local path)
│   ├── sns_notifier.py            # SNS notifier (Lambda path)
│   ├── sheets_logger.py
│   ├── dynamo_logger.py           # DynamoDB case store (idempotent writes)
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

### 4. AWS Serverless Pipeline (production path)

Real alerts are processed by a serverless pipeline on AWS:

```text
POST /alerts
  → API Gateway (REST, API key + JSON Schema validation)
  → SQS (main queue, DLQ after 3 failed receives)
  → Lambda (lambda_handler.py: build → precheck → LLM assessment → normalize)
  → DynamoDB (idempotent case store)
  → S3 (audit log) + SNS (escalation notification)
```

Step by step:

1. A client sends `POST /alerts` with an API key. API Gateway validates the request body against a JSON Schema model (`AlertRequest`) at the gateway level — missing required fields or invalid enum values are rejected with `400` before touching any compute.
2. The gateway writes the message directly to SQS through a VTL mapping template (no Lambda in the ingestion path).
3. Lambda consumes the queue via an event source mapping (batch size 5) and runs the same triage pipeline as the local engine: alert build → data pre-check → LLM risk assessment → payload normalization.
4. The case is written to DynamoDB with a conditional write, logged to the S3 audit bucket, and — if the risk level warrants escalation — published to an SNS topic.

**Why three execution paths?** The n8n workflow is where the project started and remains the BPMN-documented reference of the triage flow. The local Python runner (`main.py`) exists for running deterministic demo scenarios and validating workflow changes during development. The Lambda pipeline is the path that processes real alerts.

## AWS Migration

The backend is being migrated to AWS in phases:

- **Phase 0 — Account / IAM groundwork** · Complete
- **Phase 1 — Lift & Shift** · Complete
  - Secret resolution via SSM Parameter Store
  - S3 audit logging (Hive-style `dt=` partitions, Athena-query ready)
  - Runs on EC2 with an IAM role (no static access keys)
  - Least-privilege IAM: `s3:PutObject` (cases/), `s3:GetObject` (deploy/), `ssm:GetParameter` (/threatwatch/*)
  - Access via Session Manager only, zero inbound security group rules
- **Phase 2 — Serverless re-architecture** · Complete
  - API Gateway (REST, Regional): `POST /alerts`, direct SQS integration via VTL mapping template (no Lambda in the ingestion path)
  - Gateway-level JSON Schema request validation (`AlertRequest` model) — missing required fields and invalid enum values are rejected with `400` before reaching the queue
  - API key required, Usage Plan: 5 req/s, burst 10, 1,000 requests/day
  - SQS main queue + DLQ (`maxReceiveCount` 3), visibility timeout 360s (6× the Lambda timeout)
  - Lambda: Python 3.12 / arm64 / 512 MB / 60s, SQS event source mapping with batch size 5 and `ReportBatchItemFailures`, reserved concurrency 5
  - DynamoDB `threatwatch-cases`: partition key `alert_id`, GSI `risk-level-index` (`risk_level` HASH + `created_at` RANGE), on-demand billing
  - SNS topic `threatwatch-escalations` replaces SMTP email delivery in the production path
  - S3 audit logging kept with the same `cases/dt=YYYY-MM-DD/{alert_id}.json` partition layout
  - Separate least-privilege IAM roles for EC2, Lambda, and API Gateway — e.g. the API Gateway role holds only `sqs:SendMessage` on the specific queue
- **Phase 3 — Data engineering layer** · Planned
  - Glue Crawler + Athena, Terraform IaC, GitHub Actions CI/CD, CloudWatch
  - Step Functions-based HITL approval path

Key design decisions in Phase 2:

1. **Idempotency** — cases are written to DynamoDB with an `attribute_not_exists(alert_id)` conditional write. SQS is at-least-once delivery, so the same alert can be redelivered; when the conditional write fails, notification is skipped, and no duplicate escalation email goes out.
2. **Partial batch failure** — the handler returns `batchItemFailures` so only failed messages are retried. Without this, one failure in a batch of 5 would retry all 5 messages and waste LLM calls.
3. **Error classification** — payloads that are invalid by themselves (`InvalidPayload`) would fail identically on retry, so they are dropped immediately; every other error is retried and isolated to the DLQ after 3 attempts. A dedicated exception type is used because catching something broad like `ValueError` would also swallow subclasses such as `UnicodeEncodeError` and silently delete real failures.
4. **LLM failure propagation** — outside `DEMO_MODE`, an LLM error raises instead of writing a fallback assessment. A fallback would store a P1 incident as P2 and notify at that lower level.
5. **Scenario overrides stay demo-only** — the Lambda path does not call `scenario_switch`; forced scenario overrides would overwrite the LLM verdict on real alerts. The local `main.py` demo path keeps them.
6. **IAM role separation** — EC2, Lambda, and API Gateway each have their own role, scoped to the minimum actions and resources they need.

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

The Lambda function is configured through function environment variables instead of `.env` — the local `.env` only drives the local runner, while Lambda reads its configuration from the function settings:

- `TABLE_NAME` — DynamoDB case table (default `threatwatch-cases`)
- `TOPIC_ARN` — SNS topic ARN for escalation notifications
- `S3_AUDIT_BUCKET` — audit log bucket
- `DEMO_MODE` — must be unset/false in production so LLM failures propagate

## API Usage

Real alerts enter the pipeline through the API Gateway endpoint. The endpoint URL and API key are not published; the URL has the form:

```text
https://{api-id}.execute-api.{region}.amazonaws.com/prod/alerts
```

Example request:

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/prod/alerts" \
  -H "Content-Type: application/json" \
  -H "x-api-key: {your-api-key}" \
  -d '{
    "incident_type": "credential_stuffing_admin_compromise",
    "severity": "high",
    "asset_criticality": "high",
    "pii_flag": true,
    "user_role": "Privileged",
    "indicators": ["multiple_failed_logins_spike", "impossible_travel"],
    "description": "Multiple failed login attempts followed by successful authentication"
  }'
```

| Field                | Required | Notes                                              |
| -------------------- | -------- | -------------------------------------------------- |
| `incident_type`      | Yes      | incident classification string                      |
| `severity`           | Yes      | validated against an enum at the gateway            |
| `alert_id`           | No       | generated from the ingest timestamp if omitted      |
| `timestamp`          | No       | defaults to ingest time                             |
| `asset_criticality`  | No       | defaults to `medium`                                |
| `pii_flag`           | No       | defaults to `false`                                 |
| `user_role`          | No       | defaults to `Standard`                              |
| `indicators`         | No       | list of indicator strings, defaults to empty        |
| `description`        | No       | free-form description                               |

Responses:

- `200` — accepted and enqueued to SQS (processing is asynchronous)
- `400` — request body failed gateway-level JSON Schema validation
- `403` — missing or invalid API key

## Deployment

Build the Lambda package and update the function:

```bash
./build.sh
aws lambda update-function-code \
  --function-name {function-name} \
  --zip-file fileb://lambda-package.zip
```

`build.sh` installs dependencies for `manylinux2014_aarch64` / Python 3.12 and bundles the application code. `boto3` is provided by the Lambda runtime and `gspread`/`google-auth` are not used in the Lambda path, so all three are excluded — the package stays around 4 MB.

## Website / Backend Alignment

The deployed website uses:

- the frontend from [ThreatWatch-AI-Presentation-Site](https://github.com/SEJINKIM-git/ThreatWatch-AI-Presentation-Site)
- the n8n webhook workflow for live runs
- deterministic scenario fallback when live calls fail

This repository is organized to reflect that exact split:

- **UI / product experience** lives in the separate presentation-site repository
- **live automation flow** lives in `ThreatWatch AI.json`
- **workflow logic reference / execution engine** lives in the root Python code
- **production alert processing** runs on the AWS serverless pipeline (`lambda_handler.py`)

## Notes

- Secrets are not committed.
- `.env`, `node_modules`, `dist`, virtual environments, and cache files should remain ignored.
- The frontend presentation repo used for Vercel deployment stays separate; this repository is the source-of-truth repo for the backend workflow and AWS migration work.
