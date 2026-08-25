/**
 * Workspace 공용 상수와 API 클라이언트
 *
 * 색상과 폰트는 소개 사이트(App.jsx)의 톤을 따릅니다.
 */

export const BODY_FONT =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const MONO_FONT =
  '"SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace';

export const C = {
  bg: "#060a12",
  panel: "rgba(14, 21, 35, 0.72)",
  panelSolid: "#0e1523",
  border: "rgba(96, 132, 190, 0.22)",
  borderStrong: "rgba(96, 132, 190, 0.4)",

  text: "#edf3ff",
  textDim: "rgba(237, 243, 255, 0.62)",
  textFaint: "rgba(237, 243, 255, 0.38)",

  accent: "#4d9fff",
  accentDim: "rgba(77, 159, 255, 0.14)",
  teal: "#3ddbb6",

  p1: "#ff5c6c",
  p2: "#f5b13d",
  p3: "#3ddbb6",
};

export const RISK_COLOR = { P1: C.p1, P2: C.p2, P3: C.p3 };

/** 카드 공통 스타일 */
export const card = (extra = {}) => ({
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: "12px",
  padding: "18px 20px",
  ...extra,
});

/** 섹션 라벨 (대문자, 자간 넓게) */
export const label = (extra = {}) => ({
  fontFamily: BODY_FONT,
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: C.textFaint,
  margin: 0,
  ...extra,
});

// =============================================================
// API
//
// 모든 호출은 Vercel 프록시를 거칩니다.
// 브라우저는 API 키나 HMAC 시크릿을 알지 못합니다.
// =============================================================

async function req(path, options) {
  const res = await fetch(path, options);
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: `Unexpected response (HTTP ${res.status})` };
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  status: () => req("/api/tw-status"),

  listCases: ({ riskLevel, limit = 20 } = {}) => {
    const p = new URLSearchParams();
    if (riskLevel) p.set("risk_level", riskLevel);
    p.set("limit", String(limit));
    return req(`/api/tw-cases?${p}`);
  },

  getCase: (alertId) =>
    req(`/api/tw-cases?id=${encodeURIComponent(alertId)}`),

  sendAlert: (payload) =>
    req("/api/tw-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};

// =============================================================
// 프리셋
//
// 폼을 빠르게 채우기 위한 샘플입니다.
// 실제 LLM이 판정하므로 결과는 매번 조금씩 다를 수 있습니다.
// =============================================================

export const PRESETS = [
  {
    key: "ransomware",
    name: "Ransomware",
    expect: "P1",
    payload: {
      incident_type: "ransomware",
      severity: "critical",
      asset_criticality: "high",
      pii_flag: true,
      user_role: "Privileged",
      indicators: [
        "file_encryption_burst",
        "shadow_copy_deletion",
        "backup_service_stopped",
      ],
      description:
        "Mass file encryption detected on a finance file server with backup tampering.",
    },
  },
  {
    key: "exfiltration",
    name: "Data exfiltration",
    expect: "P1",
    payload: {
      incident_type: "data_exfiltration",
      severity: "critical",
      asset_criticality: "high",
      pii_flag: true,
      user_role: "Privileged",
      indicators: [
        "large_outbound_transfer",
        "after_hours_access",
        "new_external_destination",
      ],
      description:
        "Large outbound transfer to an unrecognized host outside business hours.",
    },
  },
  {
    key: "phishing",
    name: "Phishing click",
    expect: "P2",
    payload: {
      incident_type: "phishing_click",
      severity: "medium",
      asset_criticality: "medium",
      pii_flag: true,
      user_role: "Standard",
      indicators: ["credential_page_visited", "email_reported_late"],
      description:
        "User submitted credentials to a phishing page before reporting it.",
    },
  },
  {
    key: "policy",
    name: "Policy violation",
    expect: "P3",
    payload: {
      incident_type: "policy_violation",
      severity: "low",
      asset_criticality: "low",
      pii_flag: false,
      user_role: "Standard",
      indicators: ["unapproved_software_install"],
      description:
        "User installed an unapproved but benign productivity tool.",
    },
  },
];

/** 파이프라인 단계 정의 */
export const STAGES = [
  { key: "signed", label: "Signed request", detail: "HMAC + API key" },
  { key: "validated", label: "Schema validated", detail: "API Gateway" },
  { key: "queued", label: "Queued", detail: "SQS" },
  { key: "triaged", label: "LLM triage", detail: "Lambda" },
  { key: "stored", label: "Case stored", detail: "DynamoDB + S3" },
  { key: "routed", label: "Routed", detail: "SNS / Step Functions" },
];

export function newAlertId() {
  const stamp = Date.now().toString(36).toUpperCase();
  return `A-WS-${stamp}`;
}
