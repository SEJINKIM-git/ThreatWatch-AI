import { useState, useEffect, useRef } from "react";

const SCENARIOS = [
  {
    id: "P1_Critical",
    label: "P1 Critical",
    tag: "HIGH RISK",
    tagColor: "#ff1744",
    data: {
      severity: "Critical",
      asset_criticality: "High",
      pii_flag: true,
      user_role: "Privileged",
      incident_type: "credential_stuffing_admin_compromise",
      indicators: [
        "multiple_failed_logins_spike",
        "successful_login_after_failures",
        "impossible_travel",
        "privileged_account_used",
        "pii_database_access",
        "potential_data_exfiltration",
      ],
    },
  },
  {
    id: "P2_Medium",
    label: "P2 Medium",
    tag: "MEDIUM",
    tagColor: "#ff9100",
    data: {
      severity: "Medium",
      asset_criticality: "Medium",
      pii_flag: false,
      user_role: "Standard",
      incident_type: "unauthorized_access_attempt",
      indicators: [
        "multiple_failed_logins_spike",
        "internal_ip_source",
        "legacy_system_target",
      ],
    },
  },
  {
    id: "P3_Low",
    label: "P3 Low",
    tag: "LOW",
    tagColor: "#00e676",
    data: {
      severity: "Low",
      asset_criticality: "Low",
      pii_flag: false,
      user_role: "Standard",
      incident_type: "port_scan",
      indicators: ["horizontal_port_sweep", "external_source_ip"],
    },
  },
  {
    id: "Retry_Loop",
    label: "PreCheck Retry",
    tag: "RETRY",
    tagColor: "#ffea00",
    data: {
      severity: "High",
      asset_criticality: "",
      pii_flag: null,
      user_role: "",
      incident_type: "suspicious_activity",
      indicators: ["anomalous_traffic_pattern"],
    },
  },
  {
    id: "Escalation",
    label: "Escalation Mail",
    tag: "ESCALATE",
    tagColor: "#d500f9",
    data: {
      severity: "low",
      asset_criticality: "low",
      pii_flag: false,
      user_role: "Standard",
      incident_type: "data_quality_issue",
      indicators: ["insufficient_data"],
      retry_count: 3,
    },
  },
  {
    id: "Low_Confidence",
    label: "Low Confidence",
    tag: "LOOP",
    tagColor: "#00b0ff",
    data: {
      severity: "medium",
      asset_criticality: "medium",
      pii_flag: false,
      user_role: "Privileged",
      incident_type: "ambiguous_alert",
      indicators: ["single_failed_login", "known_vpn_ip"],
    },
  },
];

const PIPELINE_NODES = [
  { id: "trigger", label: "01 Trigger", short: "START" },
  { id: "build", label: "02 Build Data", short: "BUILD" },
  { id: "precheck", label: "03-04 PreCheck", short: "CHECK" },
  { id: "llm", label: "05 LLM Analysis", short: "LLM" },
  { id: "parse", label: "06 Parse Output", short: "PARSE" },
  { id: "confidence", label: "07 Confidence?", short: "CONF" },
  { id: "normalize", label: "08 Normalize", short: "NORM" },
  { id: "decision", label: "10 Risk Decision", short: "ROUTE" },
  { id: "action", label: "11 Action", short: "ACT" },
];

