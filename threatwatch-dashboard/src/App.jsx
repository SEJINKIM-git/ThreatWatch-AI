import { useEffect, useRef, useState } from "react";
import {
  PIPELINE_NODES,
  RISK_META,
  buildAlertData,
  buildDemoResult,
  createSeed,
  normalizeLiveResult,
  pickWeightedScenario,
  resolveScenarioById,
  runPipelineSequence,
} from "./lib/demoEngine.js";

const STORAGE_KEYS = {
  mode: "threatwatch.mode",
  webhookUrl: "threatwatch.webhook_url",
  seed: "threatwatch.seed",
  recipientEmail: "threatwatch.recipient_email",
  language: "threatwatch.language",
};

const THEME = {
  bg: "#0e131f",
  bgDeep: "#090e19",
  panel: "rgba(27, 31, 43, 0.74)",
  panelStrong: "rgba(14, 19, 31, 0.92)",
  panelLow: "rgba(23, 27, 39, 0.86)",
  line: "rgba(186, 209, 255, 0.1)",
  lineStrong: "rgba(186, 209, 255, 0.22)",
  text: "#dee2f3",
  textSoft: "rgba(222, 226, 243, 0.76)",
  textMuted: "rgba(196, 198, 208, 0.52)",
  accentBlue: "#bad1ff",
  accentBlueSoft: "rgba(186, 209, 255, 0.14)",
  accentGold: "#f1cb88",
  accentGoldSoft: "rgba(241, 203, 136, 0.12)",
  accentCoral: "#ffb3ac",
  accentCoralSoft: "rgba(255, 179, 172, 0.12)",
  accentGlow: "rgba(186, 209, 255, 0.45)",
};

const DISPLAY_FONT = "'Space Grotesk', 'Noto Sans KR', sans-serif";
const BODY_FONT = "'Inter', 'Noto Sans KR', sans-serif";
const MONO_FONT = "'JetBrains Mono', monospace";
const WRAP_ANYWHERE = {
  minWidth: 0,
  wordBreak: "break-word",
  overflowWrap: "anywhere",
  hyphens: "auto",
};
const BRAND_LOGO = "/threatwatch-logo.svg";
const LANGUAGE_OPTIONS = ["ko", "en"];

function t(copy, lang) {
  if (copy && typeof copy === "object" && ("ko" in copy || "en" in copy)) {
    return copy[lang] ?? copy.ko ?? copy.en ?? "";
  }
  return copy;
}

const MODE_COPY = {
  demo: {
    label: { ko: "시나리오 모드", en: "Scenario Mode" },
    subtitle: {
      ko: "공유된 incident library를 기반으로 제품 흐름을 안정적으로 검증하는 모드",
      en: "Validate the product flow against the shared incident library.",
    },
  },
  live: {
    label: { ko: "연결된 워크플로우", en: "Connected Workflow" },
    subtitle: {
      ko: "n8n Webhook과 연동해 실제 운영 흐름을 확인하는 모드. 실패 시 동일 case fallback으로 전환",
      en: "Run against the n8n webhook and fall back to the same case if the live call fails.",
    },
  },
};

const NAV_ITEMS = [
  { id: "overview", label: { ko: "플랫폼", en: "Platform" } },
  { id: "problem", label: { ko: "문제", en: "Problem" } },
  { id: "solution", label: { ko: "솔루션", en: "Solution" } },
  { id: "process", label: { ko: "워크플로우", en: "Workflow" } },
  { id: "simulator", label: { ko: "제품", en: "Product" } },
  { id: "customers", label: { ko: "고객", en: "Customers" } },
];

const HERO_METRICS = [
  { label: { ko: "운영 적합성", en: "Operational Fit" }, value: "SOC + GRC", note: { ko: "하나의 workflow layer 안에서 triage, approval, audit 수행", en: "Triage, approval, and audit inside one workflow layer" } },
  { label: { ko: "응답 시간", en: "Response Window" }, value: "30 min SLA", note: { ko: "규제 산업 보안팀을 위한 시간 민감형 스크리닝", en: "Time-sensitive screening for regulated security teams" } },
  { label: { ko: "의사결정 통제", en: "Decision Control" }, value: "HITL", note: { ko: "최종 에스컬레이션 경계는 관리자 승인으로 유지", en: "Manager approval remains the escalation boundary" } },
  { label: { ko: "출력 표준", en: "Output Standard" }, value: "Structured JSON", note: { ko: "리포팅, 로깅, 검토를 위한 일관된 evidence 포맷", en: "Consistent evidence for reporting, logging, and review" } },
];

const AS_IS_ISSUES = [
  { ko: "분산된 SIEM, IAM, 이메일, 시트 사이에서 analyst가 컨텍스트를 수작업으로 모읍니다.", en: "Analysts manually assemble context across SIEM, IAM, email, and spreadsheet surfaces." },
  { ko: "알림이 몰릴 때 우선순위 판단이 사람마다 달라지고, 고위험 항목이 늦게 올라갈 수 있습니다.", en: "When alert volume spikes, prioritization varies by analyst and high-risk cases can be delayed." },
  { ko: "결정 근거가 메신저·스프레드시트에 흩어져 있어서 감사 추적성과 설명 가능성이 약합니다.", en: "Decision rationale is scattered across chat and spreadsheets, weakening auditability and explainability." },
];

const RED_BOX_SCOPE = [
  { ko: "알림 티켓 생성 및 보강", en: "Alert ticket creation + enrichment" },
  { ko: "핵심 누락 데이터 점검 게이트", en: "Missing critical data gate" },
  { ko: "LLM 요약 및 엔터티 추출", en: "LLM summary and entity extraction" },
  { ko: "검증 및 규칙 기반 위험 점수 산정", en: "Validation + rule-based risk scoring" },
  { ko: "관리자 승인 전 에스컬레이션 패키지 초안", en: "Escalation package draft before manager approval" },
];

const TO_BE_PROMISES = [
  { ko: "규칙 기반 점수와 LLM 요약을 결합해 analyst productivity와 triage consistency를 동시에 높입니다.", en: "Combine rule-based scoring and LLM summaries to improve analyst productivity and triage consistency." },
  { ko: "고위험은 HITL 승인으로 보내고, 저위험은 monitoring queue 또는 close로 라우팅해 governance를 유지합니다.", en: "Route high-risk cases through HITL approval and low-risk cases into monitoring or close paths." },
  { ko: "모든 결과를 structured JSON과 audit log로 남겨 운영 전반에 재사용 가능한 evidence layer를 제공합니다.", en: "Persist every result as structured JSON and audit logs to create a reusable evidence layer." },
];

const ENTERPRISE_AUDIENCES = [
  {
    title: "SOC Operations",
    label: "Frontline teams",
    text: { ko: "Alert triage, enrichment, case routing, and low-risk queue handling을 표준화합니다.", en: "Standardize alert triage, enrichment, case routing, and low-risk queue handling." },
  },
  {
    title: "Security Leadership",
    label: "Approval owners",
    text: { ko: "Escalation approval, SLA visibility, and analyst decision quality를 한 화면에서 확인합니다.", en: "Give approval owners one surface for escalation, SLA visibility, and analyst decision quality." },
  },
  {
    title: "Compliance and Audit",
    label: "Governance teams",
    text: { ko: "Structured JSON, decision rationale, and monitoring logs로 감사 대응 품질을 높입니다.", en: "Improve audit readiness with structured JSON, decision rationale, and monitoring logs." },
  },
  {
    title: "MSSP / Enterprise IT",
    label: "Service delivery",
    text: { ko: "반복 가능한 triage workflow를 여러 고객사나 내부 사업부에 동일한 방식으로 제공할 수 있습니다.", en: "Deliver the same repeatable triage workflow across customers or internal business units." },
  },
];

const TRUST_BAND = ["Telecom", "Financial Services", "Enterprise IT", "MSSP", "E-commerce", "Public Sector"];
const COMPLIANCE_STRIP = ["SOC2 Type II", "ISO 42001", "HITL Approval", "Audit-Ready JSON"];

const PLATFORM_MODULES = [
  {
    title: "Unified Intake",
    text: { ko: "Alert, enrichment, and missing-data review를 하나의 case surface로 통합합니다.", en: "Unify alert intake, enrichment, and missing-data review inside one case surface." },
  },
  {
    title: "Decision Intelligence",
    text: { ko: "LLM summary와 rule-based scoring을 결합해 analyst judgement를 보강합니다.", en: "Combine LLM summaries and rule-based scoring to support analyst judgment." },
  },
  {
    title: "Approval Workflow",
    text: { ko: "Escalation 전 manager review를 명시적으로 남겨 enterprise control을 유지합니다.", en: "Keep enterprise control by preserving an explicit manager review before escalation." },
  },
  {
    title: "Audit-Ready Output",
    text: { ko: "Structured JSON, queue outcome, timestamps, sheets logging으로 governance evidence를 축적합니다.", en: "Create governance evidence with structured JSON, queue outcomes, timestamps, and sheet logging." },
  },
];

const ENTERPRISE_OUTCOMES = [
  { label: { ko: "트리아지 시간", en: "Time to Triage" }, value: { ko: "감소", en: "Down" }, note: { ko: "표준화된 intake로 수작업 검토 부담 감소", en: "Reduce manual review overhead through standardized intake." } },
  { label: { ko: "판단 일관성", en: "Decision Consistency" }, value: { ko: "향상", en: "Up" }, note: { ko: "공유된 scoring logic과 approval gate를 팀 전반에 적용", en: "Apply shared scoring logic and approval gates across teams." } },
  { label: { ko: "감사 대응", en: "Audit Readiness" }, value: { ko: "내장", en: "Built-in" }, note: { ko: "첫 도입 시점부터 structured rationale과 로그 확보", en: "Ship structured rationale and logging from day one." } },
];

const SOLUTION_PILLARS = [
  {
    title: "Workflow Layer Over Alert Chaos",
    text: { ko: "ThreatWatch AI는 분산된 alert 데이터를 하나의 triage workspace로 모으고, 핵심 triage 구간을 표준화된 workflow로 바꿉니다.", en: "ThreatWatch AI consolidates fragmented alert data into one triage workspace and standardizes the red-box triage path." },
  },
  {
    title: "AI + Rules + Approval",
    text: { ko: "LLM summary, rule-based risk scoring, manager approval boundary를 결합해 자동화와 책임 통제를 함께 유지합니다.", en: "Combine LLM summaries, rule-based risk scoring, and a manager approval boundary to balance automation with accountability." },
  },
  {
    title: "Audit-Ready Output",
    text: { ko: "각 케이스는 summary, score, rationale, route, missing data를 포함한 structured output으로 남아 운영과 감사에 바로 연결됩니다.", en: "Every case ends as structured output with summary, score, rationale, route, and missing-data state for operations and audit." },
  },
];

const PROCESS_LANES = [
  {
    lane: "Monitoring / SIEM",
    accent: "#70a7ff",
    steps: [
      {
        ids: ["trigger"],
        title: { ko: "이상 신호 감지", en: "Abnormal signal detected" },
        detail: { ko: "SIEM 또는 모니터링 시스템이 알림 티켓을 생성하고 워크플로우를 시작합니다.", en: "The SIEM or monitoring system opens an alert ticket and starts the workflow." },
      },
      {
        ids: ["build"],
        title: { ko: "보강 데이터 수집", en: "Pull enrichment data" },
        detail: { ko: "자산 중요도, PII 여부, geo-IP, 시도 횟수를 하나의 payload로 모읍니다.", en: "Gather asset criticality, PII flag, geo-IP, and attempts count into one payload." },
      },
    ],
  },
  {
    lane: "SOC Analyst",
    accent: "#7f7cff",
    steps: [
      {
        ids: ["precheck"],
        title: { ko: "핵심 누락 데이터 점검", en: "Review missing critical data" },
        detail: { ko: "핵심 필드가 비어 있으면 추가 로그 요청 경로로 다시 보냅니다.", en: "If key fields are absent, loop the case into a request-for-more-evidence path." },
      },
      {
        ids: ["llm", "parse", "confidence"],
        title: { ko: "요약 및 검증", en: "Summarize and validate" },
        detail: { ko: "LLM이 엔터티를 추출하고 strict JSON을 작성한 뒤, 구조와 confidence를 검증합니다.", en: "The LLM extracts entities and writes strict JSON, then the workflow validates structure and confidence." },
      },
      {
        ids: ["normalize", "decision"],
        title: { ko: "점수 산정 및 라우팅", en: "Score and route" },
        detail: { ko: "점수, PII 노출 여부, 이상 볼륨 임계치로 최종 심각도를 계산합니다.", en: "Rules compute final severity using score, PII exposure, and suspicious volume thresholds." },
      },
    ],
  },
  {
    lane: "SOC Manager / HITL",
    accent: "#f06bc2",
    steps: [
      {
        ids: ["action"],
        title: { ko: "에스컬레이션 승인 또는 보류", en: "Approve escalation or hold" },
        detail: { ko: "P1/P2 에스컬레이션 패키지의 책임 경계는 관리자 승인으로 유지됩니다.", en: "Manager review remains the accountability gate for P1/P2 escalation packages." },
      },
      {
        ids: ["action"],
        title: { ko: "저위험 경로 문서화", en: "Document low-risk path" },
        detail: { ko: "저위험 사건은 모니터링 큐로 보내거나 감사 가능한 근거와 함께 종료합니다.", en: "Low-severity incidents are assigned to monitoring or closed with an auditable rationale." },
      },
    ],
  },
  {
    lane: "IR / Compliance",
    accent: "#ff8156",
    steps: [
      {
        ids: ["action"],
        title: { ko: "IR로 에스컬레이션", en: "Escalated to IR" },
        detail: { ko: "승인된 고위험 사건은 컨텍스트, 점수, 권고안을 함께 첨부해 downstream으로 전달합니다.", en: "Approved high-risk cases move downstream with context, score, and recommendation attached." },
      },
      {
        ids: ["action"],
        title: { ko: "모니터링 로그 기록", en: "Logged for monitoring" },
        detail: { ko: "모든 케이스는 보고, 감사, 사후 통계 분석을 위해 기록됩니다.", en: "Every case is still recorded for reporting, audit review, and later statistical analysis." },
      },
    ],
  },
];

