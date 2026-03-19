export const PIPELINE_NODES = [
  { id: "trigger", label: "01 Trigger", short: "START" },
  { id: "build", label: "02 Build Data", short: "BUILD" },
  { id: "precheck", label: "03-04 PreCheck", short: "CHECK" },
  { id: "llm", label: "05 LLM Analysis", short: "LLM" },
  { id: "parse", label: "06 Parse Output", short: "PARSE" },
  { id: "confidence", label: "07 Confidence", short: "CONF" },
  { id: "normalize", label: "08 Normalize", short: "NORM" },
  { id: "decision", label: "09 Risk Decision", short: "ROUTE" },
  { id: "action", label: "10 Action", short: "ACT" },
];

export const RISK_META = {
  P1: { bg: "rgba(255,23,68,0.08)", border: "#ff1744", text: "#ff1744", glow: "rgba(255,23,68,0.3)" },
  P2: { bg: "rgba(255,145,0,0.08)", border: "#ff9100", text: "#ff9100", glow: "rgba(255,145,0,0.25)" },
  P3: { bg: "rgba(0,230,118,0.08)", border: "#00e676", text: "#00e676", glow: "rgba(0,230,118,0.25)" },
};

const DEFAULT_PRECHECK = {
  decision: "PROCEED",
  missing_critical: [],
  missing_important: [],
  retry_count: 0,
};

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let current = seed >>> 0;
  return () => {
    current += 0x6d2b79f5;
    let t = current;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRange(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randomIp(rng) {
  return `${randomRange(rng, 11, 223)}.${randomRange(rng, 1, 254)}.${randomRange(rng, 1, 254)}.${randomRange(rng, 1, 254)}`;
}

function slugSeed(seed) {
  return String(seed).replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase() || "DEMO";
}

export function createSeed(prefix = "demo") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRng(seed) {
  return mulberry32(hashString(String(seed)));
}

export function resolveScenarioById(scenarios, scenarioId) {
  return scenarios.find((scenario) => scenario.id === scenarioId) || null;
}

export function pickWeightedScenario(scenarios, seed) {
  if (!scenarios.length) return null;

  const rng = createRng(seed);
  const totalWeight = scenarios.reduce((sum, scenario) => sum + (Number(scenario.weight) || 1), 0);
  let roll = rng() * totalWeight;

  for (const scenario of scenarios) {
    roll -= Number(scenario.weight) || 1;
    if (roll <= 0) {
      return scenario;
    }
  }

  return scenarios[scenarios.length - 1];
}

export function buildAlertData(scenario, seed) {
  const rng = createRng(`${seed}:${scenario.id}`);
  const timestamp = new Date().toISOString();
  const riskLevel = scenario.risk_level || scenario.expected_output?.risk_level || "P2";
  const seedSuffix = slugSeed(seed);
  const baseInput = scenario.input || {};

  return {
    alert_id: `${riskLevel}-${seedSuffix}-${randomRange(rng, 100, 999)}`,
    timestamp,
    source_ip: randomIp(rng),
    attempts_count: randomRange(rng, 12, 50000),
    scenario_label: scenario.id,
    run_id: `${scenario.id}-${seedSuffix}`,
    retry_count: scenario.precheck?.retry_count || baseInput.retry_count || 0,
    ...baseInput,
  };
}

function normalizePrecheck(precheck) {
  const merged = { ...DEFAULT_PRECHECK, ...(precheck || {}) };
  const totalMissing = merged.missing_critical.length + merged.missing_important.length;
  return {
    has_enough_data: merged.decision === "PROCEED",
    missing_critical: merged.missing_critical,
    missing_important: merged.missing_important,
    total_missing: totalMissing,
    can_retry: merged.retry_count < 3,
    decision: merged.decision,
  };
}

export function buildDemoResult(scenario, alertData, options = {}) {
  const expected = scenario.expected_output || {};
  const precheck = normalizePrecheck(scenario.precheck);
  const riskLevel = expected.risk_level || scenario.risk_level || "P2";
  const missingDataList = expected.missing_data_list || [];
  const summaryBullets = expected.summary_bullets || [expected.summary || "Scenario processed"];

  return {
    mode: options.mode || "demo",
    source: options.source || "demo",
    scenario_id: scenario.id,
    scenario_label: scenario.label,
    seed: String(options.seed || ""),
    generated_at: new Date().toISOString(),
    expected_route: scenario.expected_route,
    presenter_note: scenario.presenter_note,
    raw_alert: alertData,
    precheck_result: precheck,
    ai_result: {
      summary_bullets: summaryBullets,
      risk_level: riskLevel,
      risk_score: expected.risk_score ?? 50,
      rationale: expected.rationale || [],
      recommended_actions: expected.recommended_actions || [],
      missing_data_list: missingDataList,
      confidence: expected.confidence ?? 0.5,
    },
    final_payload: {
      alert_id: alertData.alert_id,
      timestamp: alertData.timestamp,
      risk_level: riskLevel,
      risk_score: expected.risk_score ?? 50,
      incident_type: alertData.incident_type,
      summary: expected.summary || "Scenario processed",
      missing_data_count: expected.missing_data_count ?? missingDataList.length,
      confidence: expected.confidence ?? 0.5,
      pii_flag: Boolean(alertData.pii_flag),
    },
  };
}

export function normalizeLiveResult(data, scenario, alertData, options = {}) {
  const expected = scenario.expected_output || {};
  const rawPayload = data?.final_payload || data || {};
  const riskLevel = rawPayload.risk_level || expected.risk_level || scenario.risk_level || "P2";

  return {
    ...data,
    mode: options.mode || "live",
    source: options.source || "live",
    scenario_id: scenario.id,
    scenario_label: scenario.label,
    seed: String(options.seed || ""),
    expected_route: scenario.expected_route,
    presenter_note: scenario.presenter_note,
    raw_alert: alertData,
    final_payload: {
      alert_id: rawPayload.alert_id || alertData.alert_id,
      timestamp: rawPayload.timestamp || alertData.timestamp,
      risk_level: riskLevel,
      risk_score: rawPayload.risk_score ?? expected.risk_score ?? 50,
      incident_type: rawPayload.incident_type || alertData.incident_type,
      summary: rawPayload.summary || expected.summary || "Live workflow completed.",
      missing_data_count: rawPayload.missing_data_count ?? expected.missing_data_count ?? 0,
      confidence: rawPayload.confidence ?? expected.confidence ?? 0.5,
      pii_flag: rawPayload.pii_flag ?? Boolean(alertData.pii_flag),
    },
    ai_result: data?.ai_result || {
      summary_bullets: expected.summary_bullets || [rawPayload.summary || expected.summary || "Live workflow completed."],
      risk_level: riskLevel,
      risk_score: rawPayload.risk_score ?? expected.risk_score ?? 50,
      rationale: expected.rationale || [],
      recommended_actions: expected.recommended_actions || [],
      missing_data_list: expected.missing_data_list || [],
      confidence: rawPayload.confidence ?? expected.confidence ?? 0.5,
    },
    precheck_result: data?.precheck_result || normalizePrecheck(scenario.precheck),
  };
}

export async function runPipelineSequence(setActiveNode, sequence, delayMs = 420) {
  for (const nodeId of sequence) {
    setActiveNode(nodeId);
    await sleep(delayMs);
  }
}
