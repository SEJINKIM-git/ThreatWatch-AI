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
├── authorizer.py                  # API Gateway Lambda authorizer (HMAC signature validation)
├── approval_request.py            # HITL: stores the task token, emails approve/reject links
├── approval_callback.py           # HITL: handles link clicks, resumes the state machine
├── approval_finalize.py           # HITL: records the outcome on the case, notifies
├── build.sh                       # Lambda deployment package build (arm64 / py3.12)
├── seed_alerts.sh                 # sends sample alerts through the API (seeds Athena demo data)
├── send_signed.py                 # CLI for sending HMAC-signed requests (tests the reject paths too)
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
├── terraform/                     # Infrastructure as Code (see section below)
│   ├── versions.tf                # provider config, S3 backend, default tags, locals
│   ├── variables.tf               # input variables and defaults
│   ├── storage.tf                 # S3 audit bucket (encryption, lifecycle), DynamoDB table
│   ├── messaging.tf               # SQS main queue + DLQ, SNS escalation topic
│   ├── iam.tf                     # least-privilege roles for Lambda / API Gateway / Glue
│   ├── compute.tf                 # Lambda function, log group, SQS event source mapping
│   ├── api.tf                     # API Gateway REST API, SQS integration, schema model, usage plan
│   ├── auth.tf                    # HMAC authorizer: Lambda, nonce table, API Gateway authorizer
│   ├── hitl.tf                    # HITL approval: state machine, 3 Lambdas, approvals table
│   ├── api_approvals.tf           # GET /approvals callback endpoint (AWS_PROXY)
│   ├── analytics.tf               # Glue catalog database + crawler, Athena workgroup
│   ├── monitoring.tf              # ops SNS topic, CloudWatch alarms
│   ├── cicd.tf                    # GitHub OIDC provider, deploy role
│   └── outputs.tf                 # endpoint and resource identifier outputs
├── .github/
│   └── workflows/
│       └── terraform.yml          # CI/CD: fmt → validate → plan (PR) → apply (main)
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
  → API Gateway (REST, API key + HMAC signature + JSON Schema validation)
  → SQS (main queue, DLQ after 3 failed receives)
  → Lambda (lambda_handler.py: build → precheck → LLM assessment → normalize)
  → DynamoDB (idempotent case store) + S3 (audit log)
  → severity routing:
      P1     → Step Functions approval workflow (human approve / reject / expire)
      others → SNS (escalation notification)
```

Step by step:

1. A client sends `POST /alerts` with an API key and three HMAC signature headers (see the Authentication section). A Lambda authorizer verifies the signature, timestamp freshness, and nonce uniqueness; API Gateway then validates the request body against a JSON Schema model (`AlertRequest`) at the gateway level — missing required fields or invalid enum values are rejected with `400` before touching the queue.
2. The gateway writes the message directly to SQS through a VTL mapping template (no Lambda in the ingestion path).
3. Lambda consumes the queue via an event source mapping (batch size 5) and runs the same triage pipeline as the local engine: alert build → data pre-check → LLM risk assessment → payload normalization.
4. The case is written to DynamoDB with a conditional write and logged to the S3 audit bucket. A P1 case then starts the Step Functions approval workflow and waits for a human decision (see the Approval Workflow section); any other risk level that warrants escalation is published to the SNS topic directly, as before.

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
  - Lambda: Python 3.12 / arm64 / 512 MB / 60s, SQS event source mapping with batch size 5 and `ReportBatchItemFailures`, reserved concurrency 5 (later unset — see Phase 3 decision 7)
  - DynamoDB `threatwatch-cases`: partition key `alert_id`, GSI `risk-level-index` (`risk_level` HASH + `created_at` RANGE), on-demand billing
  - SNS topic `threatwatch-escalations` replaces SMTP email delivery in the production path
  - S3 audit logging kept with the same `cases/dt=YYYY-MM-DD/{alert_id}.json` partition layout
  - Separate least-privilege IAM roles for EC2, Lambda, and API Gateway — e.g. the API Gateway role holds only `sqs:SendMessage` on the specific queue
- **Phase 3 — Data engineering + IaC + CI/CD** · Complete
  - Terraform IaC for the entire stack under [`terraform/`](terraform/) — S3 state backend with versioning and native lockfile locking (`use_lockfile = true`, Terraform 1.10+; no separate DynamoDB lock table)
  - `backend.hcl` and `terraform.tfvars` carry the account ID and email, so they are gitignored; `.example` files document the format
  - Glue Crawler over `s3://<audit-bucket>/cases/` — 10 columns inferred, `dt` recognized as a partition key; `WHERE dt = '...'` prunes the scan to a single folder, which caps Athena scan cost
  - Athena workgroup with an enforced result location, SSE-S3 encryption, and a 1 GB per-query scan cap
  - GitHub Actions CI/CD with OIDC — short-lived tokens instead of access keys in GitHub Secrets; PRs run `fmt -check` → `validate` → `plan` (posted as a PR comment), pushes to `main` additionally `apply`
  - Six CloudWatch operational alarms delivered to a dedicated ops SNS topic (see the Monitoring section)
