# ThreatWatch-AI.demo
LLM-assisted SOC incident triage workflow built in n8n—parses alerts, scores risk, routes escalations, and logs an auditable trail.


ThreatWatch AI is an **LLM-assisted security incident triage workflow** built in **n8n**.  
It converts raw alert/incident inputs into **structured risk assessments** (risk level, score, incident type, summary, entities), then automatically routes cases for **escalation (email)** or **monitoring/logging (Google Sheets audit trail)**.

> Portfolio project for IS 3060 (Business Process Automation / AI-enabled workflow)

---

## What problem this solves

Security teams face:
- **Alert overload** → difficult to prioritize what matters first
- **Inconsistent triage decisions** across analysts
- **Slow escalation** due to manual context gathering & reporting
- Weak **auditability** when decisions are not logged consistently

ThreatWatch AI addresses these by enforcing a consistent pipeline:
**Input → LLM assessment → Parse/Normalize → Decision gateway → Notify + Log**

---

## Key features

- **LLM Risk Assessment**
  - Generates: `risk_level`, `risk_score`, `incident_type`, `summary`, `entities`, `recommended_action`
- **Structured Output (Parse + Normalize)**
  - Converts LLM output into clean JSON fields suitable for automation (no “free-text only” workflow)
- **Decision Gateway (High risk vs Low risk)**
  - High risk → email escalation
  - Low risk → log and monitor/close
- **Low-Confidence Handling (Human-in-the-loop)**
  - If model confidence is low, route to a safer flow (adjust/review) before escalation
- **Retry/Recovery**
  - Adds basic operational resilience when API calls fail or output is malformed
- **Audit Trail**
  - Logs every triage case + decision outputs to Google Sheets for traceability

---

## Tech stack

- **n8n** (workflow orchestration)
- **LLM API** (OpenAI)
- **Google Sheets** (audit logging)
- **Email (Gmail/SMTP)** (escalation alert)
- (Optional) **Python/JavaScript** (parsing/normalization helpers)

---



---

## Workflow overview

### 1) Input
- Manual test trigger or webhook trigger receives incident text / alert payload.

### 2) Pre-check
- Validates required fields (e.g., missing data → return/stop or request more context).

### 3) LLM Risk Assessment
- Sends incident context to LLM
- Asks model to return structured JSON:
  - risk level/score/type/summary/entities/confidence

### 4) Parse + Normalize
- Parses JSON safely
- Normalizes field names/types
- Handles fenced code blocks (```json) or minor formatting issues

### 5) Decision Gateway
- `High Risk?` → Escalate
- else → Log/Monitor/Close

### 6) Outputs
- Escalation: send email notification
- Logging: append row to Google Sheets (audit trail)

---

## How to run locally (n8n)

### Prerequisites
- n8n (cloud or self-hosted)
- LLM API key (OpenAI/Gemini)
- Google account access for Sheets (OAuth)
- Email credentials (Gmail/SMTP)

### Step 1 — Import the workflow
1. Open n8n
2. **Import** → `Import from File`
3. Select: `workflows/threatwatch_ai.workflow.json`

### Step 2 — Set credentials (IMPORTANT)
Create credentials in n8n for:
- LLM provider (OpenAI/Gemini)
- Google Sheets
- Email (Gmail/SMTP)

> Do NOT hardcode API keys in the workflow JSON.

### Step 3 — Prepare Google Sheet (Audit Log)
Create a sheet with headers like:
- `timestamp`
- `incident_id`
- `risk_level`
- `risk_score`
- `incident_type`
- `summary`
- `entities`
- `confidence`
- `recommended_action`
- `route` (escalate/log)
- `raw_input`

### Step 4 — Execute
- Run the workflow using manual trigger with a test incident
- Confirm:
  - High risk → email arrives
  - All cases → row appended to Google Sheets

---

## Sample input / output

### Sample input
See: `docs/sample_input.json`

Example incident text:
- “Multiple failed admin logins from unfamiliar IPs; unusual data export spike…”

### Sample output (normalized JSON)
See: `docs/sample_output.json`

Example fields:
- `risk_level: High`
- `risk_score: 0.87`
- `incident_type: Unauthorized Access`
- `entities: ["admin_account", "suspicious_ip", "data_export"]`
- `confidence: 0.62`
- `recommended_action: "Escalate to Manager; isolate account; preserve logs"`

---

## Security & privacy notes

- This repository **does not include credentials**.
- Add `.env` to `.gitignore` and keep secrets in n8n Credentials Manager.
- Treat incident data as sensitive; avoid uploading real customer/PII logs.

---



## What I learned / portfolio highlights

- Translating **BPMN decision gateways** into executable workflow logic (IF/ELSE routing)
- Making LLM outputs **operationally reliable** via parsing/normalization + confidence handling
- Designing for **auditability** (decision trail) in risk/compliance-sensitive processes
- Building end-to-end automation: input → AI → routing → notification → logging

---


