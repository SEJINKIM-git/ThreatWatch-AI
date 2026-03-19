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
};

const MODE_COPY = {
  demo: {
    label: "Demo Mode",
    subtitle: "Seed 기반으로 언제든 같은 시나리오를 재현할 수 있는 발표용 모드",
  },
  live: {
    label: "Live Mode",
    subtitle: "n8n Webhook을 호출하는 운영형 모드. 실패하면 같은 시나리오의 fallback 결과로 전환",
  },
};

const NAV_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "problem", label: "Problem" },
  { id: "process", label: "Process" },
  { id: "simulator", label: "Simulator" },
  { id: "audit", label: "Audit" },
  { id: "strategy", label: "Strategy" },
];

const HERO_METRICS = [
  { label: "Alert Volume", value: "40-70/day", note: "manual triage baseline from assignment docs" },
  { label: "Triage SLA", value: "30 min", note: "time-sensitive screening window" },
  { label: "Human Boundary", value: "HITL", note: "manager approval remains required" },
  { label: "Audit Output", value: "JSON + Sheets", note: "structured triage and reporting" },
];

const AS_IS_ISSUES = [
  "분산된 SIEM, IAM, 이메일, 시트 사이에서 analyst가 컨텍스트를 수작업으로 모읍니다.",
  "알림이 몰릴 때 우선순위 판단이 사람마다 달라지고, 고위험 항목이 늦게 올라갈 수 있습니다.",
  "결정 근거가 메신저·스프레드시트에 흩어져 있어서 감사 추적성과 설명 가능성이 약합니다.",
];

const RED_BOX_SCOPE = [
  "Alert ticket creation + enrichment",
  "Missing critical data gate",
  "LLM summary and entity extraction",
  "Validation + rule-based risk scoring",
  "Escalation package draft before manager approval",
];

const TO_BE_PROMISES = [
  "규칙 기반 점수와 LLM 요약을 결합해 triage 속도와 일관성을 높입니다.",
  "고위험은 HITL 승인으로 보내고, 저위험은 monitoring queue 또는 close로 라우팅합니다.",
  "모든 결과를 structured JSON과 로그로 남겨 발표 후에도 운영형 사이트로 연결할 수 있습니다.",
];

const PROCESS_LANES = [
  {
    lane: "Monitoring / SIEM",
    accent: "#70a7ff",
    steps: [
      {
        ids: ["trigger"],
        title: "Abnormal signal detected",
        detail: "SIEM or monitoring system opens an alert ticket and starts the workflow.",
      },
      {
        ids: ["build"],
        title: "Pull enrichment data",
        detail: "Asset criticality, PII flag, geo-IP, and attempts count are gathered into one payload.",
      },
    ],
  },
  {
    lane: "SOC Analyst",
    accent: "#7f7cff",
    steps: [
      {
        ids: ["precheck"],
        title: "Review missing critical data",
        detail: "If key fields are absent, the case loops into a request-for-more-evidence path.",
      },
      {
        ids: ["llm", "parse", "confidence"],
        title: "Summarize and validate",
        detail: "LLM extracts entities and writes strict JSON, then the workflow validates structure and confidence.",
      },
      {
        ids: ["normalize", "decision"],
        title: "Score and route",
        detail: "Rules compute final severity using score, PII exposure, and suspicious volume thresholds.",
      },
    ],
  },
  {
    lane: "SOC Manager / HITL",
    accent: "#f06bc2",
    steps: [
      {
        ids: ["action"],
        title: "Approve escalation or hold",
        detail: "Manager review remains the accountability gate for P1/P2 escalation packages.",
      },
      {
        ids: ["action"],
        title: "Document low-risk path",
        detail: "Low-severity incidents are assigned to monitoring or closed with an auditable rationale.",
      },
    ],
  },
  {
    lane: "IR / Compliance",
    accent: "#ff8156",
    steps: [
      {
        ids: ["action"],
        title: "Escalated to IR",
        detail: "Approved high-risk cases move downstream with context, score, and recommendation attached.",
      },
      {
        ids: ["action"],
        title: "Logged for monitoring",
        detail: "Every case is still recorded for reporting, audit review, and later statistical analysis.",
      },
    ],
  },
];

const ENGINE_MAP = [
  { node: "Webhook", meaning: "Alert intake / workflow trigger", stage: "BPMN: ticket created" },
  { node: "02_Build_Alert_Data", meaning: "Enrichment and payload assembly", stage: "BPMN: pull enrichment data" },
  { node: "03_PreCheck_Requirements", meaning: "Check for missing critical fields", stage: "BPMN: missing critical data?" },
  { node: "05_LLM_Risk_Assessment", meaning: "LLM summary and entity extraction", stage: "BPMN: summarize alert" },
  { node: "06_Parse_LLM_Output", meaning: "Schema parsing and structured output", stage: "BPMN: validate structured JSON" },
  { node: "08_Normalize_Final_Payload", meaning: "Canonical triage JSON output", stage: "BPMN: compute final decision package" },
  { node: "09_Risk_Level_Decision", meaning: "P1 / P2 / P3 routing", stage: "BPMN: severity decision" },
  { node: "Email + Google Sheets", meaning: "Escalation notification and audit log", stage: "BPMN: approval + monitoring log" },
];