- **Phase 4 — Hardening & orchestration** · In progress
  - **HMAC request signature validation (v2 authentication)** · Complete
    - Lambda authorizer (`authorizer.py`, REQUEST type) verifies an HMAC-SHA256 signature over `"{timestamp}.{nonce}"`, carried in three `x-tw-*` headers
    - Replay protection: ±300s timestamp window plus single-use nonces, consumed with a DynamoDB conditional write and expired automatically via TTL
    - API keys are kept alongside HMAC — the key identifies the caller for Usage Plan quotas, the signature proves authenticity and freshness (see the Authentication section)
    - New resources in [`terraform/auth.tf`](terraform/auth.tf): nonce DynamoDB table, authorizer Lambda (python3.12 / arm64 / 256 MB / 5s), two least-privilege IAM roles (execution + API Gateway invoke), the REQUEST authorizer with result caching disabled, and a 14-day log group
  - **Step Functions HITL approval workflow** · Complete
    - P1 cases no longer end with an automatic notification — the triage Lambda starts the `threatwatch-approval` state machine, and the case stays open until an analyst approves containment, rejects it as a false positive, or the request expires; every other risk level keeps the existing SNS path
    - `waitForTaskToken` callback pattern: the `approval-request` Lambda stores the task token and emails approve/reject links, then exits — the state machine stays paused, at no compute cost, until the callback arrives or the timeout fires
    - Three outcomes — approved, rejected, expired — each recorded on the case as `approval_status` and notified (see the Approval Workflow section)
    - New resources in [`terraform/hitl.tf`](terraform/hitl.tf) and [`terraform/api_approvals.tf`](terraform/api_approvals.tf): the state machine with execution logging, three Lambdas (`approval-request`, `approval-callback`, `approval-finalize`; python3.12 / arm64 / 256 MB) each with a least-privilege role and a 14-day log group, an approvals DynamoDB table with TTL, and the `GET /approvals` callback endpoint (`AWS_PROXY` integration, no API key, no authorizer — see the Approval Workflow section for why)
    - The triage Lambda role gains `states:StartExecution` on the state machine, and the function gains a `STATE_MACHINE_ARN` environment variable; when the variable is unset, P1 falls back to the plain SNS path
    - Also fixed along the way: `build.sh` was deleting `*.dist-info` directories, which broke `httpx` at import time (see Known Issues)
  - Evaluation of Amazon Bedrock for the LLM assessment step · Planned

Key design decisions in Phase 2:

1. **Idempotency** — cases are written to DynamoDB with an `attribute_not_exists(alert_id)` conditional write. SQS is at-least-once delivery, so the same alert can be redelivered; when the conditional write fails, notification is skipped, and no duplicate escalation email goes out.
2. **Partial batch failure** — the handler returns `batchItemFailures` so only failed messages are retried. Without this, one failure in a batch of 5 would retry all 5 messages and waste LLM calls.
3. **Error classification** — payloads that are invalid by themselves (`InvalidPayload`) would fail identically on retry, so they are dropped immediately; every other error is retried and isolated to the DLQ after 3 attempts. A dedicated exception type is used because catching something broad like `ValueError` would also swallow subclasses such as `UnicodeEncodeError` and silently delete real failures.
4. **LLM failure propagation** — outside `DEMO_MODE`, an LLM error raises instead of writing a fallback assessment. A fallback would store a P1 incident as P2 and notify at that lower level.
5. **Scenario overrides stay demo-only** — the Lambda path does not call `scenario_switch`; forced scenario overrides would overwrite the LLM verdict on real alerts. The local `main.py` demo path keeps them.
6. **IAM role separation** — EC2, Lambda, and API Gateway each have their own role, scoped to the minimum actions and resources they need.