const ENGINE_MAP = [
  { node: "Webhook", meaning: { ko: "알림 수신 및 워크플로우 트리거", en: "Alert intake / workflow trigger" }, stage: { ko: "BPMN: 티켓 생성", en: "BPMN: ticket created" } },
  { node: "02_Build_Alert_Data", meaning: { ko: "보강 정보와 payload 조립", en: "Enrichment and payload assembly" }, stage: { ko: "BPMN: 보강 데이터 수집", en: "BPMN: pull enrichment data" } },
  { node: "03_PreCheck_Requirements", meaning: { ko: "핵심 누락 필드 점검", en: "Check for missing critical fields" }, stage: { ko: "BPMN: 핵심 데이터 누락 여부", en: "BPMN: missing critical data?" } },
  { node: "05_LLM_Risk_Assessment", meaning: { ko: "LLM 요약 및 엔터티 추출", en: "LLM summary and entity extraction" }, stage: { ko: "BPMN: 알림 요약", en: "BPMN: summarize alert" } },
  { node: "06_Parse_LLM_Output", meaning: { ko: "스키마 파싱과 구조화 출력", en: "Schema parsing and structured output" }, stage: { ko: "BPMN: structured JSON 검증", en: "BPMN: validate structured JSON" } },
  { node: "08_Normalize_Final_Payload", meaning: { ko: "표준 triage JSON 출력", en: "Canonical triage JSON output" }, stage: { ko: "BPMN: 최종 판단 패키지 생성", en: "BPMN: compute final decision package" } },
  { node: "09_Risk_Level_Decision", meaning: { ko: "P1 / P2 / P3 라우팅", en: "P1 / P2 / P3 routing" }, stage: { ko: "BPMN: 심각도 결정", en: "BPMN: severity decision" } },
  { node: "Email + Google Sheets", meaning: { ko: "에스컬레이션 알림과 감사 로그", en: "Escalation notification and audit log" }, stage: { ko: "BPMN: 승인 + 모니터링 로그", en: "BPMN: approval + monitoring log" } },
];

const AUDIT_PILLARS = [
  {
    title: "Structured Triage JSON",
    text: { ko: "요약, 엔터티, 점수, confidence, recommendation을 같은 스키마로 저장해 결과를 설명할 수 있게 만듭니다.", en: "Store summary, entities, score, confidence, and recommendations in one schema so every result remains explainable." },
  },
  {
    title: "Manager Approval Boundary",
    text: { ko: "고위험 escalation은 자동 완결이 아니라 승인 게이트를 통과해야 하므로 실제 운영에서 책임 경계가 분명합니다.", en: "High-risk escalation must pass an approval gate rather than auto-close, preserving accountability in real operations." },
  },
  {
    title: "Retry and Fallback",
    text: { ko: "missing critical data, low confidence, live webhook failure 같은 예외를 기록하고 안전한 fallback 경로를 보여줍니다.", en: "Record missing-data, low-confidence, and live-webhook exceptions while exposing a safe fallback path." },
  },
  {
    title: "Sheets-Based Reporting",
    text: { ko: "P1/P2/P3를 모두 시트에 쌓아 운영 통계, 감사, 사후 분석까지 하나의 로그로 이어집니다.", en: "Keep P1/P2/P3 decisions in one reporting surface for operations, audit, and retrospective analysis." },
  },
];

const CUSTOMER_SEGMENTS = [
  {
    title: "Telecommunications",
    text: { ko: "대규모 로그인 이상 징후, 데이터 유출 경보, SLA 중심 대응이 필요한 통신 사업자에게 적합합니다.", en: "Fit for telecom operators handling high-volume login anomalies, data exfiltration alerts, and SLA-driven response." },
  },
  {
    title: "Financial Services",
    text: { ko: "PII, 계정 탈취, 승인 경계, 감사 대응이 중요한 금융사와 핀테크 운영팀에 잘 맞습니다.", en: "Fit for financial institutions and fintech teams where PII, account takeover, approval boundaries, and audit response are critical." },
  },
  {
    title: "E-commerce & Digital Platforms",
    text: { ko: "burst traffic와 계정 보안 이슈가 잦은 대형 플랫폼에서 저위험 자동 분류와 고위험 escalation 기준을 표준화할 수 있습니다.", en: "Standardize low-risk routing and high-risk escalation in large platforms facing burst traffic and account security issues." },
  },
  {
    title: "MSSP & Enterprise IT",
    text: { ko: "여러 고객사나 사업부에 동일한 triage 규칙과 evidence format을 적용해야 하는 MSSP와 대기업 IT 보안 조직에 유용합니다.", en: "Useful for MSSPs and enterprise IT security teams that need consistent triage rules and evidence formats across customers or business units." },
  },
];

const CUSTOMER_SIGNALS = [
  { ko: "High alert volume와 짧은 triage SLA가 동시에 존재하는 조직", en: "Organizations facing both high alert volume and short triage SLAs." },
  { ko: "Escalation approval을 사람에게 남겨야 하는 규제·감사 환경", en: "Regulated environments where escalation approval must remain with a human." },
  { ko: "SIEM/monitoring 이후 triage bottleneck이 운영 비용으로 누적되는 팀", en: "Teams where the post-SIEM triage bottleneck is compounding operational cost." },
  { ko: "AI 요약을 쓰되 결과를 규칙과 로그로 설명 가능하게 남겨야 하는 고객", en: "Customers that want AI summaries but still need explainable rules and logs." },
];

function readStoredValue(key, fallback) {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function writeStoredValue(key, value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}

function normalizeRecipientEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeRecipientEmail(value));
}