const AUDIT_PILLARS = [
  {
    title: "Structured Triage JSON",
    text: "요약, 엔터티, 점수, confidence, recommendation을 같은 스키마로 저장해 결과를 설명할 수 있게 만듭니다.",
  },
  {
    title: "Manager Approval Boundary",
    text: "고위험 escalation은 자동 완결이 아니라 승인 게이트를 통과해야 하므로 발표와 실제 운영 모두에서 책임 구분이 분명합니다.",
  },
  {
    title: "Retry and Fallback",
    text: "missing critical data, low confidence, live webhook failure 같은 예외를 기록하고 안전한 fallback 경로를 보여줍니다.",
  },
  {
    title: "Sheets-Based Reporting",
    text: "P1/P2/P3를 모두 시트에 쌓아서 발표 후 통계, 감사, 데모 기록까지 하나의 로그로 이어집니다.",
  },
];

const STRATEGY_PILLARS = [
  {
    title: "Trust as the Product",
    text: "문서 전체의 메시지는 일관됩니다. 진짜 차별화 포인트는 AI 자체보다 빠르고 설명 가능한 운영 품질입니다.",
  },
  {
    title: "Operational Excellence",
    text: "ThreatWatch AI는 incident response 전체가 아니라 triage bottleneck을 줄여 SLA와 analyst workload를 개선하는 데 초점을 둡니다.",
  },
  {
    title: "Governance by Design",
    text: "audit trail, HITL, structured outputs가 들어가야 통신·보안 규제 환경에서도 신뢰할 수 있는 시스템처럼 보입니다.",
  },
];

const PRESENTATION_FLOW = [
  "As-Is BPMN의 red box를 먼저 보여주고, 병목이 어디인지 15초 안에 설명합니다.",
  "To-Be BPMN에서 자동화 범위와 HITL 경계를 짚으면서 전체 흐름을 보여줍니다.",
  "Random Scenario를 실행해 P1/P2/P3 또는 retry/escalation 시나리오를 실제로 재생합니다.",
  "마지막으로 structured JSON과 audit log를 보여주며 웹사이트가 발표용을 넘어 운영형 설계임을 강조합니다.",
];