Key design decisions in Phase 3:

1. **Secrets stay out of IaC** — managing the Anthropic API key as an `aws_ssm_parameter` would record its plaintext value in the Terraform state file, and the state lives in S3, so anyone able to read the state could read the key. The parameter is managed manually via the CLI and Terraform only references its path. On top of that, the CI deploy role carries an explicit `Deny` on `ssm:GetParameter*` for the `/threatwatch/*` path, so CI can never read the secret.
2. **Import vs. recreate** — only the audit bucket was brought in with `terraform import`; everything else was deleted and recreated. The bucket holds the data Athena reads, so it had to be preserved; the rest is just state that was cheap to rebuild. Confirming that a single `terraform apply` reproduces the whole stack was more valuable than matching every attribute by hand through imports.
3. **Explicit log groups** — if Lambda is left to auto-create its log group, retention defaults to "never expire" and log costs accumulate indefinitely. An `aws_cloudwatch_log_group` resource pins retention to 14 days.
4. **`treat_missing_data = "notBreaching"`** — SQS reports no metric data when there are no messages. Without this setting, the DLQ alarm would sit in `INSUFFICIENT_DATA` and never fire.
5. **Separate ops alarm topic** — security escalations and system-failure alerts differ in nature and may have different recipients, so operational alarms publish to their own SNS topic instead of reusing `threatwatch-escalations`.
6. **API response mapping** — left at defaults, the raw SQS XML response is exposed to the client. An integration response template returns consistent JSON instead, and the status code is **202**, not 200: the request has only been accepted — triage has not finished yet.
7. **No reserved concurrency (for now)** — new AWS accounts have a concurrent-execution limit of 10. Reserving 5 would drop unreserved capacity below the minimum of 10, which the API rejects. The low account limit already provides the runaway protection, and the reservation will be restored after a limit increase.

Key design decisions in Phase 4 (HMAC authentication):

1. **The request body is not signed — an explicit, accepted limitation.** A REQUEST-type authorizer on a REST API never receives the request body; only headers and the query string are available. This layer therefore provides sender authentication and replay protection, but **not body integrity**. Defense against body tampering relies on HTTPS in transit and the gateway's JSON Schema validation for shape enforcement. Signing the body would require giving up the direct SQS integration and putting a Lambda at the entry point — paying compute on every ingest and losing the queue's buffering. That trade-off was considered and declined.
2. **API key and HMAC serve different roles.** The API key was not removed: it is tied to the Usage Plan and handles usage tracking and quotas, while HMAC handles authenticity and freshness. AWS documentation itself positions API keys as usage identifiers, not an authentication mechanism.
3. **`authorizer_result_ttl_in_seconds = 0`.** Caching authorizer results would defeat replay protection — a cached Allow policy lets the same signature through repeatedly while it lives. Since the nonce changes on every request, the cache hit rate would be effectively zero anyway.
4. **`hmac.compare_digest` for signature comparison.** Comparing signatures with `==` takes time proportional to the length of the matching prefix, which lets a timing attack guess the signature one byte at a time. A constant-time comparison is required.
5. **No failure reasons in responses.** Distinguishing an expired timestamp from a signature mismatch from a reused nonce would hand an attacker useful information. Every verification failure returns the same Deny policy; the specific reason is logged to CloudWatch only.
6. **Nonce TTL.** Requests outside the allowed time window are already rejected by the timestamp check, so a nonce only needs to be kept until `timestamp + 300 + 60`. DynamoDB TTL deletes expired items automatically — no cleanup job needed.
7. **The secret stays out of IaC.** The shared HMAC secret follows the same principle as the Anthropic API key (Phase 3 decision 1): managing it as an `aws_ssm_parameter` would record its plaintext in the state file, so `/threatwatch/hmac-secret` is registered manually via the CLI and Terraform only references the path.

Key design decisions in Phase 4 (HITL approval):