function NarrativeHeader({ eyebrow, title, description, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "20px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "18px" }}>
      <div style={{ maxWidth: "760px" }}>
        <div
          style={{
            fontSize: "11px",
            color: THEME.accentBlue,
            textTransform: "uppercase",
            letterSpacing: "0.28em",
            fontWeight: 700,
            fontFamily: DISPLAY_FONT,
            textShadow: `0 0 10px ${THEME.accentGlow}`,
          }}
        >
          {eyebrow}
        </div>
        <h2
          style={{
            margin: "8px 0 0",
            color: THEME.text,
            fontSize: "clamp(32px, 4vw, 46px)",
            lineHeight: 1.04,
            fontWeight: 800,
            fontFamily: DISPLAY_FONT,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </h2>
        <p style={{ margin: "12px 0 0", color: THEME.textSoft, fontSize: "15px", lineHeight: 1.8, fontFamily: BODY_FONT, ...WRAP_ANYWHERE }}>{description}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

function PageSection({ id, tint = THEME.lineStrong, children }) {
  return (
    <section id={id} style={{ marginTop: "88px", scrollMarginTop: "120px", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "1px",
          background: `linear-gradient(90deg, transparent, ${tint}, transparent)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "1px",
          height: "88px",
          background: `linear-gradient(180deg, ${tint}, rgba(0,0,0,0))`,
          opacity: 0.18,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          paddingTop: "30px",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function SectionPanel({ title, subtitle, children, accent = "rgba(255,255,255,0.07)" }) {
  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${THEME.panel}, ${THEME.panelLow})`,
        border: `1px solid ${accent}`,
        borderRadius: "24px",
        padding: "20px",
        boxShadow: `0 0 0 1px ${THEME.line}, inset 0 0 20px rgba(186, 209, 255, 0.04), 0 24px 54px rgba(9,14,25,0.24)`,
        backdropFilter: "blur(20px)",
      }}
    >
      <div style={{ marginBottom: "16px" }}>
        <div
          style={{
            fontSize: "11px",
            color: THEME.textMuted,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            fontWeight: 700,
            fontFamily: DISPLAY_FONT,
          }}
        >
          {title}
        </div>
        {subtitle ? <div style={{ marginTop: "6px", color: THEME.textSoft, fontSize: "12px", lineHeight: 1.7, fontFamily: BODY_FONT, ...WRAP_ANYWHERE }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}

function TrustBand({ lang }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        marginTop: "18px",
        padding: "16px 18px",
        borderRadius: "22px",
        background: THEME.panelLow,
        border: `1px solid ${THEME.line}`,
        boxShadow: `inset 0 0 18px rgba(186, 209, 255, 0.04)`,
      }}
    >
      <span style={{ color: THEME.textMuted, fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: DISPLAY_FONT }}>{lang === "ko" ? "적합 산업" : "Designed for teams in"}</span>
      {TRUST_BAND.map((item) => (
        <span
          key={item}
          style={{
            padding: "8px 12px",
            borderRadius: "12px",
            background: "rgba(48,53,65,0.4)",
            border: `1px solid ${THEME.line}`,
            color: THEME.textSoft,
            fontSize: "12px",
            fontWeight: 600,
            fontFamily: BODY_FONT,
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function ComplianceStrip() {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: "14px 28px",
        padding: "18px 20px",
        marginTop: "18px",
        borderRadius: "22px",
        background: THEME.panelLow,
        border: `1px solid ${THEME.line}`,
        boxShadow: `0 0 0 1px rgba(186,209,255,0.04)`,
      }}
    >
      {COMPLIANCE_STRIP.map((item) => (
        <div key={item} style={{ display: "flex", alignItems: "center", gap: "10px", color: THEME.textSoft }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: THEME.accentBlue, boxShadow: `0 0 14px ${THEME.accentGlow}` }} />
          <span style={{ fontFamily: DISPLAY_FONT, fontSize: "11px", letterSpacing: "0.18em", textTransform: "uppercase" }}>{item}</span>
        </div>
      ))}
    </div>
  );
}

function HeroProductPreview({ mode, status, lastRunMeta, lang }) {
  return (
    <div
      style={{
        borderRadius: "28px",
        padding: "24px",
        background: `linear-gradient(180deg, ${THEME.panelStrong}, ${THEME.panelLow})`,
        border: `1px solid ${THEME.lineStrong}`,
        boxShadow: `inset 0 0 20px rgba(186,209,255,0.05), 0 20px 42px rgba(9,14,25,0.28)`,
        backdropFilter: "blur(18px)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: THEME.textMuted, fontSize: "10px", letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: DISPLAY_FONT }}>{lang === "ko" ? "명령 워크스페이스" : "Command Workspace"}</div>
          <div style={{ marginTop: "6px", color: THEME.text, fontSize: "24px", fontWeight: 800, fontFamily: DISPLAY_FONT, letterSpacing: "-0.02em" }}>{lang === "ko" ? "실시간 제어 화면" : "Live Control Surface"}</div>
        </div>
        <div style={{ padding: "8px 12px", borderRadius: "999px", background: THEME.accentBlueSoft, border: `1px solid ${THEME.lineStrong}`, color: THEME.text, fontSize: "10px", fontWeight: 700, fontFamily: DISPLAY_FONT, letterSpacing: "0.16em", textTransform: "uppercase" }}>
          {t(MODE_COPY[mode].label, lang)}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginTop: "18px" }}>
        <div
          style={{
            borderRadius: "18px",
            padding: "16px",
            background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))",
            border: `1px solid ${THEME.line}`,
          }}
        >
          <div style={{ color: THEME.textMuted, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.18em", fontFamily: DISPLAY_FONT }}>{lang === "ko" ? "제어 신호" : "Control signals"}</div>
          <div style={{ marginTop: "12px", display: "grid", gap: "10px" }}>
            {(lang === "ko" ? ["통합 인테이크", "승인 워크플로우", "감사 대응 증적"] : ["Unified intake", "Approval workflow", "Audit-ready evidence"]).map((item) => (
              <div
                key={item}
                style={{
                  borderRadius: "14px",
                  padding: "12px 14px",
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${THEME.line}`,
                  color: THEME.textSoft,
                  fontSize: "13px",
                  fontFamily: BODY_FONT,
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: "10px" }}>
          <MetricCard label={lang === "ko" ? "워크스페이스 상태" : "Workspace Status"} value={status === "done" ? (lang === "ko" ? "운영 중" : "Operational") : status === "running" ? (lang === "ko" ? "케이스 처리 중" : "Processing case") : (lang === "ko" ? "검토 준비 완료" : "Ready for review")} accent="rgba(142,167,255,0.22)" />
          <MetricCard label={lang === "ko" ? "최근 케이스" : "Last Case"} value={lastRunMeta?.seed || (lang === "ko" ? "첫 실행 대기 중" : "Awaiting first run")} accent="rgba(255,255,255,0.08)" />
          <MetricCard label={lang === "ko" ? "주요 팀" : "Primary Teams"} value="Security Ops + GRC" accent="rgba(212,176,111,0.2)" />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, accent }) {
  return (
    <div
      style={{
        background: "rgba(14,19,31,0.78)",
        border: `1px solid ${accent || THEME.line}`,
        borderRadius: "14px",
        padding: "14px",
        boxShadow: "inset 0 0 14px rgba(186,209,255,0.04)",
      }}
    >
      <div style={{ fontSize: "10px", color: THEME.textMuted, textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: "6px", fontFamily: DISPLAY_FONT }}>{label}</div>
      <div style={{ fontSize: "13px", color: THEME.text, fontWeight: 600, lineHeight: 1.55, whiteSpace: "pre-line", fontFamily: BODY_FONT, ...WRAP_ANYWHERE }}>{value}</div>
    </div>
  );
}

function StatusDot({ status }) {
  const color =
    status === "running" ? "#8ea7ff" : status === "done" ? "#6dbb9b" : status === "error" ? "#e27f77" : "rgba(255,255,255,0.3)";

  return (
    <div
      style={{
        width: "10px",
        height: "10px",
        borderRadius: "999px",
        background: color,
        boxShadow: status === "running" ? "0 0 14px rgba(142,167,255,0.45)" : "none",
      }}
    />
  );
}

function NoticeBanner({ kind, text, lang }) {
  const palette =
    kind === "warning"
      ? { bg: "rgba(255,145,0,0.09)", border: "rgba(255,145,0,0.28)", text: "#ffb74d" }
      : { bg: "rgba(255,23,68,0.08)", border: "rgba(255,23,68,0.28)", text: "#ff6b81" };

  return (
    <div
      style={{
        marginTop: "16px",
        padding: "14px 16px",
        borderRadius: "14px",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <div style={{ fontSize: "11px", color: palette.text, fontWeight: 700, marginBottom: "4px", letterSpacing: "0.5px", fontFamily: DISPLAY_FONT }}>{kind === "warning" ? (lang === "ko" ? "경고" : "WARNING") : (lang === "ko" ? "오류" : "ERROR")}</div>
      <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.8)", lineHeight: 1.7, fontFamily: BODY_FONT, ...WRAP_ANYWHERE }}>{text}</div>
    </div>
  );
}

function TopNav({ mode, status, lang, setLang }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        backdropFilter: "blur(20px)",
        background: "rgba(14,19,31,0.72)",
        borderBottom: `1px solid ${THEME.lineStrong}`,
        boxShadow: "0 20px 40px rgba(9,14,25,0.35)",
      }}
    >
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "18px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img
            src={BRAND_LOGO}
            alt="ThreatWatch AI logo"
            style={{
              height: "46px",
              width: "auto",
              display: "block",
              filter: "drop-shadow(0 0 14px rgba(46,169,242,0.12))",
            }}
          />
          <div>
            <div style={{ color: THEME.accentBlue, fontWeight: 800, fontSize: "18px", fontFamily: DISPLAY_FONT, letterSpacing: "-0.03em" }}>ThreatWatch AI</div>
            <div style={{ color: THEME.textMuted, fontSize: "11px", fontFamily: BODY_FONT }}>{lang === "ko" ? "엔터프라이즈 보안 워크플로우 인텔리전스" : "Enterprise security workflow intelligence"}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                style={{
                  color: THEME.textSoft,
                  textDecoration: "none",
                  fontSize: "11px",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  border: `1px solid ${THEME.line}`,
                  background: "rgba(27,31,43,0.55)",
                  fontFamily: DISPLAY_FONT,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                }}
              >
                {t(item.label, lang)}
              </a>
            ))}
          </div>
          <a
            href="#simulator"
            style={{
              textDecoration: "none",
              fontSize: "11px",
              padding: "10px 14px",
              borderRadius: "10px",
              border: `1px solid ${THEME.lineStrong}`,
              background: "linear-gradient(135deg, rgba(186,209,255,0.16), rgba(154,182,234,0.08))",
              color: THEME.text,
              fontWeight: 700,
              fontFamily: DISPLAY_FONT,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              boxShadow: `0 0 18px rgba(186,209,255,0.12)`,
            }}
          >
            {lang === "ko" ? "제품 둘러보기" : "Explore the product"}
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px", borderRadius: "10px", background: "rgba(27,31,43,0.55)", border: `1px solid ${THEME.line}` }}>
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => setLang(option)}
                style={{
                  border: "none",
                  cursor: "pointer",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  background: lang === option ? "rgba(186,209,255,0.16)" : "transparent",
                  color: lang === option ? THEME.text : THEME.textMuted,
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: DISPLAY_FONT,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                {option}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "10px", background: "rgba(27,31,43,0.55)", border: `1px solid ${THEME.line}` }}>
            <StatusDot status={status} />
            <span style={{ fontSize: "11px", color: THEME.textSoft, fontFamily: DISPLAY_FONT, letterSpacing: "0.16em", textTransform: "uppercase" }}>{t(MODE_COPY[mode].label, lang)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroSection({ mode, status, lastRunMeta, lang }) {
  return (
    <section id="overview" style={{ paddingTop: "40px" }}>
      <div style={{ display: "grid", gap: "18px" }}>
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: "32px",
            border: `1px solid ${THEME.lineStrong}`,
            padding: "32px",
            background: "linear-gradient(180deg, rgba(14,19,31,0.98), rgba(23,27,39,0.98))",
            boxShadow: `0 0 0 1px ${THEME.line}, 0 28px 72px rgba(9,14,25,0.3)`,
            backdropFilter: "blur(12px)",
            isolation: "isolate",
            ...WRAP_ANYWHERE,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, rgba(154,182,234,0.02), transparent 24%, transparent 100%)",
              pointerEvents: "none",
            }}
          />

          <div style={{ position: "relative", zIndex: 1, display: "grid", gap: "18px", alignContent: "start" }}>
            <img
              src={BRAND_LOGO}
              alt="ThreatWatch AI"
              style={{
                width: "min(420px, 100%)",
                height: "auto",
                display: "block",
                filter: "drop-shadow(0 0 18px rgba(46,169,242,0.12))",
              }}
            />
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                borderRadius: "999px",
                border: `1px solid ${THEME.lineStrong}`,
                background: "rgba(255,255,255,0.03)",
                color: THEME.text,
                padding: "8px 14px",
                fontSize: "10px",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                fontWeight: 700,
                fontFamily: DISPLAY_FONT,
                width: "fit-content",
                maxWidth: "100%",
                ...WRAP_ANYWHERE,
              }}
            >
              {lang === "ko" ? "보안 워크플로우 레이어" : "Security Workflow Layer"}
            </div>

            <div
              style={{
                border: `1px solid ${THEME.line}`,
                background: "rgba(9,14,25,0.58)",
                padding: "24px 28px",
                boxShadow: `inset 0 0 30px rgba(186,209,255,0.04)`,
              }}
            >
              <div style={{ color: THEME.textMuted, fontSize: "11px", letterSpacing: "0.24em", textTransform: "uppercase", fontFamily: DISPLAY_FONT, marginBottom: "12px" }}>{lang === "ko" ? "AI 네이티브 보안 운영" : "AI-native security operations"}</div>
              <h1
                style={{
                  margin: 0,
                  fontSize: "clamp(22px, 4vw, 58px)",
                  lineHeight: 1.05,
                  color: THEME.text,
                  fontWeight: 800,
                  fontFamily: DISPLAY_FONT,
                  letterSpacing: "-0.04em",
                  textShadow: "0 0 14px rgba(186,209,255,0.22)",
                  whiteSpace: "nowrap",
                  ...WRAP_ANYWHERE,
                }}
              >
                {lang === "ko" ? "보안 트리아지" : "Security Triage"}
              </h1>
            </div>

            <p style={{ margin: 0, maxWidth: "720px", color: THEME.textSoft, fontSize: "16px", lineHeight: 1.9, fontFamily: BODY_FONT, ...WRAP_ANYWHERE }}>
              {lang === "ko" ? "ThreatWatch AI는 enrichment, LLM summary, rule-based scoring, manager approval, audit logging을 하나의 workflow layer로 묶어 대규모 보안 운영을 더 선명하고 일관되게 만듭니다." : "ThreatWatch AI unifies enrichment, LLM summaries, rule-based scoring, manager approval, and audit logging into one workflow layer for high-volume security operations."}
            </p>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <a
                href="#simulator"
                style={{
                  textDecoration: "none",
                  borderRadius: "10px",
                  border: `1px solid ${THEME.lineStrong}`,
                  background: "linear-gradient(135deg, rgba(186,209,255,0.18), rgba(154,182,234,0.08))",
                  color: THEME.text,
                  padding: "14px 20px",
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: DISPLAY_FONT,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  boxShadow: `0 0 18px rgba(186,209,255,0.14)`,
                }}
              >
                {lang === "ko" ? "제품 둘러보기" : "Explore the Product"}
              </a>
              <a
                href="#process"
                style={{
                  textDecoration: "none",
                  borderRadius: "10px",
                  border: `1px solid ${THEME.line}`,
                  background: "rgba(27,31,43,0.5)",
                  color: THEME.textSoft,
                  padding: "14px 20px",
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: DISPLAY_FONT,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                {lang === "ko" ? "워크플로우 보기" : "See the Workflow"}
              </a>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
              {HERO_METRICS.map((item) => (
                <MetricCard key={t(item.label, lang)} label={t(item.label, lang)} value={`${t(item.value, lang)}\n${t(item.note, lang)}`} accent={THEME.line} />
              ))}
            </div>

            <TrustBand lang={lang} />
          </div>
        </div>

        <div
          style={{
            borderRadius: "30px",
            border: `1px solid rgba(154,182,234,0.22)`,
            background: "linear-gradient(180deg, rgba(14,19,31,0.96), rgba(23,27,39,0.88))",
            padding: "24px",
            boxShadow: `0 0 0 1px ${THEME.line}, 0 20px 48px rgba(9,14,25,0.24)`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "16px" }}>
            <div>
              <div style={{ color: THEME.accentBlue, fontSize: "11px", letterSpacing: "1.8px", textTransform: "uppercase", fontWeight: 700, fontFamily: DISPLAY_FONT }}>
                {lang === "ko" ? "워크스페이스 스냅샷" : "Workspace Snapshot"}
              </div>
              <div style={{ marginTop: "8px", color: THEME.text, fontSize: "28px", fontWeight: 800, fontFamily: DISPLAY_FONT, letterSpacing: "-0.03em", ...WRAP_ANYWHERE }}>
                {lang === "ko" ? "명령 워크스페이스" : "Command Workspace"}
              </div>
              <div style={{ marginTop: "8px", color: THEME.textSoft, fontSize: "13px", lineHeight: 1.7, fontFamily: BODY_FONT, ...WRAP_ANYWHERE }}>
                {lang === "ko" ? "Overview 영역과 실제 제품 워크스페이스를 분리해, 히어로 메시지와 인터페이스 미리보기가 서로 겹치지 않도록 구성했습니다." : "Separate the overview and the product workspace so the hero message and interface preview never overlap."}
              </div>
            </div>
          </div>
          <HeroProductPreview mode={mode} status={status} lastRunMeta={lastRunMeta} lang={lang} />
        </div>
        <ComplianceStrip />
      </div>
    </section>
  );
}

function ProblemSection({ lang }) {
  return (
    <PageSection id="problem" tint="rgba(226,127,119,0.34)">
      <NarrativeHeader
        eyebrow={lang === "ko" ? "운영 문제" : "Operational Pain"}
        title={lang === "ko" ? "볼륨, 규제, 책임이 겹치면 수작업 트리아지는 곧 기업 리스크가 됩니다." : "Manual triage becomes an enterprise risk when volume, regulation, and accountability collide."}
        description={lang === "ko" ? "중요한 것은 단순히 alert를 빠르게 보는 것이 아니라, 어떤 팀이 어떤 근거로 어떤 결정을 내렸는지를 일관되게 설명할 수 있는가입니다. 이 섹션은 기존 운영의 병목과 핵심 자동화 범위를 먼저 보여줍니다." : "Speed alone is not enough. Teams need to show who made which decision, on what basis, and under which controls. This section frames the operational bottleneck and the red-box automation scope first."}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
        <SectionPanel title={lang === "ko" ? "현재 병목" : "As-Is Bottleneck"} subtitle={lang === "ko" ? "대규모 보안 운영 환경에서 반복적으로 나타나는 문제입니다." : "Recurring friction points in enterprise security operations."} accent="rgba(226,127,119,0.18)">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {AS_IS_ISSUES.map((item) => (
              <div key={t(item, lang)} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#ff6b81", marginTop: "7px", flexShrink: 0 }} />
                <div style={{ color: "rgba(255,255,255,0.78)", fontSize: "13px", lineHeight: 1.8, ...WRAP_ANYWHERE }}>{t(item, lang)}</div>
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel title={lang === "ko" ? "자동화 범위" : "Automation Scope"} subtitle={lang === "ko" ? "제품이 우선적으로 표준화하는 핵심 triage 범위입니다." : "The core triage path the product standardizes first."} accent="rgba(212,176,111,0.2)">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {RED_BOX_SCOPE.map((item) => (
              <div
                key={t(item, lang)}
                style={{
                  borderRadius: "14px",
                  padding: "12px 14px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,145,0,0.14)",
                  color: "rgba(255,255,255,0.82)",
                  fontSize: "13px",
                  ...WRAP_ANYWHERE,
                }}
              >
                {t(item, lang)}
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel title={lang === "ko" ? "운영 원칙" : "Operating Principles"} subtitle={lang === "ko" ? "자동화 이후에도 사람이 사라지지 않는다는 점이 중요합니다." : "Automation still keeps a human accountability boundary."} accent="rgba(109,187,155,0.2)">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {TO_BE_PROMISES.map((item) => (
              <div key={t(item, lang)} style={{ color: "rgba(255,255,255,0.78)", fontSize: "13px", lineHeight: 1.8, ...WRAP_ANYWHERE }}>
                {t(item, lang)}
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </PageSection>
  );
}

function SolutionSection({ lang }) {
  return (
    <PageSection id="solution" tint="rgba(142,167,255,0.3)">
      <NarrativeHeader
        eyebrow={lang === "ko" ? "우리의 솔루션" : "Our Solution"}
        title={lang === "ko" ? "ThreatWatch AI는 red-box triage 병목을 통제 가능한 workflow layer로 전환합니다." : "ThreatWatch AI turns the red-box triage bottleneck into a governed workflow layer."}
        description={lang === "ko" ? "우리의 솔루션은 incident response 전체를 대체하는 것이 아니라, 가장 반복적이고 병목이 심한 triage 구간을 표준화하는 것입니다. 그래서 AI 요약, 규칙 기반 점수, 승인 경계, audit log가 하나의 제품 구조 안에서 함께 작동합니다." : "The goal is not to replace the full incident response lifecycle. It is to standardize the most repetitive and bottlenecked triage stage, where AI summaries, scoring rules, approval boundaries, and audit logs work together."}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
        {SOLUTION_PILLARS.map((item) => (
          <SectionPanel key={item.title} title={item.title} accent="rgba(133, 197, 255, 0.16)">
            <div style={{ color: "rgba(255,255,255,0.74)", fontSize: "13px", lineHeight: 1.8, ...WRAP_ANYWHERE }}>{t(item.text, lang)}</div>
          </SectionPanel>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "14px", marginTop: "14px" }}>
        <SectionPanel title={lang === "ko" ? "솔루션 모듈" : "Solution Modules"} subtitle={lang === "ko" ? "실제 SaaS 홈페이지처럼 제품 구조를 capability 중심으로 정리합니다." : "Present the product structure as enterprise capabilities."} accent="rgba(142,167,255,0.16)">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
            {PLATFORM_MODULES.map((item) => (
              <div
                key={item.title}
                style={{
                  borderRadius: "16px",
                  padding: "16px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ color: THEME.text, fontSize: "15px", fontWeight: 700, fontFamily: DISPLAY_FONT, letterSpacing: "0.04em", textTransform: "uppercase", ...WRAP_ANYWHERE }}>{item.title}</div>
                <div style={{ marginTop: "8px", color: "rgba(255,255,255,0.7)", fontSize: "13px", lineHeight: 1.7, ...WRAP_ANYWHERE }}>{t(item.text, lang)}</div>
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel title={lang === "ko" ? "기대 효과" : "Expected Outcomes"} subtitle={lang === "ko" ? "도입 시 기대되는 운영 변화입니다." : "Expected operating changes after adoption."} accent="rgba(212,176,111,0.16)">
          <div style={{ display: "grid", gap: "10px" }}>
            {ENTERPRISE_OUTCOMES.map((item) => (
              <div
                key={item.label}
                style={{
                  borderRadius: "16px",
                  padding: "16px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.8px", ...WRAP_ANYWHERE }}>{t(item.label, lang)}</div>
                  <div style={{ color: THEME.text, fontSize: "16px", fontWeight: 800, fontFamily: DISPLAY_FONT, letterSpacing: "0.04em", ...WRAP_ANYWHERE }}>{t(item.value, lang)}</div>
                </div>
                <div style={{ marginTop: "8px", color: "rgba(255,255,255,0.72)", fontSize: "13px", lineHeight: 1.7, ...WRAP_ANYWHERE }}>{t(item.note, lang)}</div>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </PageSection>
  );
}

function getProcessStepState(stepIds, activeNode, status) {
  const activeIndex = PIPELINE_NODES.findIndex((node) => node.id === activeNode);
  const indexes = stepIds.map((id) => PIPELINE_NODES.findIndex((node) => node.id === id)).filter((index) => index >= 0);
  const firstIndex = indexes.length ? Math.min(...indexes) : -1;
  const lastIndex = indexes.length ? Math.max(...indexes) : -1;

  if (status === "done") return "done";
  if (status === "error" && stepIds.includes(activeNode)) return "error";
  if (stepIds.includes(activeNode)) return "active";
  if (activeIndex >= 0 && lastIndex >= 0 && lastIndex < activeIndex) return "done";
  if (status === "error" && activeIndex >= 0 && firstIndex >= 0 && firstIndex < activeIndex) return "done";
  return "idle";
}

function ProcessSection({ activeNode, status, lang }) {
  return (
    <PageSection id="process" tint="rgba(133, 197, 255, 0.28)">
      <NarrativeHeader
        eyebrow={lang === "ko" ? "표준화된 워크플로우" : "Codified Workflow"}
        title={lang === "ko" ? "엔터프라이즈 보안팀을 위한 BPMN 기반 운영 모델." : "A BPMN-backed operating model for enterprise security teams."}
        description={lang === "ko" ? "이 섹션은 메인 BPMN workflow를 웹 제품 구조로 번역한 영역입니다. lane과 decision path가 중심이며, n8n 노드는 이 흐름을 구현하는 엔진 레이어로만 보여줍니다." : "This section translates the BPMN flow into a product surface. Lanes and decision paths stay primary, while n8n appears only as the execution layer."}
        action={
          <a
            href="#simulator"
            style={{
              textDecoration: "none",
              borderRadius: "999px",
              padding: "11px 16px",
              color: "#eef2ff",
              fontSize: "12px",
              fontWeight: 700,
              border: "1px solid rgba(142,167,255,0.25)",
              background: "rgba(142,167,255,0.08)",
            }}
          >
            {lang === "ko" ? "제품 열기" : "Open Product"}
          </a>
        }
      />

      <div style={{ display: "grid", gap: "14px" }}>
        {PROCESS_LANES.map((lane) => (
          <SectionPanel key={lane.lane} title={lane.lane} subtitle={lang === "ko" ? "운영 레인" : "Operating lane"} accent={`${lane.accent}33`}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              {lane.steps.map((step) => {
                const state = getProcessStepState(step.ids, activeNode, status);
                const palette = {
                  idle: { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", text: "rgba(255,255,255,0.82)" },
                  active: { bg: `${lane.accent}12`, border: `${lane.accent}88`, text: "#ffffff" },
                  done: { bg: "rgba(109,187,155,0.08)", border: "rgba(109,187,155,0.35)", text: "#ffffff" },
                  error: { bg: "rgba(255,23,68,0.08)", border: "rgba(255,23,68,0.35)", text: "#ffffff" },
                }[state];

                return (
                  <div
                    key={`${lane.lane}-${step.title}`}
                    style={{
                      borderRadius: "18px",
                      padding: "16px",
                      minHeight: "132px",
                      background: palette.bg,
                      border: `1px solid ${palette.border}`,
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: "0 auto auto 0",
                        height: "4px",
                        width: "100%",
                        background: state === "idle" ? "rgba(255,255,255,0.04)" : palette.border,
                      }}
                    />
                    <div style={{ fontSize: "10px", color: state === "idle" ? lane.accent : "#ffffff", letterSpacing: "0.8px", textTransform: "uppercase", fontWeight: 700 }}>
                      {state === "active" ? (lang === "ko" ? "진행 중" : "Active step") : state === "done" ? (lang === "ko" ? "완료" : "Completed") : state === "error" ? (lang === "ko" ? "확인 필요" : "Needs attention") : (lang === "ko" ? "프로세스 단계" : "Process step")}
                    </div>
                    <div style={{ marginTop: "10px", fontSize: "18px", color: palette.text, fontWeight: 700, fontFamily: DISPLAY_FONT, lineHeight: 1.2, letterSpacing: "0.04em", textTransform: "uppercase", ...WRAP_ANYWHERE }}>
                      {t(step.title, lang)}
                    </div>
                    <div style={{ marginTop: "10px", color: "rgba(255,255,255,0.68)", fontSize: "13px", lineHeight: 1.75, ...WRAP_ANYWHERE }}>{t(step.detail, lang)}</div>
                  </div>
                );
              })}
            </div>
          </SectionPanel>
        ))}

        <SectionPanel title={lang === "ko" ? "워크플로우 엔진 매핑" : "Workflow Engine Mapping"} subtitle={lang === "ko" ? "n8n 노드는 제품 UI 뒤에서 어떤 실행 원리를 담당하는지만 보여줍니다." : "Show which execution responsibility each n8n node owns behind the product UI."} accent="rgba(142,167,255,0.18)">
          <PipelineVisualizer activeNode={activeNode} status={status} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginTop: "14px" }}>
            {ENGINE_MAP.map((item) => (
              <div
                key={item.node}
                style={{
                  borderRadius: "14px",
                  padding: "14px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ color: THEME.text, fontWeight: 700, fontSize: "13px", fontFamily: DISPLAY_FONT, letterSpacing: "0.04em", textTransform: "uppercase", ...WRAP_ANYWHERE }}>{item.node}</div>
                <div style={{ marginTop: "6px", color: "rgba(255,255,255,0.7)", fontSize: "12px", lineHeight: 1.6, ...WRAP_ANYWHERE }}>{t(item.meaning, lang)}</div>
                <div style={{ marginTop: "8px", color: "rgba(133, 197, 255, 0.85)", fontSize: "11px", ...WRAP_ANYWHERE }}>{t(item.stage, lang)}</div>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </PageSection>
  );
}

function PipelineVisualizer({ activeNode, status }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "2px", overflowX: "auto", padding: "12px 0 4px" }}>
      {PIPELINE_NODES.map((node, index) => {
        const nodeIndex = PIPELINE_NODES.findIndex((item) => item.id === activeNode);
        let state = "idle";
        if (status === "done") state = "done";
        else if (status === "error") state = index <= nodeIndex ? "error" : "idle";
        else if (index < nodeIndex) state = "done";
        else if (index === nodeIndex) state = "active";

        const colors = {
          idle: { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.09)", text: "rgba(255,255,255,0.28)" },
          active: { bg: "rgba(142,167,255,0.12)", border: "rgba(142,167,255,0.55)", text: "#dbe4ff" },
          done: { bg: "rgba(109,187,155,0.1)", border: "rgba(109,187,155,0.35)", text: "#bce7d7" },
          error: { bg: "rgba(255,23,68,0.08)", border: "rgba(255,23,68,0.35)", text: "#ff1744" },
        };
        const palette = colors[state];

        return (
          <div key={node.id} style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                position: "relative",
                minWidth: "78px",
                padding: "10px 11px",
                borderRadius: "12px",
                border: `1.5px solid ${palette.border}`,
                background: palette.bg,
                textAlign: "center",
                transition: "all 0.25s ease",
              }}
            >
              {state === "active" ? (
                <div
                  style={{
                    position: "absolute",
                    inset: "-2px",
                    borderRadius: "13px",
                    border: "2px solid rgba(142,167,255,0.28)",
                    animation: "pulse-border 1.5s ease-in-out infinite",
                  }}
                />
              ) : null}
              <div style={{ color: palette.text, fontSize: "9px", fontWeight: 700, letterSpacing: "0.6px", marginBottom: "2px" }}>{node.short}</div>
              <div style={{ fontSize: "8px", color: "rgba(255,255,255,0.34)" }}>{node.label.split(" ").slice(1).join(" ")}</div>
            </div>
            {index < PIPELINE_NODES.length - 1 ? (
              <div
                style={{
                  width: "18px",
                  height: "2px",
                  background:
                    state === "done" || (status === "done" && index < PIPELINE_NODES.length - 1)
                      ? "rgba(109,187,155,0.4)"
                      : "rgba(255,255,255,0.08)",
                  transition: "all 0.25s ease",
                }}
              />
            ) : null}
          </div>
        );
      })}
      <style>{`
        @keyframes pulse-border {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.03); }
        }
      `}</style>
    </div>
  );
}

function ScenarioCard({ scenario, active, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? `${scenario.tag_color}12` : "rgba(255,255,255,0.02)",
        border: `1px solid ${active ? `${scenario.tag_color}50` : "rgba(255,255,255,0.06)"}`,
        borderRadius: "16px",
        padding: "14px",
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "all 0.2s ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            color: scenario.tag_color,
            background: `${scenario.tag_color}18`,
            padding: "4px 8px",
            borderRadius: "999px",
            letterSpacing: "0.5px",
          }}
        >
          {scenario.tag}
        </span>
        <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)" }}>weight {scenario.weight}</span>
      </div>
      <div style={{ fontSize: "14px", color: THEME.text, fontWeight: 700, fontFamily: DISPLAY_FONT, letterSpacing: "0.04em", textTransform: "uppercase", ...WRAP_ANYWHERE }}>{scenario.label}</div>
      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.34)", marginTop: "5px", ...WRAP_ANYWHERE }}>{scenario.input?.incident_type}</div>
      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.56)", marginTop: "10px", lineHeight: 1.7, ...WRAP_ANYWHERE }}>{scenario.description}</div>
    </button>
  );
}

function SelectedScenarioCard({ scenario, seed, mode, lastRunMeta, lang }) {
  if (!scenario) return null;

  const currentRisk = scenario.expected_output?.risk_level || scenario.risk_level || "P2";
  const riskMeta = RISK_META[currentRisk] || RISK_META.P2;

  return (
    <SectionPanel title={lang === "ko" ? "케이스 브리핑" : "Case Briefing"} subtitle={lang === "ko" ? "선택된 incident의 기대 경로와 주요 신호를 빠르게 확인할 수 있습니다." : "Quickly review the expected route and key signals for the selected incident."} accent={`${riskMeta.border}44`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "14px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px", flexWrap: "wrap" }}>
            <span
              style={{
                borderRadius: "999px",
                border: `1px solid ${riskMeta.border}`,
                background: riskMeta.bg,
                color: riskMeta.text,
                padding: "6px 12px",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              {currentRisk}
            </span>
            <span style={{ color: THEME.text, fontSize: "20px", fontWeight: 700, fontFamily: DISPLAY_FONT, letterSpacing: "0.04em", textTransform: "uppercase", ...WRAP_ANYWHERE }}>{scenario.label}</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.64)", fontSize: "12px", lineHeight: 1.8, ...WRAP_ANYWHERE }}>{scenario.description}</div>
        </div>
        <div
          style={{
            flex: "1 1 220px",
            minWidth: 0,
            maxWidth: "320px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "14px",
            padding: "12px",
          }}
        >
          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px" }}>{lang === "ko" ? "실행 스냅샷" : "Run Snapshot"}</div>
          <div style={{ marginTop: "8px", fontSize: "12px", color: "rgba(255,255,255,0.82)", lineHeight: 1.7, ...WRAP_ANYWHERE }}>
            <div>{lang === "ko" ? "모드" : "Mode"}: {t(MODE_COPY[mode].label, lang)}</div>
            <div>{lang === "ko" ? "시드" : "Seed"}: {seed || (lang === "ko" ? "자동 생성" : "Auto generated")}</div>
            <div>{lang === "ko" ? "최근 소스" : "Last source"}: {lastRunMeta?.source || (lang === "ko" ? "아직 실행 안 됨" : "Not run yet")}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginTop: "16px" }}>
        <MetricCard label={lang === "ko" ? "예상 경로" : "Expected Route"} value={scenario.expected_route} accent={`${riskMeta.border}55`} />
        <MetricCard label={lang === "ko" ? "예상 점수" : "Expected Score"} value={`${scenario.expected_output?.risk_score || "?"}/100`} accent="rgba(255,255,255,0.08)" />
        <MetricCard label={lang === "ko" ? "신뢰도" : "Confidence"} value={`${Math.round((scenario.expected_output?.confidence || 0) * 100)}%`} accent="rgba(255,255,255,0.08)" />
      </div>

      <div style={{ marginTop: "16px" }}>
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>{lang === "ko" ? "신호 지표" : "Signal Indicators"}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {(scenario.input?.indicators || []).map((indicator) => (
            <span
              key={indicator}
              style={{
                fontSize: "11px",
                color: "rgba(255,255,255,0.74)",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "999px",
                padding: "6px 10px",
              }}
            >
              {indicator}
            </span>
          ))}
        </div>
      </div>
    </SectionPanel>
  );
}

function ResultCard({ result, lang }) {
  if (!result) return null;

  const payload = result.final_payload || result;
  const aiResult = result.ai_result || {};
  const precheck = result.precheck_result || {};
  const delivery = result.delivery || {};
  const riskMeta = RISK_META[payload.risk_level] || RISK_META.P2;
  const sourceLabel = result.source === "demo_fallback" ? (lang === "ko" ? "폴백 케이스 출력" : "Fallback Case Output") : result.source === "live" ? (lang === "ko" ? "연결된 워크플로우 출력" : "Connected Workflow Output") : (lang === "ko" ? "시나리오 모드 출력" : "Scenario Mode Output");
  const deliveryTone =
    delivery.status === "sent"
      ? { bg: "rgba(109,187,155,0.12)", border: "rgba(109,187,155,0.36)", text: "#bce7d7" }
      : delivery.status === "not_sent"
        ? { bg: "rgba(255,23,68,0.08)", border: "rgba(255,23,68,0.28)", text: "#ff8fa3" }
        : { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.08)", text: "rgba(255,255,255,0.72)" };

  return (
    <div
      style={{
        marginTop: "18px",
        background: "linear-gradient(180deg, rgba(10,17,30,0.92), rgba(5,9,16,0.9))",
        border: `1px solid ${riskMeta.border}45`,
        borderRadius: "20px",
        padding: "22px",
        boxShadow: `0 26px 60px ${riskMeta.glow}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap", marginBottom: "18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div
            style={{
              borderRadius: "14px",
              border: `2px solid ${riskMeta.border}`,
              background: riskMeta.bg,
              color: riskMeta.text,
              padding: "10px 18px",
              fontSize: "22px",
              fontWeight: 800,
              fontFamily: DISPLAY_FONT,
            }}
          >
            {payload.risk_level}
          </div>
          <div>
            <div style={{ fontSize: "18px", color: THEME.text, fontWeight: 700, fontFamily: DISPLAY_FONT, letterSpacing: "0.04em", textTransform: "uppercase" }}>{lang === "ko" ? "케이스 판단 결과" : "Case Decision Output"}</div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.48)", marginTop: "4px", ...WRAP_ANYWHERE }}>
              {result.scenario_label} · {sourceLabel}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <span
            style={{
              borderRadius: "999px",
              padding: "6px 10px",
              fontSize: "10px",
              fontWeight: 700,
              color: "rgba(255,255,255,0.78)",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              maxWidth: "100%",
              ...WRAP_ANYWHERE,
            }}
          >
            {(lang === "ko" ? "시드" : "Seed")} {result.seed || "n/a"}
          </span>
          <span
            style={{
              borderRadius: "999px",
              padding: "6px 10px",
              fontSize: "10px",
              fontWeight: 700,
              color: riskMeta.text,
              background: riskMeta.bg,
              border: `1px solid ${riskMeta.border}55`,
              maxWidth: "100%",
              ...WRAP_ANYWHERE,
            }}
          >
            {result.expected_route || (lang === "ko" ? "경로 대기 중" : "Route pending")}
          </span>
          {delivery.requested ? (
            <span
              style={{
                borderRadius: "999px",
                padding: "6px 10px",
                fontSize: "10px",
                fontWeight: 700,
                color: deliveryTone.text,
                background: deliveryTone.bg,
                border: `1px solid ${deliveryTone.border}`,
                maxWidth: "100%",
                ...WRAP_ANYWHERE,
              }}
            >
              {delivery.status === "sent" ? (lang === "ko" ? "이메일 발송 완료" : "Email delivered") : delivery.status === "not_sent" ? (lang === "ko" ? "이메일 발송 실패" : "Email not sent") : (lang === "ko" ? "이메일 미리보기" : "Email preview")}
            </span>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "10px", marginBottom: "18px" }}>
        <MetricCard label={lang === "ko" ? "알림 ID" : "Alert ID"} value={payload.alert_id || "—"} accent="rgba(255,255,255,0.08)" />
        <MetricCard label={lang === "ko" ? "사건 유형" : "Incident Type"} value={payload.incident_type || "—"} accent="rgba(255,255,255,0.08)" />
        <MetricCard label={lang === "ko" ? "위험 점수" : "Risk Score"} value={payload.risk_score ? `${payload.risk_score}/100` : "N/A"} accent={`${riskMeta.border}45`} />
        <MetricCard label={lang === "ko" ? "신뢰도" : "Confidence"} value={payload.confidence ? `${Math.round(payload.confidence * 100)}%` : "N/A"} accent="rgba(255,255,255,0.08)" />
        <MetricCard label={lang === "ko" ? "사전 점검" : "PreCheck"} value={precheck.decision || "—"} accent="rgba(255,255,255,0.08)" />
        <MetricCard label={lang === "ko" ? "누락 데이터" : "Missing Data"} value={String(payload.missing_data_count ?? 0)} accent="rgba(255,255,255,0.08)" />
        {delivery.requested ? <MetricCard label={lang === "ko" ? "수신자" : "Recipient"} value={delivery.recipient || "—"} accent="rgba(109,187,155,0.22)" /> : null}
      </div>

      {delivery.requested ? (
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "14px",
            padding: "16px",
            marginBottom: "14px",
          }}
        >
          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>{lang === "ko" ? "이메일 전송 상태" : "Inbox Delivery Status"}</div>
          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.82)", lineHeight: 1.8, ...WRAP_ANYWHERE }}>{delivery.message}</div>
        </div>
      ) : null}

      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "14px",
          padding: "16px",
          marginBottom: "14px",
        }}
      >
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>{lang === "ko" ? "요약" : "Executive Summary"}</div>
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.84)", lineHeight: 1.8, ...WRAP_ANYWHERE }}>{payload.summary}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "14px",
            padding: "16px",
          }}
        >
          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>{lang === "ko" ? "의미" : "Why It Matters"}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(aiResult.rationale || []).map((item) => (
              <div key={item} style={{ fontSize: "12px", color: "rgba(255,255,255,0.76)", lineHeight: 1.7, ...WRAP_ANYWHERE }}>
                {item}
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "14px",
            padding: "16px",
          }}
        >
          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>{lang === "ko" ? "권장 조치" : "Recommended Actions"}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(aiResult.recommended_actions || []).map((item) => (
              <div key={item} style={{ fontSize: "12px", color: "rgba(255,255,255,0.76)", lineHeight: 1.7, ...WRAP_ANYWHERE }}>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryPanel({ history, onReplay, lang }) {
  if (!history.length) return null;

  return (
    <SectionPanel title={lang === "ko" ? "케이스 활동 기록" : "Case Activity"} subtitle={lang === "ko" ? "최근 실행 이력을 통해 repeatability와 operator visibility를 함께 보여줍니다." : "Show repeatability and operator visibility through recent run history."}>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {history.map((item) => {
          const payload = item.result?.final_payload || {};
          const riskMeta = RISK_META[payload.risk_level] || RISK_META.P2;

          return (
            <div
              key={`${item.seed}-${item.time}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: "10px",
                alignItems: "center",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "14px",
                padding: "12px 14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", minWidth: 0 }}>
                <span
                  style={{
                    minWidth: "34px",
                    textAlign: "center",
                    borderRadius: "999px",
                    padding: "4px 8px",
                    fontSize: "10px",
                    fontWeight: 700,
                    color: riskMeta.text,
                    background: riskMeta.bg,
                    border: `1px solid ${riskMeta.border}55`,
                  }}
                >
                  {payload.risk_level || item.status}
                </span>
                <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.74)", ...WRAP_ANYWHERE }}>{item.scenarioLabel}</span>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", ...WRAP_ANYWHERE }}>{lang === "ko" ? "시드" : "seed"} {item.seed}</span>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.24)" }}>
                  {item.duration ? `${(item.duration / 1000).toFixed(1)}s` : "—"} · {item.source}
                </span>
                {item.result?.delivery?.recipient ? (
                  <span style={{ fontSize: "11px", color: "rgba(133, 197, 255, 0.82)", ...WRAP_ANYWHERE }}>{lang === "ko" ? "이메일" : "email"} {item.result.delivery.recipient}</span>
                ) : null}
              </div>
              <button
                onClick={() => onReplay(item)}
                style={{
                  borderRadius: "999px",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.74)",
                  padding: "8px 12px",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                {lang === "ko" ? "다시 실행" : "Replay"}
              </button>
            </div>
          );
        })}
      </div>
    </SectionPanel>
  );
}

function MissionControlPanel({
  lang,
  mode,
  setMode,
  handleRandomRun,
  handleReplay,
  seedInput,
  setSeedInput,
  autoDemo,
  setAutoDemo,
  isBusy,
  lastRunMeta,
}) {
  return (
    <SectionPanel title={lang === "ko" ? "워크스페이스 제어" : "Workspace Controls"} subtitle={lang === "ko" ? "mode 전환, replay, seed control, continuous run을 하나의 운영 패널에서 관리합니다." : "Manage mode switching, replay, seed control, and continuous runs from one panel."}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
        {["demo", "live"].map((option) => {
          const active = mode === option;
          return (
            <button
              key={option}
              onClick={() => setMode(option)}
              style={{
                borderRadius: "12px",
                padding: "12px",
                cursor: "pointer",
                border: `1px solid ${active ? "rgba(142,167,255,0.4)" : "rgba(255,255,255,0.08)"}`,
                background: active ? "rgba(142,167,255,0.12)" : "rgba(255,255,255,0.03)",
                color: active ? "#dbe4ff" : "rgba(255,255,255,0.64)",
                textAlign: "left",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "12px", fontFamily: DISPLAY_FONT, letterSpacing: "0.04em", textTransform: "uppercase" }}>{t(MODE_COPY[option].label, lang)}</div>
              <div style={{ marginTop: "4px", fontSize: "10px", lineHeight: 1.6, ...WRAP_ANYWHERE }}>{t(MODE_COPY[option].subtitle, lang)}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
        <button
          onClick={handleRandomRun}
          disabled={isBusy}
          style={{
            borderRadius: "999px",
            border: "1px solid rgba(142,167,255,0.35)",
            background: "linear-gradient(135deg, rgba(142,167,255,0.18), rgba(212,176,111,0.1))",
            color: "#eef2ff",
            padding: "10px 14px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: isBusy ? "not-allowed" : "pointer",
          }}
        >
          {lang === "ko" ? "케이스 믹스 실행" : "Run Case Mix"}
        </button>
        <button
          onClick={() => handleReplay()}
          disabled={isBusy || !lastRunMeta}
          style={{
            borderRadius: "999px",
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.74)",
            padding: "10px 14px",
            fontSize: "12px",
            cursor: isBusy || !lastRunMeta ? "not-allowed" : "pointer",
          }}
        >
          {lang === "ko" ? "최근 실행 재생" : "Replay Last Run"}
        </button>
        <button
          onClick={() => setSeedInput(createSeed("manual"))}
          disabled={isBusy}
          style={{
            borderRadius: "999px",
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.74)",
            padding: "10px 14px",
            fontSize: "12px",
            cursor: isBusy ? "not-allowed" : "pointer",
          }}
        >
          {lang === "ko" ? "케이스 시드 생성" : "Generate Case Seed"}
        </button>
        <button
          onClick={() => setAutoDemo((current) => !current)}
          disabled={mode !== "demo"}
          style={{
            borderRadius: "999px",
            border: `1px solid ${autoDemo ? "rgba(109,187,155,0.32)" : "rgba(255,255,255,0.12)"}`,
            background: autoDemo ? "rgba(109,187,155,0.12)" : "rgba(255,255,255,0.04)",
            color: autoDemo ? "#bce7d7" : "rgba(255,255,255,0.74)",
            padding: "10px 14px",
            fontSize: "12px",
            cursor: mode !== "demo" ? "not-allowed" : "pointer",
          }}
        >
          {autoDemo ? (lang === "ko" ? "연속 실행 켜짐" : "Continuous Run On") : (lang === "ko" ? "연속 실행 꺼짐" : "Continuous Run Off")}
        </button>
      </div>

      <div style={{ marginTop: "14px" }}>
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>{lang === "ko" ? "케이스 시드 제어" : "Case Seed Control"}</div>
        <input
          type="text"
          value={seedInput}
          onChange={(event) => setSeedInput(event.target.value)}
          placeholder="enterprise-case-q1"
          style={{
            width: "100%",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.09)",
            background: "rgba(0,0,0,0.24)",
            color: "#fff",
            padding: "12px 14px",
            fontSize: "12px",
            outline: "none",
            fontFamily: BODY_FONT,
          }}
        />
        <div style={{ marginTop: "8px", fontSize: "11px", color: "rgba(255,255,255,0.38)", lineHeight: 1.6, ...WRAP_ANYWHERE }}>
          {lang === "ko" ? "같은 seed를 다시 넣고 실행하면 QA, 내부 검토, 고객 검증 과정에서도 동일한 case를 그대로 재현할 수 있습니다." : "Reuse the same seed to reproduce the exact same case during QA, internal review, or customer validation."}
        </div>
      </div>
    </SectionPanel>
  );
}

function InboxDeliveryPanel({
  lang,
  mode,
  webhookUrl,
  recipientEmail,
  setRecipientEmail,
  selectedScenario,
  handleSendEmail,
  isBusy,
  result,
}) {
  const trimmedEmail = normalizeRecipientEmail(recipientEmail);
  const emailReady = isValidEmail(trimmedEmail);
  const webhookReady = Boolean(webhookUrl.trim());
  const delivery = result?.delivery || null;

  let helperText = lang === "ko" ? "수신자 이메일을 입력하면, 현재 선택한 incident를 해당 사용자의 실제 메일함으로 보낼 수 있습니다." : "Enter any recipient email address to send the selected incident as a live alert message.";
  if (!selectedScenario) {
    helperText = lang === "ko" ? "먼저 incident template을 하나 선택해 주세요." : "Select an incident template first.";
  } else if (!emailReady) {
    helperText = lang === "ko" ? "선택한 사용자에게 메일을 보내려면 유효한 이메일 주소를 입력해 주세요." : "Enter a valid recipient email address to send a live message.";
  } else if (!webhookReady) {
    helperText = lang === "ko" ? "실제 발송은 n8n Webhook URL이 설정되어 있어야 합니다." : "A live send requires an n8n webhook URL.";
  } else if (mode !== "live") {
    helperText = lang === "ko" ? "발송을 누르면 Connected Workflow로 전환해 입력한 수신자 메일로 실제 전달을 시도합니다." : "Sending will switch into Connected Workflow and attempt a live delivery to the specified recipient.";
  }

  return (
    <SectionPanel title={lang === "ko" ? "수신자 이메일 전달" : "Recipient Email Delivery"} subtitle={lang === "ko" ? "선택한 incident를 내 메일뿐 아니라 다른 사용자의 실제 이메일 inbox로도 보낼 수 있는 패널입니다." : "Send the selected incident to any recipient's real inbox, not just your own."} accent="rgba(109,187,155,0.18)">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginBottom: "14px" }}>
        <MetricCard label={lang === "ko" ? "선택 케이스" : "Selected Case"} value={selectedScenario?.label || (lang === "ko" ? "템플릿 선택" : "Select a template")} accent="rgba(255,255,255,0.08)" />
        <MetricCard label={lang === "ko" ? "전달 경로" : "Delivery Path"} value={webhookReady ? "n8n Email Workflow" : (lang === "ko" ? "Webhook 필요" : "Webhook required")} accent="rgba(142,167,255,0.25)" />
        <MetricCard label={lang === "ko" ? "최근 수신자" : "Last Recipient"} value={delivery?.recipient || (lang === "ko" ? "아직 발송 없음" : "No email sent yet")} accent="rgba(255,255,255,0.08)" />
      </div>

      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>{lang === "ko" ? "수신자 이메일" : "Recipient Email"}</div>
      <input
        type="email"
        value={recipientEmail}
        onChange={(event) => setRecipientEmail(event.target.value)}
        placeholder="name@company.com"
        style={{
          width: "100%",
          borderRadius: "12px",
          border: `1px solid ${recipientEmail && !emailReady ? "rgba(255,23,68,0.28)" : "rgba(255,255,255,0.09)"}`,
          background: "rgba(0,0,0,0.24)",
          color: "#fff",
          padding: "12px 14px",
          fontSize: "12px",
          outline: "none",
          fontFamily: BODY_FONT,
        }}
      />

      <div style={{ marginTop: "10px", fontSize: "11px", color: "rgba(255,255,255,0.46)", lineHeight: 1.7, ...WRAP_ANYWHERE }}>{helperText}</div>

      <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
        <button
          onClick={handleSendEmail}
          disabled={isBusy || !selectedScenario || !emailReady || !webhookReady}
          style={{
            borderRadius: "999px",
            border: "1px solid rgba(109,187,155,0.34)",
            background: "linear-gradient(135deg, rgba(109,187,155,0.18), rgba(142,167,255,0.1))",
            color: "#eefaf4",
            padding: "10px 14px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: isBusy || !selectedScenario || !emailReady || !webhookReady ? "not-allowed" : "pointer",
            opacity: isBusy || !selectedScenario || !emailReady || !webhookReady ? 0.56 : 1,
          }}
        >
          {lang === "ko" ? "지정한 메일로 보내기" : "Send to Recipient Inbox"}
        </button>
      </div>

      <div style={{ marginTop: "14px", display: "grid", gap: "8px" }}>
        {[
          ...(lang === "ko"
            ? [
                "Webhook payload에 입력한 수신자 주소가 `notification_email`과 `recipient_email`로 함께 전달됩니다.",
                "다른 사용자의 이메일을 입력해도 n8n 메일 노드가 해당 주소를 그대로 수신자로 사용합니다.",
                "n8n이 정상 응답하면 결과 카드에 delivery status와 최종 recipient가 함께 표시됩니다.",
                "실제 발송은 Connected Workflow와 Gmail/메일 노드 설정이 연결되어 있어야 합니다.",
              ]
            : [
                "The webhook payload sends the entered address as both `notification_email` and `recipient_email`.",
                "If you enter another user's address, the n8n mail node uses that address as the live recipient.",
                "If n8n responds successfully, the result card shows both the delivery status and the final recipient.",
                "Live sending requires the Connected Workflow and Gmail/mail node to be configured.",
              ])
        ].map((item) => (
          <div
            key={item}
            style={{
              padding: "10px 12px",
              borderRadius: "12px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.76)",
              fontSize: "12px",
              lineHeight: 1.7,
              ...WRAP_ANYWHERE,
            }}
          >
            {item}
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}

function DeploymentBridgePanel({ mode, webhookUrl, setWebhookUrl, scenariosLoading, scenariosCount, lastRunMeta, lang }) {
  return (
    <SectionPanel title={lang === "ko" ? "연동 브리지" : "Integration Bridge"} subtitle={lang === "ko" ? "Scenario Mode로 기본 동작을 검증하고, Connected Workflow로 n8n과 연동합니다." : "Validate the default flow in Scenario Mode and connect n8n in Connected Workflow."}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginBottom: "14px" }}>
        <MetricCard label={lang === "ko" ? "시나리오 풀" : "Scenario Pool"} value={scenariosLoading ? (lang === "ko" ? "로딩 중..." : "Loading...") : `${scenariosCount} ${lang === "ko" ? "개 시나리오" : "scenarios"}`} accent="rgba(255,255,255,0.08)" />
        <MetricCard label={lang === "ko" ? "현재 모드" : "Current Mode"} value={t(MODE_COPY[mode].label, lang)} accent="rgba(142,167,255,0.25)" />
        <MetricCard label={lang === "ko" ? "최근 시드" : "Last Seed"} value={lastRunMeta?.seed || (lang === "ko" ? "아직 실행 안 됨" : "Not run yet")} accent="rgba(255,255,255,0.08)" />
      </div>

      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>{lang === "ko" ? "워크플로우 엔드포인트" : "Workflow Endpoint"}</div>
      <input
        type="text"
        value={webhookUrl}
        onChange={(event) => setWebhookUrl(event.target.value)}
        placeholder="https://your-n8n.app.n8n.cloud/webhook/enterprise-triage"
        style={{
          width: "100%",
          borderRadius: "12px",
          border: "1px solid rgba(255,255,255,0.09)",
          background: "rgba(0,0,0,0.24)",
          color: "#fff",
          padding: "12px 14px",
          fontSize: "12px",
          outline: "none",
          fontFamily: BODY_FONT,
        }}
      />
      <div style={{ marginTop: "8px", fontSize: "11px", color: "rgba(255,255,255,0.42)", lineHeight: 1.7, ...WRAP_ANYWHERE }}>
        {lang === "ko" ? "Scenario Mode에서는 URL 없이도 제품의 기본 동작을 검증할 수 있습니다. Connected Workflow에서는 Webhook을 호출하고, 실패하면 같은 시나리오의 deterministic fallback을 보여줍니다." : "Scenario Mode validates the base product flow without a URL. Connected Workflow calls the webhook and falls back to a deterministic version of the same case if the live request fails."}
      </div>
      <div style={{ marginTop: "10px", fontSize: "11px", color: "rgba(133, 197, 255, 0.82)", lineHeight: 1.7, ...WRAP_ANYWHERE }}>
        {lang === "ko" ? "메일 체험을 연결하려면 n8n 메일 노드의 recipient를 `notification_email` 필드에 매핑해 주세요." : "To enable live email delivery, map the recipient field in your n8n mail node to `notification_email`."}
      </div>
    </SectionPanel>
  );
}

function AuditSection({ result, history, lastRunMeta, lang }) {
  const payload = result?.final_payload;

  return (
    <PageSection id="audit" tint="rgba(109,187,155,0.28)">
      <NarrativeHeader
        eyebrow={lang === "ko" ? "거버넌스 레이어" : "Governance Layer"}
        title={lang === "ko" ? "신뢰, 증적, 통제는 인터페이스에서 바로 보여야 합니다." : "The interface should make trust, evidence, and control visible."}
        description={lang === "ko" ? "실제 운영 도입을 검토하는 팀은 결과 카드만 보지 않습니다. why, who approved, what route was taken, what was missing, what was logged 같은 운영 흔적이 화면에 드러나야 제품 신뢰가 생깁니다." : "Teams evaluating real deployment do not look only at the result card. They need visible evidence of why a case was routed, who approved it, what was missing, and what was logged."}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
        {AUDIT_PILLARS.map((pillar) => (
          <SectionPanel key={pillar.title} title={pillar.title} accent="rgba(133, 197, 255, 0.16)">
            <div style={{ color: "rgba(255,255,255,0.74)", fontSize: "13px", lineHeight: 1.8 }}>{t(pillar.text, lang)}</div>
          </SectionPanel>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "14px", marginTop: "14px" }}>
        <SectionPanel title={lang === "ko" ? "현재 감사 스냅샷" : "Current Audit Snapshot"} subtitle={lang === "ko" ? "현재 실행 결과를 audit-friendly 형태로 재확인합니다." : "Review the current run in an audit-friendly format."} accent="rgba(109,187,155,0.16)">
          {result ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginBottom: "14px" }}>
                <MetricCard label={lang === "ko" ? "경로" : "Route"} value={result.expected_route || "—"} accent="rgba(255,255,255,0.08)" />
                <MetricCard label={lang === "ko" ? "위험 수준" : "Risk Level"} value={payload?.risk_level || "—"} accent="rgba(255,255,255,0.08)" />
                <MetricCard label={lang === "ko" ? "위험 점수" : "Risk Score"} value={payload?.risk_score ? `${payload.risk_score}/100` : "—"} accent="rgba(255,255,255,0.08)" />
                <MetricCard label={lang === "ko" ? "최근 소스" : "Last Source"} value={result.source || "—"} accent="rgba(255,255,255,0.08)" />
              </div>

              <div
                style={{
                  borderRadius: "16px",
                  padding: "16px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>{lang === "ko" ? "구조화 페이로드 미리보기" : "Structured Payload Preview"}</div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: "11px",
                    lineHeight: 1.7,
                    color: "#a7c7ff",
                    fontFamily: MONO_FONT,
                  }}
                >
                  {JSON.stringify(result.final_payload, null, 2)}
                </pre>
              </div>
            </>
          ) : (
            <div style={{ color: "rgba(255,255,255,0.66)", fontSize: "13px", lineHeight: 1.8 }}>
              {lang === "ko" ? "아직 실행 결과가 없습니다. 제품 워크스페이스를 한 번 실행하면 이 영역이 structured JSON preview와 route snapshot으로 채워집니다." : "There is no execution result yet. Run the product workspace once and this area will fill with a structured JSON preview and route snapshot."}
            </div>
          )}
        </SectionPanel>

        <SectionPanel title={lang === "ko" ? "로그 표면" : "Logging Surfaces"} subtitle={lang === "ko" ? "Google Sheets와 history를 통해 운영 이후에도 추적 가능한 로그를 유지합니다." : "Keep traceable logs beyond the live run through Google Sheets and history."} accent="rgba(255,145,0,0.16)">
          <div style={{ display: "grid", gap: "10px" }}>
            <MetricCard label={lang === "ko" ? "케이스 활동 수" : "Case Activity Entries"} value={String(history.length)} accent="rgba(255,255,255,0.08)" />
            <MetricCard label={lang === "ko" ? "최근 시드" : "Last Seed"} value={lastRunMeta?.seed || (lang === "ko" ? "아직 실행 안 됨" : "Not run yet")} accent="rgba(255,255,255,0.08)" />
            <MetricCard label={lang === "ko" ? "공유 시나리오 소스" : "Shared Scenario Source"} value="/public/demo-scenarios.json" accent="rgba(255,255,255,0.08)" />
          </div>

          <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {(lang === "ko" ? ["모든 사건이 기록됨", "P1/P2는 에스컬레이션 경로가 남음", "P3는 모니터링 큐에서 유지됨", "재시도와 폴백이 설명 가능하게 남음"] : ["All incidents logged", "P1/P2 send escalation trail", "P3 stays visible in monitoring queue", "Retry / fallback remains explainable"]).map((item) => (
              <div
                key={item}
                style={{
                  padding: "10px 12px",
                  borderRadius: "12px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.76)",
                  fontSize: "12px",
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </PageSection>
  );
}

function CustomersSection({ lang }) {
  return (
    <PageSection id="customers" tint="rgba(154,182,234,0.28)">
      <NarrativeHeader
        eyebrow={lang === "ko" ? "주요 고객" : "Expected Customers"}
        title={lang === "ko" ? "트리아지 품질, 속도, 책임이 함께 중요한 조직을 위해 설계했습니다." : "Built for organizations where triage quality, speed, and accountability matter together."}
        description={lang === "ko" ? "ThreatWatch AI는 alert volume이 높고, escalation approval이 중요하며, 감사 가능한 evidence가 필요한 보안 운영 조직을 주요 고객으로 상정합니다." : "ThreatWatch AI is designed for security operations teams with high alert volume, formal approval boundaries, and audit-ready evidence requirements."}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
        {CUSTOMER_SEGMENTS.map((segment) => (
          <SectionPanel key={segment.title} title={segment.title} accent="rgba(133, 197, 255, 0.16)">
            <div style={{ color: "rgba(255,255,255,0.74)", fontSize: "13px", lineHeight: 1.8, ...WRAP_ANYWHERE }}>{t(segment.text, lang)}</div>
          </SectionPanel>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "14px", marginTop: "14px" }}>
        <SectionPanel title={lang === "ko" ? "도입 신호" : "Adoption Signals"} subtitle={lang === "ko" ? "이런 운영 조건을 가진 팀일수록 제품 적합도가 높습니다." : "Teams with these operating conditions are a strong fit."} accent="rgba(109,187,155,0.16)">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {CUSTOMER_SIGNALS.map((item, index) => (
              <div key={t(item, lang)} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gap: "12px", alignItems: "start" }}>
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "999px",
                    background: "rgba(142,167,255,0.12)",
                    border: "1px solid rgba(142,167,255,0.32)",
                    color: "#bdf9ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                  }}
                >
                  {index + 1}
                </div>
                <div style={{ color: "rgba(255,255,255,0.78)", fontSize: "13px", lineHeight: 1.8, ...WRAP_ANYWHERE }}>{t(item, lang)}</div>
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel title={lang === "ko" ? "내부 이해관계자" : "Internal Stakeholders"} subtitle={lang === "ko" ? "고객사 내부에서는 이런 팀들이 함께 이 제품을 검토하게 됩니다." : "These internal teams typically evaluate the product together."} accent="rgba(212,176,111,0.16)">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {ENTERPRISE_AUDIENCES.map((item) => (
              <div
                key={item.title}
                style={{
                  padding: "10px 12px",
                  borderRadius: "12px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ color: THEME.text, fontSize: "13px", fontWeight: 700, fontFamily: DISPLAY_FONT, letterSpacing: "0.04em", textTransform: "uppercase", ...WRAP_ANYWHERE }}>{item.title}</div>
                <div style={{ marginTop: "4px", color: "rgba(255,255,255,0.68)", fontSize: "12px", lineHeight: 1.7, ...WRAP_ANYWHERE }}>{t(item.text, lang)}</div>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </PageSection>
  );
}

export default function ThreatWatchDashboard() {
  const [scenarios, setScenarios] = useState([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [scenarioLoadError, setScenarioLoadError] = useState(null);
  const [lang, setLang] = useState(() => readStoredValue(STORAGE_KEYS.language, "ko"));
  const [mode, setMode] = useState(() => readStoredValue(STORAGE_KEYS.mode, "demo"));
  const [webhookUrl, setWebhookUrl] = useState(() => readStoredValue(STORAGE_KEYS.webhookUrl, ""));
  const [seedInput, setSeedInput] = useState(() => readStoredValue(STORAGE_KEYS.seed, ""));
  const [recipientEmail, setRecipientEmail] = useState(() => readStoredValue(STORAGE_KEYS.recipientEmail, ""));
  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [activeNode, setActiveNode] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [history, setHistory] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [autoDemo, setAutoDemo] = useState(false);
  const [lastRunMeta, setLastRunMeta] = useState(null);

  const timerRef = useRef(null);
  const runScenarioRef = useRef(null);

  const selectedScenario = resolveScenarioById(scenarios, selectedScenarioId) || null;

  useEffect(() => {
    let cancelled = false;

    async function loadScenarios() {
      try {
        const response = await fetch("/demo-scenarios.json");
        if (!response.ok) {
          throw new Error(lang === "ko" ? `시나리오 파일 로드 실패: HTTP ${response.status}` : `Failed to load scenarios: HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (!cancelled) {
          const nextScenarios = payload.scenarios || [];
          setScenarios(nextScenarios);
          setSelectedScenarioId((current) => current || nextScenarios[0]?.id || null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setScenarioLoadError(loadError.message);
        }
      } finally {
        if (!cancelled) {
          setScenariosLoading(false);
        }
      }
    }

    loadScenarios();

    return () => {
      cancelled = true;
    };
  }, [lang]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.language, lang);
  }, [lang]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.mode, mode);
  }, [mode]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.webhookUrl, webhookUrl);
  }, [webhookUrl]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.seed, seedInput);
  }, [seedInput]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.recipientEmail, recipientEmail);
  }, [recipientEmail]);

  useEffect(() => {
    return () => window.clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (mode !== "demo" && autoDemo) {
      setAutoDemo(false);
    }
  }, [mode, autoDemo]);

  function startClock() {
    window.clearInterval(timerRef.current);
    const startedAt = Date.now();
    setElapsed(0);
    timerRef.current = window.setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 100);
    return startedAt;
  }

  function stopClock(startedAt) {
    window.clearInterval(timerRef.current);
    const duration = Date.now() - startedAt;
    setElapsed(duration);
    return duration;
  }

  function resolveRunSeed(prefix) {
    const trimmed = seedInput.trim();
    const nextSeed = trimmed || createSeed(prefix);
    setSeedInput(nextSeed);
    return nextSeed;
  }

  async function runScenario(scenario, seed, runtime = {}) {
    if (!scenario) {
      setError(lang === "ko" ? "실행할 시나리오를 먼저 선택해주세요." : "Select a scenario before running the workflow.");
      return;
    }

    const normalizedRecipient = normalizeRecipientEmail(runtime.recipientEmail);
    const deliveryRequested = Boolean(normalizedRecipient);
    const useLiveWorkflow = runtime.forceLive || mode === "live";

    setStatus("running");
    setError(null);
    setWarning(null);
    setResult(null);
    setSelectedScenarioId(scenario.id);
    setActiveNode(null);

    const startedAt = startClock();
    const alertData = buildAlertData(scenario, seed, {
      recipient_email: normalizedRecipient,
      notification_email: normalizedRecipient,
      delivery_requested: deliveryRequested,
      delivery_channel: deliveryRequested ? "email" : "workspace",
      email_experience_requested: deliveryRequested,
    });

    try {
      await runPipelineSequence(setActiveNode, ["trigger", "build", "precheck"], 420);
      setActiveNode("llm");

      let nextResult;
      if (useLiveWorkflow) {
        if (!webhookUrl.trim()) {
          throw new Error(
            deliveryRequested
              ? (lang === "ko" ? "입력한 수신자에게 실제 이메일을 보내려면 n8n Webhook URL을 입력해야 합니다." : "Enter an n8n webhook URL to send a live email to the specified recipient.")
              : (lang === "ko" ? "Connected Workflow에서는 n8n Webhook URL을 입력해야 합니다." : "Connected Workflow requires an n8n webhook URL."),
          );
        }

        try {
          const response = await fetch(webhookUrl.trim(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(alertData),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();
          await runPipelineSequence(setActiveNode, ["parse", "confidence", "normalize", "decision", "action"], 300);
          nextResult = normalizeLiveResult(data, scenario, alertData, {
            mode: "live",
            seed,
            source: "live",
            recipientEmail: normalizedRecipient,
          });
        } catch (liveError) {
          setWarning(
            deliveryRequested
              ? `${lang === "ko" ? "Connected workflow 호출이 실패해서 입력한 수신자에게 이메일이 발송되지 않았고, 동일한 case의 fallback 결과를 표시합니다." : "The connected workflow failed, so the email was not sent to the specified recipient and a fallback result for the same case is shown."} (${liveError.message})`
              : `${lang === "ko" ? "Connected workflow 호출이 실패해서 동일한 case의 fallback 결과를 표시합니다." : "The connected workflow failed, so a fallback result for the same case is shown."} (${liveError.message})`,
          );
          await runPipelineSequence(setActiveNode, ["parse", "confidence", "normalize", "decision", "action"], 220);
          nextResult = buildDemoResult(scenario, alertData, {
            mode: "live",
            seed,
            source: "demo_fallback",
            recipientEmail: normalizedRecipient,
          });
        }
      } else {
        await runPipelineSequence(setActiveNode, ["parse", "confidence", "normalize", "decision", "action"], 280);
        nextResult = buildDemoResult(scenario, alertData, {
          mode,
          seed,
          source: "demo",
          recipientEmail: normalizedRecipient,
        });
      }

      const duration = stopClock(startedAt);
      setResult(nextResult);
      setStatus("done");
      const workflowMode = useLiveWorkflow ? "live" : "demo";
      setLastRunMeta({ scenarioId: scenario.id, seed, source: nextResult.source, recipientEmail: normalizedRecipient, workflowMode });
      setHistory((previous) =>
        [
          {
            scenarioId: scenario.id,
            scenarioLabel: scenario.label,
            seed,
            source: nextResult.source,
            workflowMode,
            recipientEmail: normalizedRecipient,
            result: nextResult,
            duration,
            time: new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"),
          },
          ...previous,
        ].slice(0, 20),
      );
    } catch (runError) {
      stopClock(startedAt);
      setStatus("error");
      setError(runError.message);
      setHistory((previous) =>
        [
          {
            scenarioId: scenario.id,
            scenarioLabel: scenario.label,
            seed,
            source: mode,
            workflowMode: useLiveWorkflow ? "live" : "demo",
            recipientEmail: normalizedRecipient,
            status: "error",
            duration: 0,
            time: new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"),
          },
          ...previous,
        ].slice(0, 20),
      );
    }
  }

  runScenarioRef.current = runScenario;

  useEffect(() => {
    if (!autoDemo || mode !== "demo" || !scenarios.length || status === "running") return undefined;

    const delay = status === "idle" ? 1200 : 12000;
    const timeoutId = window.setTimeout(() => {
      const nextSeed = createSeed("auto");
      setSeedInput(nextSeed);
      const nextScenario = pickWeightedScenario(scenarios, nextSeed);
      if (nextScenario) {
        runScenarioRef.current?.(nextScenario, nextSeed);
      }
    }, delay);

    return () => window.clearTimeout(timeoutId);
  }, [autoDemo, mode, scenarios, status]);

  const handleRandomRun = () => {
    const nextSeed = resolveRunSeed(mode === "demo" ? "demo" : "live");
    const nextScenario = pickWeightedScenario(scenarios, nextSeed);
    runScenario(nextScenario, nextSeed);
  };

  const handleScenarioRun = (scenario) => {
    const nextSeed = resolveRunSeed(scenario.id);
    runScenario(scenario, nextSeed);
  };

  const handleReplay = (item = lastRunMeta) => {
    if (!item) return;
    const replayScenario = resolveScenarioById(scenarios, item.scenarioId);
    if (!replayScenario) return;
    const replayRecipient = item.recipientEmail || item.result?.delivery?.recipient || "";
    const replayMode = item.workflowMode || (item.source === "live" || item.source === "demo_fallback" ? "live" : "demo");
    if (mode !== replayMode) {
      setMode(replayMode);
    }
    setSeedInput(item.seed);
    runScenario(replayScenario, item.seed, { recipientEmail: replayRecipient, forceLive: replayMode === "live" });
  };

  const handleSendEmail = () => {
    if (!selectedScenario) {
      setError(lang === "ko" ? "수신자에게 메일을 보내기 전에 incident template을 먼저 선택해주세요." : "Select an incident template before sending email to a recipient.");
      return;
    }

    const normalizedRecipient = normalizeRecipientEmail(recipientEmail);
    if (!isValidEmail(normalizedRecipient)) {
      setError(lang === "ko" ? "유효한 수신자 이메일 주소를 입력해주세요." : "Enter a valid recipient email address.");
      return;
    }

    if (!webhookUrl.trim()) {
      setError(lang === "ko" ? "지정한 수신자에게 실제 이메일을 보내려면 n8n Webhook URL을 먼저 입력해야 합니다." : "Enter the n8n webhook URL before sending a live email to the specified recipient.");
      return;
    }

    if (mode !== "live") {
      setMode("live");
    }

    const nextSeed = resolveRunSeed(`${selectedScenario.id}-email`);
    runScenario(selectedScenario, nextSeed, {
      forceLive: true,
      recipientEmail: normalizedRecipient,
    });
  };

  const isBusy = status === "running" || scenariosLoading;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `linear-gradient(180deg, ${THEME.bgDeep} 0%, ${THEME.bg} 48%, ${THEME.bgDeep} 100%)`,
        color: THEME.text,
        fontFamily: BODY_FONT,
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Noto+Sans+KR:wght@400;500;700;800&display=swap"
        rel="stylesheet"
      />
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body { margin: 0; background: ${THEME.bgDeep}; color: ${THEME.text}; font-family: ${BODY_FONT}; }
        input, textarea, button { font: inherit; }
        ::selection { background: rgba(186, 209, 255, 0.24); }
      `}</style>

      <TopNav mode={mode} status={status} lang={lang} setLang={setLang} />

      <main style={{ position: "relative", zIndex: 1, maxWidth: "1280px", margin: "0 auto", padding: "0 24px 60px" }}>
        <HeroSection mode={mode} status={status} lastRunMeta={lastRunMeta} lang={lang} />
        <ProblemSection lang={lang} />
        <SolutionSection lang={lang} />
        <ProcessSection activeNode={activeNode} status={status} lang={lang} />

        <PageSection id="simulator" tint="rgba(198,143,152,0.24)">
          <NarrativeHeader
            eyebrow={lang === "ko" ? "제품 워크스페이스" : "Product Workspace"}
            title={lang === "ko" ? "케이스 트리아지, 라우팅, 증적 기록을 위한 실제 제품 화면." : "A working product surface for case triage, routing, and evidence capture."}
            description={lang === "ko" ? "상단 섹션이 문제와 솔루션을 설명한다면, 이 영역은 실제 제품이 incident를 어떻게 받아들이고, 처리하고, 결과를 남기는지 보여줍니다. 선택된 case, pipeline state, result, history를 하나의 workspace로 묶었습니다." : "While the upper sections explain the problem and solution, this workspace shows how the product ingests, processes, and records each incident."}
          />

          {scenarioLoadError ? <NoticeBanner kind="error" text={scenarioLoadError} lang={lang} /> : null}
          {warning ? <NoticeBanner kind="warning" text={warning} lang={lang} /> : null}
          {error ? <NoticeBanner kind="error" text={error} lang={lang} /> : null}

          <div style={{ display: "grid", gap: "14px", marginTop: "14px" }}>
            <SelectedScenarioCard scenario={selectedScenario} seed={seedInput} mode={mode} lastRunMeta={lastRunMeta} lang={lang} />

            <SectionPanel title={lang === "ko" ? "실행 모니터" : "Execution Monitor"} subtitle={lang === "ko" ? "현재 case가 어떤 단계까지 진행되었는지를 operator 시점에서 설명할 수 있습니다." : "Explain the current case progress from an operator point of view."} accent="rgba(142,167,255,0.18)">
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <StatusDot status={status} />
                  <span style={{ color: "rgba(255,255,255,0.78)", fontSize: "12px" }}>
                    {status === "running" ? `${lang === "ko" ? "실행 중" : "Running"} ${(elapsed / 1000).toFixed(1)}s` : status === "done" ? (lang === "ko" ? "최근 실행 완료" : "Last run completed") : (lang === "ko" ? "다음 시나리오 준비 완료" : "Ready for next scenario")}
                  </span>
                </div>
                <span style={{ color: "rgba(255,255,255,0.42)", fontSize: "11px" }}>{t(MODE_COPY[mode].subtitle, lang)}</span>
              </div>
              <PipelineVisualizer activeNode={activeNode} status={status} />
              {result ? (
                <ResultCard result={result} lang={lang} />
              ) : (
                <div
                  style={{
                    marginTop: "18px",
                    borderRadius: "18px",
                    padding: "20px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px dashed rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.62)",
                    fontSize: "13px",
                    lineHeight: 1.8,
                  }}
                >
                  {lang === "ko" ? "아직 실행된 결과가 없습니다. `Run Case Mix` 또는 개별 incident template을 선택하면 이 영역이 P1/P2/P3 결과 카드로 채워집니다." : "There is no result yet. Run the case mix or select an incident template to fill this area with a P1/P2/P3 result card."}
                </div>
              )}
            </SectionPanel>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "14px", marginTop: "14px" }}>
            <InboxDeliveryPanel
              lang={lang}
              mode={mode}
              webhookUrl={webhookUrl}
              recipientEmail={recipientEmail}
              setRecipientEmail={setRecipientEmail}
              selectedScenario={selectedScenario}
              handleSendEmail={handleSendEmail}
              isBusy={isBusy || !scenarios.length}
              result={result}
            />
            <MissionControlPanel
              lang={lang}
              mode={mode}
              setMode={setMode}
              handleRandomRun={handleRandomRun}
              handleReplay={handleReplay}
              seedInput={seedInput}
              setSeedInput={setSeedInput}
              autoDemo={autoDemo}
              setAutoDemo={setAutoDemo}
              isBusy={isBusy || !scenarios.length}
              lastRunMeta={lastRunMeta}
            />
            <DeploymentBridgePanel
              lang={lang}
              mode={mode}
              webhookUrl={webhookUrl}
              setWebhookUrl={setWebhookUrl}
              scenariosLoading={scenariosLoading}
              scenariosCount={scenarios.length}
              lastRunMeta={lastRunMeta}
            />
          </div>

          <div style={{ marginTop: "14px" }}>
            <SectionPanel title={lang === "ko" ? "사건 템플릿" : "Incident Templates"} subtitle={lang === "ko" ? "case mix 외에도 각 incident를 직접 선택해 제품 동작을 확인할 수 있습니다." : "Inspect product behavior by selecting each incident directly in addition to the case mix."}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
                {scenarios.map((scenario) => (
                  <ScenarioCard
                    key={scenario.id}
                    scenario={scenario}
                    active={selectedScenarioId === scenario.id}
                    disabled={isBusy}
                    onClick={() => handleScenarioRun(scenario)}
                  />
                ))}
              </div>
            </SectionPanel>
          </div>

          <div style={{ marginTop: "14px" }}>
            <HistoryPanel history={history} onReplay={handleReplay} lang={lang} />
          </div>
        </PageSection>

        <AuditSection result={result} history={history} lastRunMeta={lastRunMeta} lang={lang} />
        <CustomersSection lang={lang} />

        <footer
          style={{
            marginTop: "36px",
            paddingTop: "18px",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            color: "rgba(255,255,255,0.28)",
            fontSize: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src={BRAND_LOGO} alt="ThreatWatch AI logo" style={{ height: "28px", width: "auto", display: "block", opacity: 0.92 }} />
            <span>{lang === "ko" ? "ThreatWatch AI 플랫폼 · 엔터프라이즈 트리아지 워크플로우" : "ThreatWatch AI Platform · Enterprise triage workflow"}</span>
          </div>
          <span>{lang === "ko" ? "AI 기반 라우팅, 승인, 감사 대응형 케이스 처리" : "AI-assisted routing, approval, and audit-ready case handling"}</span>
        </footer>
      </main>
    </div>
  );
}