function readStoredValue(key, fallback) {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function writeStoredValue(key, value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}

function NarrativeHeader({ eyebrow, title, description, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "20px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "18px" }}>
      <div style={{ maxWidth: "760px" }}>
        <div
          style={{
            fontSize: "11px",
            color: "rgba(133, 197, 255, 0.9)",
            textTransform: "uppercase",
            letterSpacing: "1.4px",
            fontWeight: 700,
            fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          {eyebrow}
        </div>
        <h2
          style={{
            margin: "8px 0 0",
            color: "#f8fbff",
            fontSize: "34px",
            lineHeight: 1.12,
            fontWeight: 800,
            fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          {title}
        </h2>
        <p style={{ margin: "12px 0 0", color: "rgba(229, 237, 247, 0.7)", fontSize: "15px", lineHeight: 1.8 }}>{description}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

function SectionPanel({ title, subtitle, children, accent = "rgba(255,255,255,0.07)" }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(12,19,34,0.92), rgba(6,10,18,0.88))",
        border: `1px solid ${accent}`,
        borderRadius: "22px",
        padding: "20px",
        boxShadow: "0 24px 54px rgba(0,0,0,0.22)",
        backdropFilter: "blur(18px)",
      }}
    >
      <div style={{ marginBottom: "16px" }}>
        <div
          style={{
            fontSize: "11px",
            color: "rgba(255,255,255,0.38)",
            letterSpacing: "0.9px",
            textTransform: "uppercase",
            fontWeight: 700,
            fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          {title}
        </div>
        {subtitle ? <div style={{ marginTop: "6px", color: "rgba(255,255,255,0.6)", fontSize: "12px", lineHeight: 1.7 }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}

function MetricCard({ label, value, accent }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${accent || "rgba(255,255,255,0.06)"}`,
        borderRadius: "14px",
        padding: "14px",
      }}
    >
      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.36)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "6px" }}>{label}</div>
      <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.88)", fontWeight: 600, lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

function StatusDot({ status }) {
  const color =
    status === "running" ? "#00e5ff" : status === "done" ? "#76ff03" : status === "error" ? "#ff1744" : "rgba(255,255,255,0.3)";

  return (
    <div
      style={{
        width: "10px",
        height: "10px",
        borderRadius: "999px",
        background: color,
        boxShadow: status === "running" ? "0 0 14px rgba(0,229,255,0.45)" : "none",
      }}
    />
  );
}

function NoticeBanner({ kind, text }) {
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
      <div style={{ fontSize: "11px", color: palette.text, fontWeight: 700, marginBottom: "4px", letterSpacing: "0.5px" }}>{kind === "warning" ? "WARNING" : "ERROR"}</div>
      <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.8)", lineHeight: 1.7 }}>{text}</div>
    </div>
  );
}

function TopNav({ mode, status }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        backdropFilter: "blur(18px)",
        background: "rgba(5, 9, 19, 0.76)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "18px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #00e5ff, #76ff03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#06111a",
              fontWeight: 900,
              fontSize: "18px",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            T
          </div>
          <div>
            <div style={{ color: "#f8fbff", fontWeight: 800, fontSize: "14px", fontFamily: "'Space Grotesk', sans-serif" }}>ThreatWatch AI</div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "11px" }}>Interactive BPMN-driven SOC triage website</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                style={{
                  color: "rgba(255,255,255,0.62)",
                  textDecoration: "none",
                  fontSize: "12px",
                  padding: "8px 10px",
                  borderRadius: "999px",
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                {item.label}
              </a>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "999px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <StatusDot status={status} />
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.76)" }}>{MODE_COPY[mode].label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroSection({ mode, status, elapsed, scenariosCount, lastRunMeta }) {
  return (
    <section id="overview" style={{ paddingTop: "40px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", gap: "18px", alignItems: "stretch" }}>
        <SectionPanel accent="rgba(0,229,255,0.2)">
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              borderRadius: "999px",
              border: "1px solid rgba(133, 197, 255, 0.25)",
              background: "rgba(133, 197, 255, 0.08)",
              color: "#9ed1ff",
              padding: "7px 12px",
              fontSize: "11px",
              letterSpacing: "0.9px",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            PPT-aligned security triage simulator
          </div>

          <h1
            style={{
              margin: "18px 0 0",
              fontSize: "54px",
              lineHeight: 1.02,
              color: "#f8fbff",
              fontWeight: 800,
              fontFamily: "'Space Grotesk', sans-serif",
              maxWidth: "760px",
            }}
          >
            Explainable SOC triage that turns BPMN into a live website experience.
          </h1>

          <p style={{ margin: "18px 0 0", maxWidth: "720px", color: "rgba(229,237,247,0.74)", fontSize: "16px", lineHeight: 1.9 }}>
            ThreatWatch AI는 n8n 노드를 전면에 내세우는 대신, 발표 자료의 BPMN 흐름을 그대로 살아 움직이게 만든 웹사이트입니다. 사용자는 랜덤 시나리오를 실행하고,
            시스템은 enrichment, LLM summary, validation, scoring, approval, audit trail까지 한 번에 보여줍니다.
          </p>

          <div style={{ display: "flex", gap: "12px", marginTop: "22px", flexWrap: "wrap" }}>
            <a
              href="#simulator"
              style={{
                textDecoration: "none",
                borderRadius: "999px",
                border: "1px solid rgba(0,229,255,0.35)",
                background: "linear-gradient(135deg, rgba(0,229,255,0.18), rgba(118,255,3,0.12))",
                color: "#d9fbff",
                padding: "12px 18px",
                fontSize: "13px",
                fontWeight: 700,
              }}
            >
              Jump to Live Simulator
            </a>
            <a
              href="#process"
              style={{
                textDecoration: "none",
                borderRadius: "999px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.03)",
                color: "rgba(255,255,255,0.82)",
                padding: "12px 18px",
                fontSize: "13px",
                fontWeight: 700,
              }}
            >
              View BPMN Flow
            </a>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginTop: "22px" }}>
            {HERO_METRICS.map((item) => (
              <MetricCard key={item.label} label={item.label} value={`${item.value}\n${item.note}`} accent="rgba(255,255,255,0.08)" />
            ))}
          </div>
        </SectionPanel>

        <SectionPanel title="Presentation Snapshot" subtitle="발표에서 바로 읽어줄 수 있는 시스템 정의를 오른쪽에 고정합니다." accent="rgba(118,255,3,0.16)">
          <div style={{ display: "grid", gap: "12px" }}>
            <MetricCard label="Current Mode" value={MODE_COPY[mode].label} accent="rgba(0,229,255,0.18)" />
            <MetricCard label="Status" value={status === "running" ? `Running ${(elapsed / 1000).toFixed(1)}s` : status === "done" ? "Ready with latest result" : "Waiting for next run"} accent="rgba(255,255,255,0.08)" />
            <MetricCard label="Scenario Pool" value={`${scenariosCount || 0} presentation scenarios`} accent="rgba(255,255,255,0.08)" />
            <MetricCard label="Last Seed" value={lastRunMeta?.seed || "No run yet"} accent="rgba(255,255,255,0.08)" />
          </div>

          <div
            style={{
              marginTop: "16px",
              padding: "14px",
              borderRadius: "16px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ color: "#f8fbff", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", marginBottom: "8px" }}>Narrative Thesis</div>
            <div style={{ color: "rgba(255,255,255,0.72)", fontSize: "13px", lineHeight: 1.8 }}>
              This is not a hacking tool. It is a security decision-support experience that visualizes how high-volume alerts become explainable, auditable triage outcomes.
            </div>
          </div>
        </SectionPanel>
      </div>
    </section>
  );
}

function ProblemSection() {
  return (
    <section id="problem" style={{ marginTop: "72px" }}>
      <NarrativeHeader
        eyebrow="As-Is to To-Be"
        title="The website should tell the red-box story before it shows any buttons."
        description="자료 전반에서 가장 중요한 메시지는 명확합니다. 우리가 자동화하려는 것은 incident response 전체가 아니라, 반복적이고 병목이 심한 triage decision 구간입니다. 그래서 사용자는 먼저 문제를 이해하고, 그 다음에 시뮬레이터를 실행해야 합니다."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
        <SectionPanel title="As-Is Bottleneck" subtitle="문서와 BPMN에서 반복되는 현재 문제점입니다." accent="rgba(255,99,132,0.18)">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {AS_IS_ISSUES.map((item) => (
              <div key={item} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#ff6b81", marginTop: "7px", flexShrink: 0 }} />
                <div style={{ color: "rgba(255,255,255,0.78)", fontSize: "13px", lineHeight: 1.8 }}>{item}</div>
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel title="Red Box Automation Scope" subtitle="웹사이트가 가장 분명하게 강조해야 하는 범위입니다." accent="rgba(255,145,0,0.2)">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {RED_BOX_SCOPE.map((item) => (
              <div
                key={item}
                style={{
                  borderRadius: "14px",
                  padding: "12px 14px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,145,0,0.14)",
                  color: "rgba(255,255,255,0.82)",
                  fontSize: "13px",
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel title="To-Be Promise" subtitle="자동화 이후에도 사람이 사라지지 않는다는 점이 중요합니다." accent="rgba(118,255,3,0.2)">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {TO_BE_PROMISES.map((item) => (
              <div key={item} style={{ color: "rgba(255,255,255,0.78)", fontSize: "13px", lineHeight: 1.8 }}>
                {item}
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </section>
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

function ProcessSection({ activeNode, status }) {
  return (
    <section id="process" style={{ marginTop: "72px" }}>
      <NarrativeHeader
        eyebrow="To-Be BPMN"
        title="The BPMN flow is the primary product experience."
        description="이 섹션은 첨부한 To-Be BPMN을 웹용으로 번역한 영역입니다. lane과 decision path가 중심이며, n8n 노드는 이 흐름을 구현하는 엔진 뷰로만 보여줍니다."
        action={
          <a
            href="#simulator"
            style={{
              textDecoration: "none",
              borderRadius: "999px",
              padding: "11px 16px",
              color: "#dffcff",
              fontSize: "12px",
              fontWeight: 700,
              border: "1px solid rgba(0,229,255,0.25)",
              background: "rgba(0,229,255,0.08)",
            }}
          >
            Run This Flow Live
          </a>
        }
      />

      <div style={{ display: "grid", gap: "14px" }}>
        {PROCESS_LANES.map((lane) => (
          <SectionPanel key={lane.lane} title={lane.lane} subtitle="BPMN lane view" accent={`${lane.accent}33`}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              {lane.steps.map((step) => {
                const state = getProcessStepState(step.ids, activeNode, status);
                const palette = {
                  idle: { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", text: "rgba(255,255,255,0.82)" },
                  active: { bg: `${lane.accent}12`, border: `${lane.accent}88`, text: "#ffffff" },
                  done: { bg: "rgba(118,255,3,0.08)", border: "rgba(118,255,3,0.35)", text: "#ffffff" },
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
                      {state === "active" ? "Active step" : state === "done" ? "Completed" : state === "error" ? "Needs attention" : "Process step"}
                    </div>
                    <div style={{ marginTop: "10px", fontSize: "18px", color: palette.text, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1.2 }}>
                      {step.title}
                    </div>
                    <div style={{ marginTop: "10px", color: "rgba(255,255,255,0.68)", fontSize: "13px", lineHeight: 1.75 }}>{step.detail}</div>
                  </div>
                );
              })}
            </div>
          </SectionPanel>
        ))}

        <SectionPanel title="Engine View" subtitle="n8n 노드는 구동 원리를 보여주는 보조 레이어로 유지합니다." accent="rgba(133, 197, 255, 0.18)">
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
                <div style={{ color: "#f8fbff", fontWeight: 700, fontSize: "13px", fontFamily: "'Space Grotesk', sans-serif" }}>{item.node}</div>
                <div style={{ marginTop: "6px", color: "rgba(255,255,255,0.7)", fontSize: "12px", lineHeight: 1.6 }}>{item.meaning}</div>
                <div style={{ marginTop: "8px", color: "rgba(133, 197, 255, 0.85)", fontSize: "11px" }}>{item.stage}</div>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </section>
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
          active: { bg: "rgba(0,229,255,0.12)", border: "rgba(0,229,255,0.55)", text: "#00e5ff" },
          done: { bg: "rgba(118,255,3,0.1)", border: "rgba(118,255,3,0.35)", text: "#76ff03" },
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
                    border: "2px solid rgba(0,229,255,0.28)",
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
                      ? "rgba(118,255,3,0.4)"
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
      <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.86)", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{scenario.label}</div>
      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.34)", marginTop: "5px" }}>{scenario.input?.incident_type}</div>
      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.56)", marginTop: "10px", lineHeight: 1.7 }}>{scenario.description}</div>
    </button>
  );
}

function SelectedScenarioCard({ scenario, seed, mode, lastRunMeta }) {
  if (!scenario) return null;

  const currentRisk = scenario.expected_output?.risk_level || scenario.risk_level || "P2";
  const riskMeta = RISK_META[currentRisk] || RISK_META.P2;

  return (
    <SectionPanel title="Scenario Briefing" subtitle="발표자는 여기서 시나리오 의도와 기대 경로를 빠르게 설명할 수 있습니다." accent={`${riskMeta.border}44`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "14px", flexWrap: "wrap" }}>
        <div>
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
            <span style={{ color: "rgba(255,255,255,0.9)", fontSize: "20px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{scenario.label}</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.64)", fontSize: "12px", lineHeight: 1.8 }}>{scenario.presenter_note}</div>
        </div>
        <div
          style={{
            minWidth: "180px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "14px",
            padding: "12px",
          }}
        >
          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px" }}>Run Snapshot</div>
          <div style={{ marginTop: "8px", fontSize: "12px", color: "rgba(255,255,255,0.82)", lineHeight: 1.7 }}>
            <div>Mode: {MODE_COPY[mode].label}</div>
            <div>Seed: {seed || "Auto generated"}</div>
            <div>Last source: {lastRunMeta?.source || "Not run yet"}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginTop: "16px" }}>
        <MetricCard label="Expected Route" value={scenario.expected_route} accent={`${riskMeta.border}55`} />
        <MetricCard label="Expected Score" value={`${scenario.expected_output?.risk_score || "?"}/100`} accent="rgba(255,255,255,0.08)" />
        <MetricCard label="Confidence" value={`${Math.round((scenario.expected_output?.confidence || 0) * 100)}%`} accent="rgba(255,255,255,0.08)" />
      </div>

      <div style={{ marginTop: "16px" }}>
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Signal Indicators</div>
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

function ResultCard({ result }) {
  if (!result) return null;

  const payload = result.final_payload || result;
  const aiResult = result.ai_result || {};
  const precheck = result.precheck_result || {};
  const riskMeta = RISK_META[payload.risk_level] || RISK_META.P2;
  const sourceLabel = result.source === "demo_fallback" ? "Fallback Output" : result.source === "live" ? "Live Output" : "Demo Output";

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
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {payload.risk_level}
          </div>
          <div>
            <div style={{ fontSize: "18px", color: "#fff", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>Live Triage Result</div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.48)", marginTop: "4px" }}>
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
            }}
          >
            Seed {result.seed || "n/a"}
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
            }}
          >
            {result.expected_route || "Route pending"}
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px", marginBottom: "18px" }}>
        <MetricCard label="Alert ID" value={payload.alert_id || "—"} accent="rgba(255,255,255,0.08)" />
        <MetricCard label="Incident Type" value={payload.incident_type || "—"} accent="rgba(255,255,255,0.08)" />
        <MetricCard label="Risk Score" value={payload.risk_score ? `${payload.risk_score}/100` : "N/A"} accent={`${riskMeta.border}45`} />
        <MetricCard label="Confidence" value={payload.confidence ? `${Math.round(payload.confidence * 100)}%` : "N/A"} accent="rgba(255,255,255,0.08)" />
        <MetricCard label="PreCheck" value={precheck.decision || "—"} accent="rgba(255,255,255,0.08)" />
        <MetricCard label="Missing Data" value={String(payload.missing_data_count ?? 0)} accent="rgba(255,255,255,0.08)" />
      </div>

      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "14px",
          padding: "16px",
          marginBottom: "14px",
        }}
      >
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Executive Summary</div>
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.84)", lineHeight: 1.8 }}>{payload.summary}</div>
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
          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Why It Matters</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(aiResult.rationale || []).map((item) => (
              <div key={item} style={{ fontSize: "12px", color: "rgba(255,255,255,0.76)", lineHeight: 1.7 }}>
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
          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Recommended Actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(aiResult.recommended_actions || []).map((item) => (
              <div key={item} style={{ fontSize: "12px", color: "rgba(255,255,255,0.76)", lineHeight: 1.7 }}>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryPanel({ history, onReplay }) {
  if (!history.length) return null;

  return (
    <SectionPanel title="Run History" subtitle="발표에서는 바로 이전 seed를 다시 재생하면서 결과의 재현성을 보여줄 수 있습니다.">
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
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
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
                <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.74)" }}>{item.scenarioLabel}</span>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>seed {item.seed}</span>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.24)" }}>
                  {item.duration ? `${(item.duration / 1000).toFixed(1)}s` : "—"} · {item.source}
                </span>
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
                Replay
              </button>
            </div>
          );
        })}
      </div>
    </SectionPanel>
  );
}

function MissionControlPanel({
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
    <SectionPanel title="Mission Control" subtitle="랜덤 실행, seed 재현, 자동 데모까지 발표에 필요한 제어를 한 화면에서 다룹니다.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
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
                border: `1px solid ${active ? "rgba(0,229,255,0.4)" : "rgba(255,255,255,0.08)"}`,
                background: active ? "rgba(0,229,255,0.12)" : "rgba(255,255,255,0.03)",
                color: active ? "#00e5ff" : "rgba(255,255,255,0.64)",
                textAlign: "left",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "12px", fontFamily: "'Space Grotesk', sans-serif" }}>{MODE_COPY[option].label}</div>
              <div style={{ marginTop: "4px", fontSize: "10px", lineHeight: 1.6 }}>{MODE_COPY[option].subtitle}</div>
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
            border: "1px solid rgba(0,229,255,0.35)",
            background: "linear-gradient(135deg, rgba(0,229,255,0.18), rgba(118,255,3,0.12))",
            color: "#00e5ff",
            padding: "10px 14px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: isBusy ? "not-allowed" : "pointer",
          }}
        >
          Weighted Random Run
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
          Replay Last Seed
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
          New Seed
        </button>
        <button
          onClick={() => setAutoDemo((current) => !current)}
          disabled={mode !== "demo"}
          style={{
            borderRadius: "999px",
            border: `1px solid ${autoDemo ? "rgba(118,255,3,0.32)" : "rgba(255,255,255,0.12)"}`,
            background: autoDemo ? "rgba(118,255,3,0.12)" : "rgba(255,255,255,0.04)",
            color: autoDemo ? "#76ff03" : "rgba(255,255,255,0.74)",
            padding: "10px 14px",
            fontSize: "12px",
            cursor: mode !== "demo" ? "not-allowed" : "pointer",
          }}
        >
          {autoDemo ? "Auto Demo On" : "Auto Demo Off"}
        </button>
      </div>

      <div style={{ marginTop: "14px" }}>
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Seed Control</div>
        <input
          type="text"
          value={seedInput}
          onChange={(event) => setSeedInput(event.target.value)}
          placeholder="demo-seed-123"
          style={{
            width: "100%",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.09)",
            background: "rgba(0,0,0,0.24)",
            color: "#fff",
            padding: "12px 14px",
            fontSize: "12px",
            outline: "none",
          }}
        />
        <div style={{ marginTop: "8px", fontSize: "11px", color: "rgba(255,255,255,0.38)", lineHeight: 1.6 }}>
          같은 seed를 다시 넣고 실행하면 발표 중에도 같은 랜덤 시나리오를 그대로 재현할 수 있습니다.
        </div>
      </div>
    </SectionPanel>
  );
}

function DeploymentBridgePanel({ mode, webhookUrl, setWebhookUrl, scenariosLoading, scenariosCount, lastRunMeta }) {
  return (
    <SectionPanel title="Deployment Bridge" subtitle="발표는 Demo Mode로 안전하게 진행하고, 이후에는 Live Mode로 n8n에 연결합니다.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px", marginBottom: "14px" }}>
        <MetricCard label="Scenario Pool" value={scenariosLoading ? "Loading..." : `${scenariosCount} scenarios`} accent="rgba(255,255,255,0.08)" />
        <MetricCard label="Current Mode" value={MODE_COPY[mode].label} accent="rgba(0,229,255,0.25)" />
        <MetricCard label="Last Seed" value={lastRunMeta?.seed || "Not run yet"} accent="rgba(255,255,255,0.08)" />
      </div>

      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>n8n Webhook</div>
      <input
        type="text"
        value={webhookUrl}
        onChange={(event) => setWebhookUrl(event.target.value)}
        placeholder="https://your-n8n.app.n8n.cloud/webhook/threatwatch"
        style={{
          width: "100%",
          borderRadius: "12px",
          border: "1px solid rgba(255,255,255,0.09)",
          background: "rgba(0,0,0,0.24)",
          color: "#fff",
          padding: "12px 14px",
          fontSize: "12px",
          outline: "none",
        }}
      />
      <div style={{ marginTop: "8px", fontSize: "11px", color: "rgba(255,255,255,0.42)", lineHeight: 1.7 }}>
        Demo Mode에서는 이 URL 없이도 안정적으로 시연할 수 있습니다. Live Mode에서는 Webhook을 호출하고, 실패하면 같은 시나리오의 deterministic fallback을 보여줍니다.
      </div>
    </SectionPanel>
  );
}

function AuditSection({ result, history, lastRunMeta }) {
  const payload = result?.final_payload;

  return (
    <section id="audit" style={{ marginTop: "72px" }}>
      <NarrativeHeader
        eyebrow="Audit and Governance"
        title="The website should make trust visible, not implied."
        description="이 프로젝트의 강점은 결과를 예쁘게 보여주는 데서 끝나지 않습니다. why, who approved, what route was taken, what was missing, what was logged 같은 운영 흔적을 웹사이트에서 바로 보여줘야 문서와 발표 메시지가 일치합니다."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
        {AUDIT_PILLARS.map((pillar) => (
          <SectionPanel key={pillar.title} title={pillar.title} accent="rgba(133, 197, 255, 0.16)">
            <div style={{ color: "rgba(255,255,255,0.74)", fontSize: "13px", lineHeight: 1.8 }}>{pillar.text}</div>
          </SectionPanel>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(320px, 0.85fr)", gap: "14px", marginTop: "14px" }}>
        <SectionPanel title="Current Audit Snapshot" subtitle="현재 실행 결과를 audit-friendly 형태로 재확인합니다." accent="rgba(118,255,3,0.16)">
          {result ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px", marginBottom: "14px" }}>
                <MetricCard label="Route" value={result.expected_route || "—"} accent="rgba(255,255,255,0.08)" />
                <MetricCard label="Risk Level" value={payload?.risk_level || "—"} accent="rgba(255,255,255,0.08)" />
                <MetricCard label="Risk Score" value={payload?.risk_score ? `${payload.risk_score}/100` : "—"} accent="rgba(255,255,255,0.08)" />
                <MetricCard label="Last Source" value={result.source || "—"} accent="rgba(255,255,255,0.08)" />
              </div>

              <div
                style={{
                  borderRadius: "16px",
                  padding: "16px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.34)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "8px" }}>Structured Payload Preview</div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: "11px",
                    lineHeight: 1.7,
                    color: "#a7c7ff",
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  }}
                >
                  {JSON.stringify(result.final_payload, null, 2)}
                </pre>
              </div>
            </>
          ) : (
            <div style={{ color: "rgba(255,255,255,0.66)", fontSize: "13px", lineHeight: 1.8 }}>
              아직 실행 결과가 없습니다. 시뮬레이터를 한 번 돌리면 이 영역이 바로 structured JSON preview와 route snapshot으로 채워집니다.
            </div>
          )}
        </SectionPanel>

        <SectionPanel title="Logging Surfaces" subtitle="Google Sheets와 history를 통해 발표 후에도 추적 가능한 로그를 유지합니다." accent="rgba(255,145,0,0.16)">
          <div style={{ display: "grid", gap: "10px" }}>
            <MetricCard label="Run History Entries" value={String(history.length)} accent="rgba(255,255,255,0.08)" />
            <MetricCard label="Last Seed" value={lastRunMeta?.seed || "Not run yet"} accent="rgba(255,255,255,0.08)" />
            <MetricCard label="Shared Scenario Source" value="/public/demo-scenarios.json" accent="rgba(255,255,255,0.08)" />
          </div>

          <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {["All incidents logged", "P1/P2 send escalation trail", "P3 stays visible in monitoring queue", "Retry / fallback remains explainable"].map((item) => (
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
    </section>
  );
}

function StrategySection() {
  return (
    <section id="strategy" style={{ marginTop: "72px" }}>
      <NarrativeHeader
        eyebrow="Strategic Framing"
        title="ThreatWatch AI should feel like an operational trust layer, not a flashy AI toy."
        description="경쟁전략 문서와 AI disruption 분석 문서가 반복해서 말하는 것은, 보안·규제 환경에서 중요한 차별점은 신뢰, 일관성, 감사 가능성이라는 점입니다. 웹사이트도 그 방향으로 마무리되어야 합니다."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
        {STRATEGY_PILLARS.map((pillar) => (
          <SectionPanel key={pillar.title} title={pillar.title} accent="rgba(133, 197, 255, 0.16)">
            <div style={{ color: "rgba(255,255,255,0.74)", fontSize: "13px", lineHeight: 1.8 }}>{pillar.text}</div>
          </SectionPanel>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.9fr)", gap: "14px", marginTop: "14px" }}>
        <SectionPanel title="Recommended Presentation Flow" subtitle="이 사이트를 실제 발표에서 이렇게 사용하면 자연스럽습니다." accent="rgba(118,255,3,0.16)">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {PRESENTATION_FLOW.map((item, index) => (
              <div key={item} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gap: "12px", alignItems: "start" }}>
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "999px",
                    background: "rgba(0,229,255,0.12)",
                    border: "1px solid rgba(0,229,255,0.32)",
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
                <div style={{ color: "rgba(255,255,255,0.78)", fontSize: "13px", lineHeight: 1.8 }}>{item}</div>
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel title="Website Tone Guide" subtitle="디자인과 카피의 톤도 발표 내용과 맞아야 합니다." accent="rgba(255,145,0,0.16)">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[
              "AI automation보다 explainable triage와 human accountability를 먼저 말하기",
              "n8n canvas를 메인 hero로 쓰지 않고 BPMN lane experience를 전면에 두기",
              "security, compliance, trust, audit-ready 같은 언어를 일관되게 유지하기",
              "결론은 ‘빠른 대응’이 아니라 ‘빠르고 설명 가능한 대응’으로 마무리하기",
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
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </section>
  );
}

export default function ThreatWatchDashboard() {
  const [scenarios, setScenarios] = useState([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [scenarioLoadError, setScenarioLoadError] = useState(null);
  const [mode, setMode] = useState(() => readStoredValue(STORAGE_KEYS.mode, "demo"));
  const [webhookUrl, setWebhookUrl] = useState(() => readStoredValue(STORAGE_KEYS.webhookUrl, ""));
  const [seedInput, setSeedInput] = useState(() => readStoredValue(STORAGE_KEYS.seed, ""));
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
          throw new Error(`시나리오 파일 로드 실패: HTTP ${response.status}`);
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
  }, []);

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

  async function runScenario(scenario, seed) {
    if (!scenario) {
      setError("실행할 시나리오를 먼저 선택해주세요.");
      return;
    }

    setStatus("running");
    setError(null);
    setWarning(null);
    setResult(null);
    setSelectedScenarioId(scenario.id);
    setActiveNode(null);

    const startedAt = startClock();
    const alertData = buildAlertData(scenario, seed);

    try {
      await runPipelineSequence(setActiveNode, ["trigger", "build", "precheck"], 420);
      setActiveNode("llm");

      let nextResult;
      if (mode === "live") {
        if (!webhookUrl.trim()) {
          throw new Error("Live Mode에서는 n8n Webhook URL을 입력해야 합니다.");
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
          nextResult = normalizeLiveResult(data, scenario, alertData, { mode, seed, source: "live" });
        } catch (liveError) {
          setWarning(`Live 요청이 실패해서 동일한 시나리오의 발표용 fallback 결과를 표시합니다. (${liveError.message})`);
          await runPipelineSequence(setActiveNode, ["parse", "confidence", "normalize", "decision", "action"], 220);
          nextResult = buildDemoResult(scenario, alertData, { mode, seed, source: "demo_fallback" });
        }
      } else {
        await runPipelineSequence(setActiveNode, ["parse", "confidence", "normalize", "decision", "action"], 280);
        nextResult = buildDemoResult(scenario, alertData, { mode, seed, source: "demo" });
      }

      const duration = stopClock(startedAt);
      setResult(nextResult);
      setStatus("done");
      setLastRunMeta({ scenarioId: scenario.id, seed, source: nextResult.source });
      setHistory((previous) =>
        [
          {
            scenarioId: scenario.id,
            scenarioLabel: scenario.label,
            seed,
            source: nextResult.source,
            result: nextResult,
            duration,
            time: new Date().toLocaleTimeString(),
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
            status: "error",
            duration: 0,
            time: new Date().toLocaleTimeString(),
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
    setSeedInput(item.seed);
    runScenario(replayScenario, item.seed);
  };

  const isBusy = status === "running" || scenariosLoading;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(0,229,255,0.12), transparent 24%), radial-gradient(circle at top right, rgba(118,255,3,0.07), transparent 26%), linear-gradient(180deg, #050913 0%, #08101d 45%, #050913 100%)",
        color: "#e2e8f0",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />

      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,255,0.008) 2px, rgba(0,229,255,0.008) 4px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <TopNav mode={mode} status={status} />

      <main style={{ position: "relative", zIndex: 1, maxWidth: "1280px", margin: "0 auto", padding: "0 24px 60px" }}>
        <HeroSection mode={mode} status={status} elapsed={elapsed} scenariosCount={scenarios.length} lastRunMeta={lastRunMeta} />
        <ProblemSection />
        <ProcessSection activeNode={activeNode} status={status} />

        <section id="simulator" style={{ marginTop: "72px" }}>
          <NarrativeHeader
            eyebrow="Live Simulator"
            title="The demo is now a section inside the story, not the whole story."
            description="현재 실행 엔진은 유지하면서, 발표 흐름에 맞게 selected scenario, pipeline state, result, history를 하나의 live simulator 섹션으로 묶었습니다. 여기서만 조작 패널과 webhook bridge를 보여줍니다."
          />

          {scenarioLoadError ? <NoticeBanner kind="error" text={scenarioLoadError} /> : null}
          {warning ? <NoticeBanner kind="warning" text={warning} /> : null}
          {error ? <NoticeBanner kind="error" text={error} /> : null}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px, 0.9fr)", gap: "14px", marginTop: "14px" }}>
            <div style={{ display: "grid", gap: "14px" }}>
              <SelectedScenarioCard scenario={selectedScenario} seed={seedInput} mode={mode} lastRunMeta={lastRunMeta} />

              <SectionPanel title="Execution Monitor" subtitle="웹사이트가 현재 어떤 단계까지 진행되었는지를 발표자가 실시간으로 설명할 수 있습니다." accent="rgba(0,229,255,0.18)">
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <StatusDot status={status} />
                    <span style={{ color: "rgba(255,255,255,0.78)", fontSize: "12px" }}>
                      {status === "running" ? `Running ${(elapsed / 1000).toFixed(1)}s` : status === "done" ? "Last run completed" : "Ready for next scenario"}
                    </span>
                  </div>
                  <span style={{ color: "rgba(255,255,255,0.42)", fontSize: "11px" }}>{MODE_COPY[mode].subtitle}</span>
                </div>
                <PipelineVisualizer activeNode={activeNode} status={status} />
                {result ? (
                  <ResultCard result={result} />
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
                    아직 실행된 결과가 없습니다. `Weighted Random Run` 또는 개별 시나리오를 선택하면 이 영역이 P1/P2/P3 결과 카드로 채워집니다.
                  </div>
                )}
              </SectionPanel>
            </div>

            <div style={{ display: "grid", gap: "14px" }}>
              <MissionControlPanel
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
                mode={mode}
                webhookUrl={webhookUrl}
                setWebhookUrl={setWebhookUrl}
                scenariosLoading={scenariosLoading}
                scenariosCount={scenarios.length}
                lastRunMeta={lastRunMeta}
              />
            </div>
          </div>

          <div style={{ marginTop: "14px" }}>
            <SectionPanel title="Scenario Library" subtitle="랜덤 실행 외에도 각 시나리오를 직접 선택해서 발표 흐름을 통제할 수 있습니다.">
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
            <HistoryPanel history={history} onReplay={handleReplay} />
          </div>
        </section>

        <AuditSection result={result} history={history} lastRunMeta={lastRunMeta} />
        <StrategySection />

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
          <span>ThreatWatch AI Demo Site · BPMN-first SOC triage simulator</span>
          <span>Shared scenario source: /public/demo-scenarios.json</span>
        </footer>
      </main>
    </div>
  );
}