1. **`waitForTaskToken` instead of waiting inside Lambda.** Handling the approval wait inside a Lambda would pin it to the 15-minute execution ceiling and bill for every second of idle waiting. A paused Step Functions state costs nothing in compute and can wait up to a year; the Lambda only stores the token, sends the email, and exits.
2. **The callback endpoint is not HMAC-signed — an explicit, accepted limitation.** The approval link is a plain GET opened from an email in a browser, and browsers cannot attach custom headers, so the signature scheme used by `POST /alerts` is impossible here. Instead the `approval_id` itself is the credential: unguessable (`secrets.token_urlsafe(32)`), single-use (a DynamoDB conditional update consumes it), and expiring (table TTL). The flip side is stated plainly: anyone who obtains a live link can make the decision. A leaked link implies a compromised recipient mailbox, which is treated as a separate threat.
3. **No API key on the callback either.** Embedding a key in a browser link would leave it sitting in the email body and in browser history.
4. **Rejection uses `SendTaskSuccess`, not `SendTaskFailure`.** An analyst marking a case as a false positive is a normal, expected outcome of the workflow. `SendTaskFailure` is reserved for genuine workflow errors, so the Step Functions execution-failure metric reflects real faults only.
5. **The execution name is pinned to `alert_id` — a second idempotency gate.** Step Functions rejects a second execution with the same name for 90 days. If a duplicate somehow slips past the DynamoDB conditional write (the first gate), it is stopped here.
6. **The approvals table is separate from the cases table.** Approvals have their own lifecycle (expiry, potential re-sends), and the callback Lambda has no reason to hold access to the full case table.
7. **A timeout is an outcome, not silence.** Nobody responding to a security incident is itself a situation that needs a response. Expiry is caught, recorded on the case as `expired`, and re-notified rather than quietly dropped.
8. **Environment-variable guard.** If `STATE_MACHINE_ARN` is unset, P1 cases fall back to the existing SNS path, so the pipeline keeps working before the state machine is deployed and in local runs.

## Approval Workflow

P1 cases wait for a human decision instead of ending with an automatic notification. The `threatwatch-approval` Step Functions state machine ([`terraform/hitl.tf`](terraform/hitl.tf)) orchestrates the wait, and three dedicated Lambdas do the work:

| Lambda | Role |
| --- | --- |
| [`approval_request.py`](approval_request.py) | stores the task token and an approval record, emails approve/reject links |
| [`approval_callback.py`](approval_callback.py) | handles the link click, resumes the state machine via `SendTaskSuccess` |
| [`approval_finalize.py`](approval_finalize.py) | records the outcome on the case, sends the outcome notification |

### State machine

Three states:

1. **`RequestApproval`** — a Task state using `arn:aws:states:::lambda:invoke.waitForTaskToken`. The `approval-request` Lambda writes the task token to the approvals table and publishes the approval email, then exits — but the state machine stays paused until someone calls back with the token. `TimeoutSeconds` bounds the wait (`approval_timeout_sec` variable, default 3600); `States.Timeout` is caught and routed to `MarkExpired` instead of failing the execution. On a callback, transitions to `Finalize`.
2. **`MarkExpired`** — a Pass state that stamps `decision = expired` onto the payload, then transitions to `Finalize`.
3. **`Finalize`** — a Task state invoking `approval-finalize`, with exponential-backoff retries on Lambda service exceptions. All three outcomes converge here.

### Outcomes

| Outcome | Trigger | `approval_status` on the case |
| --- | --- | --- |
| Approved | approve link clicked | `approve` |
| Rejected (false positive) | reject link clicked | `reject` |
| Expired | no decision before the timeout | `expired` |

`Finalize` writes `approval_status` and `approval_decided_at` onto the case row in the cases table — these attributes exist only on cases that went through the approval path — and publishes an outcome notification to the escalation topic. Expiry deliberately gets the same treatment as a decision: the case is marked `expired` and re-notified, because an unanswered P1 still needs attention (Phase 4 HITL decision 7).

### Callback authentication — and its limits

`GET /approvals` ([`terraform/api_approvals.tf`](terraform/api_approvals.tf)) is opened from an email link in a browser, so it carries neither the HMAC signature headers nor an API key (Phase 4 HITL decisions 2 and 3). The `approval_id` in the query string is the sole credential:

- **unguessable** — generated with `secrets.token_urlsafe(32)`
- **single-use** — consumed with a DynamoDB conditional update, so a double click or a shared link registers only the first request; repeat visits get a uniform "already handled" page that does not distinguish already-decided from expired
- **expiring** — the approvals table has TTL enabled; the record intentionally outlives the state-machine timeout so that a late click hits a clean "already handled" page instead of a dangling callback

To be explicit about the boundary of this scheme: the endpoint performs **no signature verification**, and anyone holding a live link can make the decision. That is accepted because a leaked link implies a compromised recipient mailbox, which is a separate threat this layer does not try to solve.

## Infrastructure as Code

All AWS resources are defined in [`terraform/`](terraform/). State is stored in a versioned S3 bucket and locked with Terraform's native S3 lockfile (`use_lockfile = true`, Terraform 1.10+), so no DynamoDB lock table is needed.

### Prerequisites (one-time, outside Terraform)

- Create the state bucket manually — the bucket that stores Terraform state cannot be managed by the state it stores, so this bootstrap step stays outside Terraform:

  ```bash
  aws s3api create-bucket --bucket <state-bucket> \
    --create-bucket-configuration LocationConstraint=ap-northeast-2
  aws s3api put-bucket-versioning --bucket <state-bucket> \
    --versioning-configuration Status=Enabled
  ```

- Register the Anthropic API key in SSM Parameter Store (never through Terraform — see Phase 3 decision 1):

  ```bash
  aws ssm put-parameter --name /threatwatch/anthropic-api-key \
    --type SecureString --value <key>
  ```

### Configure and apply

`backend.hcl` and `terraform.tfvars` contain the account-specific values and are gitignored; copy them from the `.example` files and fill them in:

```bash
cd terraform
cp backend.hcl.example backend.hcl           # state bucket name, key, region
cp terraform.tfvars.example terraform.tfvars # alert_email (and any overrides)
```

Build the Lambda package first — `compute.tf` reads the zip with `filebase64sha256`, so `plan` fails if it is missing — then run the standard flow:

```bash
./build.sh   # from the repository root
cd terraform
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

### Outputs

`terraform output` replaces the manually maintained `.env.aws`. To inject the endpoints and resource identifiers into your shell:

```bash
eval "$(terraform output -raw env_exports)"
```

This exports `API_URL`, `QUEUE_URL`, `DLQ_URL`, `TABLE_NAME`, `TOPIC_ARN`, `S3_AUDIT_BUCKET`, `KEY_ID`, and friends. The API key value itself is intentionally not an output (outputs land in the state file); fetch it on demand with `aws apigateway get-api-key --api-key $KEY_ID --include-value`.

## CI/CD

[`terraform.yml`](.github/workflows/terraform.yml) runs on changes to `terraform/**`, the Lambda source files (`modules/**`, `lambda_handler.py`, `config.py`, `models.py`, `scenarios.py`, `requirements.txt`, `build.sh`), or the workflow itself. Documentation-only changes (like this README) do not trigger it.

- **Pull requests** — build the Lambda package, then `terraform fmt -check` → `init` → `validate` → `plan`. The plan output is posted as a PR comment so the reviewer sees exactly what would change. Nothing is applied from a PR.
- **Push to `main`** — the same steps, followed by `terraform apply`.

Authentication uses GitHub's OIDC provider instead of access keys stored in GitHub Secrets: the workflow exchanges a short-lived GitHub-issued token for the deploy role, so there is no long-lived credential to leak. The role's trust policy restricts `token.actions.githubusercontent.com:sub` to this specific repository — without that condition, any GitHub repository could assume the role.

Required GitHub Secrets:

| Secret | Purpose |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | IAM role the workflow assumes via OIDC |
| `TF_STATE_BUCKET` | S3 bucket holding the Terraform state |
| `ALERT_EMAIL` | passed to Terraform as the alarm/escalation subscription address |

## Analytics

A Glue Crawler infers the schema of the S3 audit logs (`cases/dt=YYYY-MM-DD/*.json`) into the `threatwatch` Glue database as the `cases` table, with `dt` as a partition key. Run it after seeding data or when new date partitions appear:

```bash
aws glue start-crawler --name threatwatch-cases-crawler
```

`./seed_alerts.sh` sends ten sample alerts through the real API path to generate queryable data. Each alert is signed with a fresh nonce, so the script needs `HMAC_SECRET` exported (see Environment Setup).

Queries run in the `threatwatch` Athena workgroup, which enforces the result location, SSE-S3 encryption, and a 1 GB per-query scan cap. Because the data is Hive-partitioned by `dt`, adding `WHERE dt = 'YYYY-MM-DD'` scans only that day's folder.

Risk-level distribution:

```sql
SELECT risk_level, COUNT(*) AS cases
FROM threatwatch.cases
GROUP BY risk_level
ORDER BY cases DESC;
```

Highest risk score per incident type:

```sql
SELECT incident_type, MAX(risk_score) AS max_score, COUNT(*) AS cases
FROM threatwatch.cases
GROUP BY incident_type
ORDER BY max_score DESC;
```

Low-confidence cases worth a human look:

```sql
SELECT alert_id, incident_type, risk_level, risk_score, confidence
FROM threatwatch.cases
WHERE confidence < 0.7
ORDER BY confidence ASC;
```

> **Note on `missing_data_count`** — despite the name, this is *not* the number of missing fields detected by the `precheck` module. It is the number of additional data items the LLM said it would need for a more confident judgment — the length of `ai_result.missing_data_list`. Keep that in mind when interpreting query results.

## Monitoring

Six CloudWatch alarms publish to a dedicated ops SNS topic, kept separate from the security escalation topic (different audience, different urgency):

| Alarm | Threshold | What it means |
| --- | --- | --- |
| DLQ not empty | > 0 messages | An alert failed processing even after 3 retries — a potentially missed incident |
| Lambda errors | > 2 in 5 min | Code or external-dependency failures |
| Lambda throttles | > 0 | Concurrency limit reached — a capacity problem, distinct from errors |
| Queue backlog | avg > 50 over 2 periods | Processing is not keeping up with intake |
| API 5xx | > 0 | A failure in the gateway or the SQS integration itself |
| API 4xx | > 20 in 5 min | Schema-validation rejections are normal, so the threshold is high — this only catches misuse patterns |

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

### HMAC signing secret (one-time)

The authorizer reads the shared signing secret from SSM Parameter Store (`/threatwatch/hmac-secret`). Like the Anthropic API key, it is registered manually via the CLI — never through Terraform — so its plaintext stays out of the state file (Phase 3 decision 1, Phase 4 decision 7). Route the value through a temporary file rather than the command line, so the secret never lands in shell history:

```bash
umask 077
python3 -c "import secrets; print(secrets.token_hex(32), end='')" > hmac-secret.tmp
aws ssm put-parameter --name /threatwatch/hmac-secret \
  --type SecureString --value file://hmac-secret.tmp
rm hmac-secret.tmp
```

Clients (`send_signed.py`, `seed_alerts.sh`) expect the same value in the `HMAC_SECRET` environment variable.

## Authentication

The API exposes two endpoints with deliberately different authentication models:

| | `POST /alerts` | `GET /approvals` |
| --- | --- | --- |
| Caller | a signing client (script or service) | a human clicking an email link in a browser |
| API key | required — ties the caller to the Usage Plan | none — a key in a browser link would persist in the email body and browser history |
| HMAC signature | required — three `x-tw-*` headers | none — browsers cannot attach custom headers to a link click |
| What authenticates the request | the shared-secret signature | the single-use, unguessable `approval_id` in the query string |
| Replay / reuse protection | ±300s timestamp window + one-time nonce | one-time conditional update + TTL |

The rest of this section covers `POST /alerts`; the callback endpoint's scheme and its limits are described in the Approval Workflow section.

`POST /alerts` is protected by two independent layers with distinct responsibilities:

| Layer | Carried in | Responsibility |
| --- | --- | --- |
| API key | `x-api-key` header | caller identification for the Usage Plan — rate limits and quotas |
| HMAC signature | three `x-tw-*` headers | request authenticity and freshness (replay protection) |

The API key alone is not an authentication mechanism — it travels in plaintext headers and says nothing about whether a request is genuine or fresh. AWS positions API keys as usage identifiers. The HMAC layer is what actually authenticates the sender.

### Signature format

The string to sign is `"{timestamp}.{nonce}"`, and the signature is its HMAC-SHA256 under the shared secret, hex-encoded:

| Header | Value |
| --- | --- |
| `x-tw-timestamp` | Unix epoch seconds |
| `x-tw-nonce` | a value unique to this request |
| `x-tw-signature` | hex of `HMAC-SHA256(secret, "{timestamp}.{nonce}")` |

A Lambda authorizer (REQUEST type, [`authorizer.py`](authorizer.py)) checks, in order: all three headers are present, the timestamp is within ±300 seconds of the current time, the recomputed signature matches (constant-time comparison), and the nonce has never been seen before — consumed with a DynamoDB conditional write, so even two concurrent requests with the same nonce admit only one.

Client-side signing takes a few lines:

```python
import hashlib, hmac, os, secrets, time

timestamp = str(int(time.time()))
nonce = secrets.token_hex(16)
signature = hmac.new(os.environ["HMAC_SECRET"].encode(),
                     f"{timestamp}.{nonce}".encode(), hashlib.sha256).hexdigest()
# send as x-tw-timestamp / x-tw-nonce / x-tw-signature
```

### Response codes

- `202` — accepted and enqueued
- `400` — request body failed gateway-level JSON Schema validation
- `401` — signature headers missing (no authentication was attempted)
- `403` — signature, timestamp, or nonce verification failed; also returned for a missing or invalid API key

All verification failures return the same undifferentiated `403` — the specific reason is deliberately kept out of the response and logged to CloudWatch only.

### What the signature does *not* cover

The request body is **not** part of the signed string, and this is a known limitation, not an oversight. REST API REQUEST-type authorizers do not receive the request body — only headers and the query string. This layer therefore guarantees who sent the request and that it is not a replay, but **it does not guarantee body integrity**. Protection against body tampering rests on HTTPS for the transport path and on the gateway's JSON Schema validation for shape enforcement. Signing the body would require replacing the direct SQS integration with a Lambda entry point, adding compute cost to every ingest and losing the queue's buffering — a trade-off this design consciously declined (Phase 4 decision 1).

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
  -H "x-tw-timestamp: {epoch-seconds}" \
  -H "x-tw-nonce: {unique-nonce}" \
  -H "x-tw-signature: {hmac-sha256-hex}" \
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

- `202` — accepted and enqueued to SQS; processing is asynchronous, so the response confirms receipt, not a completed triage (a mapped JSON body is returned instead of the raw SQS XML)
- `400` — request body failed gateway-level JSON Schema validation
- `401` — HMAC signature headers missing (see Authentication)
- `403` — signature, timestamp, or nonce verification failed, or missing/invalid API key

Assembling the signature headers by hand is error-prone — [`send_signed.py`](send_signed.py) does it for you (see Testing).

## Testing

[`send_signed.py`](send_signed.py) exercises the accept path and every reject path of the authentication layer. It reads `API_URL`, `API_KEY`, and `HMAC_SECRET` from the environment:

| Scenario | Command | Expected |
| --- | --- | --- |
| Valid signed request | `python send_signed.py '<json-body>'` | `202` |
| Replay — same nonce sent twice | `python send_signed.py --replay '<json-body>'` | `202`, then `403` |
| Timestamp outside the ±300s window | `python send_signed.py --skew 600 '<json-body>'` | `403` |
| Signature headers omitted | `python send_signed.py --no-sign '<json-body>'` | `401` |

## Deployment

Infrastructure and Lambda code deploy through Terraform — locally via `terraform apply` (see Infrastructure as Code) or automatically on pushes to `main` (see CI/CD). For an ad-hoc code-only update without a Terraform run, build the package and update the function directly:

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

## Known Issues

- **Dependencies are not pinned.** [`requirements.txt`](requirements.txt) uses `>=` ranges, so every build may install different dependency versions. This is why the `dist-info` bug below surfaced late — the code that trips over missing metadata only arrived with a newer transitive version. Pinning exact versions (or adding a lock file) is the outstanding fix.
- **`build.sh` must not delete `*.dist-info` directories.** It briefly did, to shrink the package, but `httpx` (a transitive dependency of `anthropic`) looks up its own version through `importlib.metadata` at import time and fails at runtime with `No package metadata was found` when the metadata directory is gone. The deletion line has been removed — do not reintroduce it.

## Notes

- Secrets are not committed.
- `.env`, `node_modules`, `dist`, virtual environments, and cache files should remain ignored.
- The frontend presentation repo used for Vercel deployment stays separate; this repository is the source-of-truth repo for the backend workflow and AWS migration work.
