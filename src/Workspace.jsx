import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api, card, label, newAlertId,
  BODY_FONT, MONO_FONT, C, RISK_COLOR, PRESETS, STAGES,
} from "./workspaceLib.js";
import {
  RiskDonut, TypeBars, StageTracker, RiskBadge, StatCard,
} from "./WorkspaceCharts.jsx";

// 케이스가 저장될 때까지 폴링합니다.
// LLM 호출이 수 초 걸리므로 넉넉하게 잡되, 무한 대기는 막습니다.
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 90000;

const TYPE_PALETTE = [C.accent, C.teal, "#9d7cff", "#f5b13d", "#ff8a65", "#4dd0e1"];

export default function Workspace() {
  const [liveMode, setLiveMode] = useState(null); // null=확인중
  const [cases, setCases] = useState([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [listError, setListError] = useState(null);

  const [preset, setPreset] = useState(PRESETS[0].key);
  const [sending, setSending] = useState(false);
  const [stageState, setStageState] = useState({});
  const [runLog, setRunLog] = useState([]);
  const [activeCase, setActiveCase] = useState(null);
  const [filter, setFilter] = useState(null);

  const pollRef = useRef(null);

  // --- 초기화 ---

  useEffect(() => {
    api.status()
      .then((s) => setLiveMode(Boolean(s.live_mode)))
      .catch(() => setLiveMode(false));
  }, []);

  const loadCases = useCallback(async (riskLevel) => {
    setLoadingCases(true);
    setListError(null);
    try {
      const data = await api.listCases({ riskLevel, limit: 30 });
      setCases(data.cases || []);
    } catch (e) {
      setListError(e.message);
      setCases([]);
    } finally {
      setLoadingCases(false);
    }
  }, []);

  useEffect(() => {
    if (liveMode) loadCases(filter);
  }, [liveMode, filter, loadCases]);

  // 컴포넌트가 사라질 때 폴링을 멈춥니다.
  useEffect(() => () => clearInterval(pollRef.current), []);

  // --- 집계 ---

  const stats = useMemo(() => {
    const counts = { P1: 0, P2: 0, P3: 0 };
    const byType = {};
    let scoreSum = 0;
    let pendingApproval = 0;

    for (const c of cases) {
      if (counts[c.risk_level] != null) counts[c.risk_level] += 1;
      byType[c.incident_type] = (byType[c.incident_type] || 0) + 1;
      scoreSum += Number(c.risk_score) || 0;
      // approval_status가 없는 P1은 아직 승인 워크플로가 끝나지 않은 케이스입니다.
      if (c.risk_level === "P1" && !c.approval_status) pendingApproval += 1;
    }

    const typeItems = Object.entries(byType)
      .map(([type, count], i) => ({
        type, count, color: TYPE_PALETTE[i % TYPE_PALETTE.length],
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    return {
      counts,
      typeItems,
      total: cases.length,
      avgScore: cases.length ? Math.round(scoreSum / cases.length) : 0,
      pendingApproval,
    };
  }, [cases]);

  // --- 실행 ---

  const log = (text) =>
    setRunLog((prev) => [
      ...prev,
      { at: new Date().toLocaleTimeString(), text },
    ]);

  async function run() {
    const chosen = PRESETS.find((p) => p.key === preset);
    if (!chosen || sending) return;

    const alertId = newAlertId();
    const payload = { alert_id: alertId, ...chosen.payload };

    setSending(true);
    setActiveCase(null);
    setRunLog([]);
    setStageState({ signed: "active" });
    log(`Submitting ${alertId}`);

    try {
      await api.sendAlert(payload);

      // 202를 받았다는 것은 서명 검증과 스키마 검증을 통과하고
      // 큐에 적재됐다는 뜻입니다.
      setStageState({
        signed: "done", validated: "done", queued: "done", triaged: "active",
      });
      log("Accepted — signature and schema validated, queued");

      const started = Date.now();

      pollRef.current = setInterval(async () => {
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          clearInterval(pollRef.current);
          setStageState((s) => ({ ...s, triaged: "error" }));
          log("Timed out waiting for the case to appear");
          setSending(false);
          return;
        }

        try {
          const data = await api.getCase(alertId);
          const found = data.case;
          if (!found) return;

          clearInterval(pollRef.current);

          setStageState({
            signed: "done", validated: "done", queued: "done",
            triaged: "done", stored: "done", routed: "done",
          });
          setActiveCase(found);
          log(`Triaged as ${found.risk_level} (${found.risk_score}/100)`);

          if (found.risk_level === "P1") {
            log("P1 — approval workflow started, awaiting analyst decision");
          }

          setSending(false);
          loadCases(filter);
        } catch {
          // 404는 아직 처리 중이라는 뜻이므로 계속 폴링합니다.
        }
      }, POLL_INTERVAL_MS);
    } catch (e) {
      setStageState((s) => ({
        ...s,
        signed: "error",
        validated: e.message.includes("schema") ? "error" : "idle",
      }));
      log(`Failed: ${e.message}`);
      setSending(false);
    }
  }

  // --- 렌더 ---

  if (liveMode === null) {
    return <Centered>Checking pipeline availability…</Centered>;
  }

  if (!liveMode) {
    return (
      <Centered>
        <p style={{ ...label(), marginBottom: "10px" }}>Live mode unavailable</p>
        <p style={{ fontFamily: BODY_FONT, color: C.textDim, fontSize: "14px", maxWidth: "420px", lineHeight: 1.7 }}>
          This deployment is not configured to reach the AWS pipeline.
          The scenario walkthrough on the main site remains available.
        </p>
        <a href="/" style={linkBtn}>Back to overview</a>
      </Centered>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <Header />

      <main style={{ maxWidth: "1440px", margin: "0 auto", padding: "26px 28px 60px" }}>
        {/* KPI */}
        <section style={{
          display: "grid", gap: "14px", marginBottom: "18px",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        }}>
          <StatCard title="Total cases" value={stats.total}
                    sub={filter ? `filtered by ${filter}` : "most recent 30"} />
          <StatCard title="Critical" value={stats.counts.P1}
                    sub="P1 escalations" accent={C.p1} />
          <StatCard title="Avg risk score" value={stats.avgScore} sub="out of 100" />
          <StatCard title="Awaiting approval" value={stats.pendingApproval}
                    sub="human decision pending"
                    accent={stats.pendingApproval ? C.p2 : null} />
        </section>

        {/* 실행 + 분포 */}
        <section style={{
          display: "grid", gap: "16px", marginBottom: "18px",
          gridTemplateColumns: "minmax(300px, 1.1fr) minmax(280px, 1fr) minmax(240px, 0.9fr)",
        }}>
          <RunPanel
            preset={preset} setPreset={setPreset}
            sending={sending} onRun={run}
            stageState={stageState} runLog={runLog} activeCase={activeCase}
          />

          <div style={card()}>
            <p style={{ ...label(), marginBottom: "18px" }}>Risk distribution</p>
            {stats.total > 0
              ? <RiskDonut counts={stats.counts} total={stats.total} />
              : <Empty>No cases yet</Empty>}
          </div>

          <div style={card()}>
            <p style={{ ...label(), marginBottom: "18px" }}>Incident types</p>
            <TypeBars items={stats.typeItems} />
          </div>
        </section>

        {/* 케이스 큐 */}
        <section style={card({ padding: 0, overflow: "hidden" })}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 20px", borderBottom: `1px solid ${C.border}`,
            flexWrap: "wrap", gap: "12px",
          }}>
            <p style={label()}>Case queue</p>
            <div style={{ display: "flex", gap: "6px" }}>
              {[null, "P1", "P2", "P3"].map((lvl) => (
                <button key={lvl ?? "all"} onClick={() => setFilter(lvl)}
                        style={chip(filter === lvl, lvl ? RISK_COLOR[lvl] : C.accent)}>
                  {lvl ?? "All"}
                </button>
              ))}
            </div>
          </div>

          {listError && <Empty>{listError}</Empty>}
          {loadingCases && !listError && <Empty>Loading…</Empty>}
          {!loadingCases && !listError && !cases.length && <Empty>No cases match this filter</Empty>}

          {!loadingCases && cases.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "820px" }}>
                <thead>
                  <tr>
                    {["Alert ID", "Risk", "Type", "Confidence", "Summary", "Approval"].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.alert_id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ ...td, fontFamily: MONO_FONT, color: C.accent }}>{c.alert_id}</td>
                      <td style={td}><RiskBadge level={c.risk_level} score={c.risk_score} /></td>
                      <td style={{ ...td, color: C.textDim }}>{String(c.incident_type).replace(/_/g, " ")}</td>
                      <td style={{ ...td, fontFamily: MONO_FONT, color: confColor(c.confidence) }}>
                        {c.confidence != null ? Number(c.confidence).toFixed(2) : "—"}
                      </td>
                      <td style={{ ...td, color: C.textDim, maxWidth: "380px" }}>
                        <span style={{
                          display: "block", overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {c.summary || "—"}
                        </span>
                      </td>
                      <td style={td}>
                        <ApprovalTag status={c.approval_status} level={c.risk_level} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Footnote />
      </main>
    </div>
  );
}

// =============================================================
// 하위 컴포넌트
// =============================================================

function Header() {
  return (
    <header style={{
      borderBottom: `1px solid ${C.border}`,
      background: "rgba(6,10,18,0.9)",
      backdropFilter: "blur(8px)",
      position: "sticky", top: 0, zIndex: 10,
    }}>
      <div style={{
        maxWidth: "1440px", margin: "0 auto", padding: "14px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "16px", flexWrap: "wrap",
      }}>
        <div>
          <p style={{
            margin: 0, fontFamily: BODY_FONT, fontSize: "16px",
            fontWeight: 700, letterSpacing: "-0.01em",
          }}>
            ThreatWatch AI · Product Workspace
          </p>
          <p style={{ margin: "3px 0 0", fontFamily: MONO_FONT, fontSize: "11px", color: C.textFaint }}>
            Live pipeline · ap-northeast-2
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "7px",
            padding: "5px 11px", borderRadius: "999px",
            border: `1px solid ${C.teal}44`, background: `${C.teal}12`,
            fontFamily: MONO_FONT, fontSize: "11px", color: C.teal,
          }}>
            <span style={{
              width: "6px", height: "6px", borderRadius: "50%", background: C.teal,
            }} />
            LIVE
          </span>
          <a href="/" style={linkBtn}>Overview</a>
        </div>
      </div>
    </header>
  );
}

function RunPanel({ preset, setPreset, sending, onRun, stageState, runLog, activeCase }) {
  const chosen = PRESETS.find((p) => p.key === preset);

  return (
    <div style={card({ display: "grid", gap: "18px", alignContent: "start" })}>
      <div>
        <p style={{ ...label(), marginBottom: "12px" }}>Submit an alert</p>
        <div style={{ display: "grid", gap: "7px" }}>
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => setPreset(p.key)} disabled={sending}
                    style={presetBtn(preset === p.key, sending)}>
              <span style={{ fontFamily: BODY_FONT, fontSize: "13px", fontWeight: 500 }}>
                {p.name}
              </span>
              <span style={{
                fontFamily: MONO_FONT, fontSize: "10px",
                color: RISK_COLOR[p.expect], opacity: 0.85,
              }}>
                ~{p.expect}
              </span>
            </button>
          ))}
        </div>
      </div>

      {chosen && (
        <p style={{
          margin: 0, fontFamily: BODY_FONT, fontSize: "12px",
          color: C.textFaint, lineHeight: 1.65,
        }}>
          {chosen.payload.description}
        </p>
      )}

      <button onClick={onRun} disabled={sending} style={runBtn(sending)}>
        {sending ? "Running…" : "Run through pipeline"}
      </button>

      <div>
        <p style={{ ...label(), marginBottom: "14px" }}>Pipeline</p>
        <StageTracker stages={STAGES} state={stageState} />
      </div>

      {activeCase && (
        <div style={{
          borderTop: `1px solid ${C.border}`, paddingTop: "14px",
          display: "grid", gap: "8px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <RiskBadge level={activeCase.risk_level} score={activeCase.risk_score} />
            <span style={{ fontFamily: MONO_FONT, fontSize: "11px", color: C.textFaint }}>
              {activeCase.alert_id}
            </span>
          </div>
          <p style={{
            margin: 0, fontFamily: BODY_FONT, fontSize: "12px",
            color: C.textDim, lineHeight: 1.7,
          }}>
            {activeCase.summary}
          </p>
        </div>
      )}

      {runLog.length > 0 && (
        <div style={{
          borderTop: `1px solid ${C.border}`, paddingTop: "14px",
          display: "grid", gap: "5px", maxHeight: "150px", overflowY: "auto",
        }}>
          {runLog.map((entry, i) => (
            <div key={i} style={{
              fontFamily: MONO_FONT, fontSize: "11px",
              color: C.textFaint, display: "flex", gap: "9px",
            }}>
              <span style={{ opacity: 0.55, flexShrink: 0 }}>{entry.at}</span>
              <span style={{ color: C.textDim }}>{entry.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalTag({ status, level }) {
  if (level !== "P1") {
    return <span style={{ fontFamily: MONO_FONT, fontSize: "11px", color: C.textFaint }}>—</span>;
  }

  const map = {
    approve: { text: "approved", color: C.teal },
    reject: { text: "false positive", color: C.textDim },
    expired: { text: "no response", color: C.p1 },
  };
  const it = map[status] || { text: "pending", color: C.p2 };

  return (
    <span style={{ fontFamily: MONO_FONT, fontSize: "11px", color: it.color }}>
      {it.text}
    </span>
  );
}

function Centered({ children }) {
  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: "14px", padding: "40px", textAlign: "center",
      fontFamily: BODY_FONT,
    }}>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <p style={{
      margin: 0, padding: "26px 20px", textAlign: "center",
      fontFamily: BODY_FONT, fontSize: "13px", color: C.textFaint,
    }}>
      {children}
    </p>
  );
}

function Footnote() {
  return (
    <p style={{
      margin: "22px 0 0", fontFamily: BODY_FONT, fontSize: "11px",
      color: C.textFaint, lineHeight: 1.8,
    }}>
      Every submission is signed server-side and sent to a live AWS pipeline:
      API Gateway validates the schema, SQS buffers the alert, and a Lambda calls
      the LLM before writing to DynamoDB and S3. P1 cases pause for human approval
      via Step Functions.
    </p>
  );
}

// =============================================================
// 스타일 헬퍼
// =============================================================

const th = {
  padding: "11px 20px", textAlign: "left",
  fontFamily: BODY_FONT, fontSize: "10px", fontWeight: 600,
  letterSpacing: "0.13em", textTransform: "uppercase",
  color: C.textFaint, whiteSpace: "nowrap",
};

const td = {
  padding: "13px 20px", fontFamily: BODY_FONT,
  fontSize: "13px", verticalAlign: "middle",
};

const linkBtn = {
  fontFamily: BODY_FONT, fontSize: "12px", fontWeight: 500,
  color: C.textDim, textDecoration: "none",
  padding: "6px 13px", borderRadius: "7px",
  border: `1px solid ${C.border}`,
};

function chip(active, color) {
  return {
    padding: "5px 12px", borderRadius: "7px", cursor: "pointer",
    fontFamily: MONO_FONT, fontSize: "11px", fontWeight: 600,
    color: active ? color : C.textFaint,
    background: active ? `${color}14` : "transparent",
    border: `1px solid ${active ? `${color}55` : C.border}`,
  };
}

function presetBtn(active, disabled) {
  return {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: "10px", padding: "10px 13px", borderRadius: "8px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled && !active ? 0.5 : 1,
    textAlign: "left", width: "100%",
    color: active ? C.text : C.textDim,
    background: active ? C.accentDim : "transparent",
    border: `1px solid ${active ? C.borderStrong : C.border}`,
  };
}

function runBtn(sending) {
  return {
    padding: "11px 18px", borderRadius: "8px",
    cursor: sending ? "not-allowed" : "pointer",
    fontFamily: BODY_FONT, fontSize: "13px", fontWeight: 600,
    color: sending ? C.textFaint : "#04121f",
    background: sending ? "rgba(96,132,190,0.16)" : C.accent,
    border: "none", width: "100%",
  };
}

function confColor(v) {
  if (v == null) return C.textFaint;
  // 확신도가 낮은 케이스는 사람이 다시 봐야 한다는 신호입니다.
  return Number(v) < 0.7 ? C.p2 : C.textDim;
}