const uid = () => Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 7);
const randomIP = () =>
  `${Math.floor(Math.random() * 200) + 10}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

function PipelineVisualizer({ activeNode, status }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "2px", overflowX: "auto", padding: "16px 0" }}>
      {PIPELINE_NODES.map((node, i) => {
        const nodeIndex = PIPELINE_NODES.findIndex((n) => n.id === activeNode);
        let state = "idle";
        if (status === "done") state = "done";
        else if (status === "error") state = i <= nodeIndex ? "error" : "idle";
        else if (i < nodeIndex) state = "done";
        else if (i === nodeIndex) state = "active";

        const colors = {
          idle: { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", text: "rgba(255,255,255,0.25)" },
          active: { bg: "rgba(0,229,255,0.12)", border: "rgba(0,229,255,0.5)", text: "#00e5ff" },
          done: { bg: "rgba(118,255,3,0.08)", border: "rgba(118,255,3,0.3)", text: "#76ff03" },
          error: { bg: "rgba(255,23,68,0.08)", border: "rgba(255,23,68,0.3)", text: "#ff1744" },
        };
        const c = colors[state];

        return (
          <div key={node.id} style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                background: c.bg,
                border: `1.5px solid ${c.border}`,
                borderRadius: "8px",
                padding: "8px 10px",
                minWidth: "70px",
                textAlign: "center",
                transition: "all 0.4s ease",
                position: "relative",
              }}
            >
              {state === "active" && (
                <div
                  style={{
                    position: "absolute",
                    inset: "-2px",
                    borderRadius: "9px",
                    border: "2px solid rgba(0,229,255,0.3)",
                    animation: "pulse-border 1.5s ease-in-out infinite",
                  }}
                />
              )}
              <div style={{ fontSize: "9px", fontWeight: 700, color: c.text, letterSpacing: "0.5px", marginBottom: "2px" }}>
                {node.short}
              </div>
              <div style={{ fontSize: "8px", color: "rgba(255,255,255,0.3)" }}>{node.label.split(" ").slice(1).join(" ")}</div>
            </div>
            {i < PIPELINE_NODES.length - 1 && (
              <div
                style={{
                  width: "16px",
                  height: "2px",
                  background:
                    state === "done" || (status === "done" && i < PIPELINE_NODES.length - 1)
                      ? "rgba(118,255,3,0.4)"
                      : "rgba(255,255,255,0.08)",
                  transition: "all 0.4s",
                }}
              />
            )}
          </div>
        );
      })}
      <style>{`
        @keyframes pulse-border {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.03); }
        }
      `}</style>
    </div>
  );
}

function ResultCard({ result }) {
  if (!result) return null;

  const fp = result.final_payload || result;
  const riskColors = {
    P1: { bg: "rgba(255,23,68,0.08)", border: "#ff1744", text: "#ff1744" },
    P2: { bg: "rgba(255,145,0,0.08)", border: "#ff9100", text: "#ff9100" },
    P3: { bg: "rgba(0,230,118,0.08)", border: "#00e676", text: "#00e676" },
  };
  const rc = riskColors[fp.risk_level] || riskColors.P2;

  const fields = [
    { label: "Alert ID", value: fp.alert_id },
    { label: "Timestamp", value: fp.timestamp },
    { label: "Incident Type", value: fp.incident_type },
    { label: "Risk Score", value: fp.risk_score ? `${fp.risk_score}/100` : "N/A" },
    { label: "Confidence", value: fp.confidence ? `${Math.round(fp.confidence * 100)}%` : "N/A" },
    { label: "PII Flag", value: fp.pii_flag ? "TRUE" : "FALSE" },
  ];

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${rc.border}30`,
        borderRadius: "14px",
        padding: "24px",
        marginTop: "20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              background: rc.bg,
              border: `2px solid ${rc.border}`,
              borderRadius: "10px",
              padding: "8px 18px",
              fontSize: "20px",
              fontWeight: 800,
              color: rc.text,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {fp.risk_level || "?"}
          </div>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "#fff" }}>Risk Assessment Complete</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "2px" }}>
              {fp.risk_level === "P1" ? "Email sent + Sheet logged" : "Sheet logged"}
            </div>
          </div>
        </div>
        {fp.risk_level_raw && (
          <span
            style={{
              fontSize: "10px",
              color: "rgba(255,255,255,0.4)",
              background: "rgba(255,255,255,0.05)",
              padding: "4px 10px",
              borderRadius: "4px",
            }}
          >
            RAW: {fp.risk_level_raw}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "20px" }}>
        {fields.map((f) => (
          <div
            key={f.label}
            style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: "8px",
              padding: "12px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div style={{ fontSize: "9px", fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "4px" }}>
              {f.label}
            </div>
            <div
              style={{
                fontSize: "12.5px",
                color: f.label === "PII Flag" && fp.pii_flag ? "#ff1744" : "rgba(255,255,255,0.85)",
                fontWeight: 500,
                wordBreak: "break-all",
              }}
            >
              {f.value || "—"}
            </div>
          </div>
        ))}
      </div>

      {fp.summary && (
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            borderRadius: "8px",
            padding: "16px",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div style={{ fontSize: "10px", fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", marginBottom: "8px" }}>
            LLM SUMMARY
          </div>
          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: 1.7 }}>
            {typeof fp.summary === "string" ? fp.summary : JSON.stringify(fp.summary)}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ history }) {
  if (history.length === 0) return null;

  return (
    <div style={{ marginTop: "28px" }}>
      <h3
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: "rgba(255,255,255,0.4)",
          fontFamily: "'Space Grotesk', sans-serif",
          marginBottom: "12px",
          letterSpacing: "0.3px",
        }}
      >
        실행 이력 ({history.length})
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {history.map((h, i) => {
          const fp = h.result?.final_payload || h.result || {};
          const riskColors = { P1: "#ff1744", P2: "#ff9100", P3: "#00e676" };
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: "8px",
                padding: "10px 14px",
                fontSize: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    color: riskColors[fp.risk_level] || "#888",
                    background: `${riskColors[fp.risk_level] || "#888"}18`,
                    padding: "2px 8px",
                    borderRadius: "4px",
                    minWidth: "28px",
                    textAlign: "center",
                  }}
                >
                  {fp.risk_level || h.status}
                </span>
                <span style={{ color: "rgba(255,255,255,0.6)" }}>{h.scenario}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "11px" }}>{fp.alert_id || "—"}</span>
                <span style={{ color: "rgba(255,255,255,0.25)", fontSize: "10px" }}>
                  {h.duration ? `${(h.duration / 1000).toFixed(1)}s` : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ThreatWatchDashboard() {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showConfig, setShowConfig] = useState(true);
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [status, setStatus] = useState("idle");
  const [activeNode, setActiveNode] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const startRef = useRef(null);

  useEffect(() => {
    return () => clearInterval(timerRef.current);
  }, []);

  const simulatePipeline = (nodeSequence, delayMs = 600) => {
    return new Promise((resolve) => {
      nodeSequence.forEach((nodeId, i) => {
        setTimeout(() => {
          setActiveNode(nodeId);
          if (i === nodeSequence.length - 1) resolve();
        }, delayMs * i);
      });
    });
  };

  const triggerWorkflow = async (scenarioObj) => {
    if (!webhookUrl) {
      setError("Webhook URL을 입력해주세요");
      return;
    }

    setStatus("running");
    setResult(null);
    setError(null);
    setElapsed(0);
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 100);

    const scenario = scenarioObj || SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    setSelectedScenario(scenario);

    const alertData = {
      alert_id: `${scenario.id.split("_")[0]}-${uid()}`,
      timestamp: new Date().toISOString(),
      source_ip: randomIP(),
      attempts_count: Math.floor(Math.random() * 50000) + 1,
      scenario_label: scenario.id,
      run_id: uid(),
      ...scenario.data,
    };

    try {
      await simulatePipeline(["trigger", "build", "precheck"], 500);

      setActiveNode("llm");

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alertData),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const data = await res.json();

      await simulatePipeline(["parse", "confidence", "normalize", "decision", "action"], 400);

      clearInterval(timerRef.current);
      const duration = Date.now() - startRef.current;
      setElapsed(duration);
      setResult(data);
      setStatus("done");
      setHistory((prev) => [{ scenario: scenario.label, result: data, status: "done", duration, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 20));
    } catch (err) {
      clearInterval(timerRef.current);
      setElapsed(Date.now() - startRef.current);
      setError(err.message);
      setStatus("error");
      setHistory((prev) => [{ scenario: scenario?.label || "Random", status: "error", error: err.message, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 20));
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#060a12",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#e2e8f0",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />

      {/* Scanline effect */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,255,0.008) 2px, rgba(0,229,255,0.008) 4px)`,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(0,229,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,229,255,0.02) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div style={{ position: "relative", zIndex: 1, maxWidth: "960px", margin: "0 auto", padding: "28px 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, #00e5ff, #76ff03)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px",
                fontWeight: 800,
                color: "#060a12",
                fontFamily: "'Space Grotesk', sans-serif",
              }}
            >
              T
            </div>
            <div>
              <h1
                style={{
                  fontSize: "22px",
                  fontWeight: 800,
                  fontFamily: "'Space Grotesk', sans-serif",
                  margin: 0,
                  background: "linear-gradient(135deg, #00e5ff, #76ff03)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                ThreatWatch AI
              </h1>
              <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", margin: 0, letterSpacing: "1px" }}>
                LLM-POWERED SECURITY TRIAGE DASHBOARD
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {status === "running" && (
              <span style={{ fontSize: "12px", color: "#00e5ff", fontVariantNumeric: "tabular-nums" }}>
                {(elapsed / 1000).toFixed(1)}s
              </span>
            )}
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: status === "idle" ? "#555" : status === "running" ? "#00e5ff" : status === "done" ? "#76ff03" : "#ff1744",
                boxShadow: status === "running" ? "0 0 8px #00e5ff" : "none",
                transition: "all 0.3s",
              }}
            />
          </div>
        </div>

        {/* Webhook Config */}
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "12px",
            marginTop: "20px",
            marginBottom: "20px",
            overflow: "hidden",
          }}
        >
          <button
            onClick={() => setShowConfig(!showConfig)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "rgba(255,255,255,0.5)",
              fontSize: "12px",
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600,
            }}
          >
            <span>n8n Webhook 설정</span>
            <span style={{ transform: showConfig ? "rotate(180deg)" : "none", transition: "0.2s" }}>▾</span>
          </button>
          {showConfig && (
            <div style={{ padding: "0 18px 16px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://your-n8n.app.n8n.cloud/webhook/threatwatch"
                  style={{
                    flex: 1,
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    color: "#fff",
                    fontSize: "12px",
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => {
                    if (webhookUrl) {
                      setShowConfig(false);
                    }
                  }}
                  style={{
                    background: webhookUrl ? "rgba(118,255,3,0.15)" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${webhookUrl ? "rgba(118,255,3,0.3)" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: "8px",
                    padding: "10px 18px",
                    color: webhookUrl ? "#76ff03" : "rgba(255,255,255,0.3)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "'Space Grotesk', sans-serif",
                    whiteSpace: "nowrap",
                  }}
                >
                  연결
                </button>
              </div>
              <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", marginTop: "8px", lineHeight: 1.6 }}>
                n8n에서 01번 노드를 Webhook으로 변경하고, 마지막에 "Respond to Webhook" 노드를 추가하세요.
                <br />
                Webhook URL은 n8n 워크플로우 편집기 → Webhook 노드 → Test URL 또는 Production URL에서 확인할 수 있습니다.
              </p>
            </div>
          )}
        </div>

        {/* Pipeline Visualizer */}
        <PipelineVisualizer activeNode={activeNode} status={status} />

        {/* Scenario Selector */}
        <div style={{ marginTop: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", fontFamily: "'Space Grotesk', sans-serif" }}>
              시나리오 선택
            </span>
            <button
              onClick={() => triggerWorkflow(null)}
              disabled={status === "running"}
              style={{
                background: status === "running" ? "rgba(255,255,255,0.03)" : "linear-gradient(135deg, rgba(0,229,255,0.15), rgba(118,255,3,0.15))",
                border: `1px solid ${status === "running" ? "rgba(255,255,255,0.05)" : "rgba(0,229,255,0.3)"}`,
                borderRadius: "8px",
                padding: "8px 18px",
                color: status === "running" ? "rgba(255,255,255,0.3)" : "#00e5ff",
                fontSize: "12px",
                fontWeight: 700,
                cursor: status === "running" ? "not-allowed" : "pointer",
                fontFamily: "'Space Grotesk', sans-serif",
                letterSpacing: "0.3px",
              }}
            >
              {status === "running" ? "분석 중..." : "🎲 랜덤 실행"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => triggerWorkflow(s)}
                disabled={status === "running"}
                style={{
                  background:
                    selectedScenario?.id === s.id && status !== "idle"
                      ? `${s.tagColor}10`
                      : "rgba(255,255,255,0.02)",
                  border: `1px solid ${
                    selectedScenario?.id === s.id && status !== "idle" ? `${s.tagColor}40` : "rgba(255,255,255,0.06)"
                  }`,
                  borderRadius: "10px",
                  padding: "14px 12px",
                  cursor: status === "running" ? "not-allowed" : "pointer",
                  textAlign: "left",
                  transition: "all 0.2s",
                  opacity: status === "running" ? 0.5 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                  <span
                    style={{
                      fontSize: "8px",
                      fontWeight: 700,
                      color: s.tagColor,
                      background: `${s.tagColor}18`,
                      padding: "2px 6px",
                      borderRadius: "3px",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {s.tag}
                  </span>
                </div>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.8)", fontFamily: "'Space Grotesk', sans-serif" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)", marginTop: "4px" }}>{s.data.incident_type}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div
            style={{
              marginTop: "16px",
              background: "rgba(255,23,68,0.06)",
              border: "1px solid rgba(255,23,68,0.2)",
              borderRadius: "10px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#ff1744", marginBottom: "6px" }}>ERROR</div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>{error}</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "8px" }}>
              Webhook URL을 확인하고, n8n 워크플로우가 활성화되어 있는지 체크하세요.
              <br />
              CORS 문제가 있을 경우 n8n Webhook 노드에서 "Respond" 모드를 확인하세요.
            </div>
          </div>
        )}

        {/* Result Card */}
        <ResultCard result={result} />

        {/* Raw JSON Toggle */}
        {result && (
          <details style={{ marginTop: "12px" }}>
            <summary
              style={{
                fontSize: "11px",
                color: "rgba(255,255,255,0.3)",
                cursor: "pointer",
                padding: "8px 0",
                fontFamily: "'Space Grotesk', sans-serif",
              }}
            >
              Raw JSON 응답 보기
            </summary>
            <pre
              style={{
                background: "#0d1117",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "8px",
                padding: "16px",
                fontSize: "11px",
                color: "#8b949e",
                overflowX: "auto",
                maxHeight: "300px",
                lineHeight: 1.6,
              }}
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        )}

        {/* History */}
        <HistoryPanel history={history} />

        {/* Footer */}
        <div
          style={{
            marginTop: "36px",
            paddingTop: "16px",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)" }}>ThreatWatch AI — Sejin Kim / Chaehoon Lee</span>
          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.15)" }}>IS 3060-301 Spring</span>
        </div>
      </div>
    </div>
  );
}
