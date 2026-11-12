import { useCallback, useEffect, useRef, useState } from "react";
import { LineChart, FactorBars, SERIES, INK } from "./charts.jsx";

/**
 * 장면 3 — 모의 위기 시뮬레이션
 *
 * 1) 발표자가 모의 위기 파일(CSV/JSON)을 올린다 (또는 기본 템플릿)
 * 2) 서버(/api/depeg-sim)가 실제 엔진으로 시각별 점수를 매긴다
 * 3) 시간 순서대로 재생 — 점수가 85를 처음 넘는 순간 경보를 한 번 보낸다
 *    (시연 키가 맞을 때만 실제 전송. 키가 없으면 '보냈을 것'만 표시)
 * 4) ThreatWatch가 P1로 접수 → 승인 메일 → 메일에서 승인/반려 → 이 화면에도 결과가 뜬다
 */

const SPEEDS = [
  { ms: 300, ko: "빠르게 (1시간 = 0.3초)", en: "Fast (1h = 0.3s)" },
  { ms: 700, ko: "보통 (1시간 = 0.7초)", en: "Normal (1h = 0.7s)" },
  { ms: 1500, ko: "천천히 (1시간 = 1.5초)", en: "Slow (1h = 1.5s)" },
];

/** 간단한 CSV 파서 — 엑셀에서 CSV로 저장한 파일 정도를 받는다 (따옴표 안 쉼표 지원) */
function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("헤더와 데이터 행이 필요합니다");
  const split = (line) => {
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === "," && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };
  const head = split(lines[0]);
  if (!head.includes("t") || !head.includes("price_usd")) throw new Error("첫 줄에 t, price_usd 열이 있어야 합니다");
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function parseFile(name, text) {
  if (/\.json$/i.test(name)) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("JSON은 행 객체의 배열이어야 합니다");
    return data;
  }
  return parseCsv(text);
}

const STEP_TEXT = {
  idle: { ko: "재생 전", en: "Not started", tone: "neutral" },
  sending: { ko: "경보 전송 중…", en: "Sending alert…", tone: "info" },
  accepted: { ko: "ThreatWatch 접수 — 처리 대기", en: "Accepted by ThreatWatch", tone: "info" },
  waiting: { ko: "승인 메일 발송됨 — 메일함을 확인하세요", en: "Approval email sent — check your inbox", tone: "warn" },
  approve: { ko: "승인됨 — 대응 실행", en: "Approved — response runs", tone: "good" },
  reject: { ko: "반려됨 — 기록만 남김", en: "Rejected — recorded only", tone: "neutral" },
  expired: { ko: "만료 — 무응답도 결과로 기록", en: "Expired — silence recorded", tone: "bad" },
  dry: { ko: "미리보기 — 시연 키가 없어 발송하지 않음", en: "Preview — no demo key, nothing sent", tone: "neutral" },
  error: { ko: "전송 실패", en: "Send failed", tone: "bad" },
};

export default function SimCrisis({ L, lang, labelOf, fmtTime }) {
  const [cfg, setCfg] = useState(null);
  const [file, setFile] = useState(null);       // {name, rows}
  const [sim, setSim] = useState(null);         // 서버 채점 결과
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[1].ms);
  const [pauseOnSend, setPauseOnSend] = useState(true);
  const [key, setKey] = useState("");
  const [flow, setFlow] = useState({ step: "idle" });
  const sentRef = useRef(false);
  const pollRef = useRef(null);

  useEffect(() => {
    fetch("/api/depeg-sim").then((r) => r.json()).then(setCfg).catch(() => setCfg({ send_configured: false }));
    return () => clearInterval(pollRef.current);
  }, []);

  const load = useCallback(async (name, text) => {
    setErr(null); setBusy(true); setPlaying(false); setIdx(0);
    setFlow({ step: "idle" }); sentRef.current = false; clearInterval(pollRef.current);
    try {
      const rows = parseFile(name, text);
      const r = await fetch("/api/depeg-sim", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "score", rows }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setFile({ name, rows }); setSim(body);
    } catch (e) {
      setFile(null); setSim(null); setErr(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  async function loadTemplate() {
    const r = await fetch("/depeg/sim-template.csv");
    load("sim-template.csv", await r.text());
  }

  function onPick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => load(f.name, t));
    e.target.value = "";
  }

  // 승인 결과를 기다린다 — 사례가 저장되고(수 초), 사람이 결정할 때까지
  function poll(alertId) {
    const started = Date.now();
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (Date.now() - started > 75 * 60 * 1000) { clearInterval(pollRef.current); return; }
      try {
        const r = await fetch(`/api/tw-cases?id=${encodeURIComponent(alertId)}`);
        if (!r.ok) return;                       // 아직 저장 전
        const c = (await r.json()).case;
        if (!c) return;
        if (c.approval_status && STEP_TEXT[c.approval_status]) {
          setFlow((f) => ({ ...f, step: c.approval_status, caseInfo: c }));
          clearInterval(pollRef.current);
        } else {
          setFlow((f) => ({ ...f, step: "waiting", caseInfo: c }));
        }
      } catch { /* 다음 주기에 다시 */ }
    }, 4000);
  }

  const sendAlert = useCallback(async (i) => {
    if (sentRef.current) return;
    sentRef.current = true;
    if (!key || !cfg?.send_configured) { setFlow({ step: "dry", index: i }); return; }
    setFlow({ step: "sending", index: i });
    try {
      const r = await fetch("/api/depeg-sim", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-demo-key": key },
        body: JSON.stringify({ action: "alert", rows: file.rows, index: i, label: file.name }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setFlow({ step: "accepted", index: i, alertId: body.alert_id, score: body.score });
      poll(body.alert_id);
    } catch (e) {
      setFlow({ step: "error", index: i, error: e.message });
    }
  }, [key, cfg, file]);

  // 재생
  useEffect(() => {
    if (!playing || !sim) return undefined;
    const id = setInterval(() => {
      setIdx((i) => (i + 1 < sim.scores.length ? i + 1 : i));
    }, speed);
    return () => clearInterval(id);
  }, [playing, sim, speed]);

  // 재생 중에 돌파 시각에 "도착"했을 때만 보낸다 (슬라이더로 건너뛸 때는 보내지 않음)
  useEffect(() => {
    if (!playing || !sim) return;
    if (idx >= sim.scores.length - 1) setPlaying(false);
    if (sim.send_index === idx && !sentRef.current) {
      sendAlert(idx);
      if (pauseOnSend) setPlaying(false);
    }
  }, [idx, playing, sim, pauseOnSend, sendAlert]);

  const scores = sim?.scores || [];
  const p = scores[idx];
  const thrSend = sim?.threshold_send ?? cfg?.threshold_send ?? 85;
  const thrAlert = sim?.threshold_alert ?? cfg?.threshold_alert ?? 70;
  const st = STEP_TEXT[flow.step];
  const armed = Boolean(key) && cfg?.send_configured;

  return (
    <section className="dp-section" id="sim">
      <p className="dp-label">{L("장면 3 · 모의 위기 시뮬레이션", "Scene 3 · Simulated crisis")}</p>
      <h2 className="dp-h2">{L("위험이 급증하면, 결정은 사람이 내립니다", "When risk spikes, a person decides")}</h2>
      <p className="dp-lede" style={{ fontSize: 15.5 }}>
        {L(
          "직접 만든 모의 위기 데이터를 올리면 실제 엔진이 시각별로 점수를 매기고, 시간 순서대로 재생합니다. 점수가 85점을 처음 넘는 순간 ThreatWatch로 경보가 한 번 나가고, 승인 요청 메일에서 사람이 승인하거나 반려합니다.",
          "Upload your own crisis data; the real engine scores every hour and plays it back. The first time the score crosses 85, one alert goes to ThreatWatch and a person approves or rejects it from the email.",
        )}
      </p>

      <div className="dp-panel-low dp-sim-controls" style={{ marginTop: 32 }}>
        <div className="dp-sim-files">
          <p className="dp-label">1 · {L("데이터", "Data")}</p>
          <div className="dp-row" style={{ justifyContent: "flex-start", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <label className="dp-secondary" style={{ cursor: "pointer" }}>
              {L("파일 올리기 (CSV·JSON)", "Upload file (CSV/JSON)")}
              <input type="file" accept=".csv,.json,text/csv,application/json" onChange={onPick} hidden />
            </label>
            <button type="button" className="dp-secondary" onClick={loadTemplate}>{L("기본 시나리오", "Sample scenario")}</button>
            <a className="dp-small" href="/depeg/sim-template.csv" download style={{ color: "var(--accent)" }}>
              {L("템플릿 내려받기", "Download template")}
            </a>
            <a className="dp-small" href="/depeg/sim-rehearsal.csv" download style={{ color: "var(--accent)" }}>
              {L("리허설용 24시간 파일", "24-hour rehearsal file")}
            </a>
          </div>
          <p className="dp-small" style={{ margin: "10px 0 0" }}>
            {L("열: t(UTC), price_usd(필수) · redemption_volume_usd, pool_imbalance_ratio(0~1), news_risk_flag(0/1), reserve_cash_ratio, attestation_age_days(선택). 비운 열은 점수에 넣지 않습니다.",
               "Columns: t (UTC), price_usd (required) · redemption_volume_usd, pool_imbalance_ratio (0–1), news_risk_flag (0/1), reserve_cash_ratio, attestation_age_days (optional). Empty columns are left out of the score.")}
          </p>
          {busy && <p className="dp-small" style={{ marginTop: 10 }}>{L("채점 중…", "Scoring…")}</p>}
          {err && <div className="dp-verdict alert" style={{ marginTop: 12 }}><strong>{L("파일을 읽지 못했습니다", "Could not read the file")}</strong>{err}</div>}
          {file && sim && (
            <p className="dp-small" style={{ margin: "10px 0 0", color: "var(--text)" }}>
              {file.name} · {L(`${scores.length}시간`, `${scores.length} hours`)} ·{" "}
              {sim.send_index != null
                ? L(`${sim.send_index + 1}번째 시간에 ${thrSend}점 돌파`, `crosses ${thrSend} at hour ${sim.send_index + 1}`)
                : L(`${thrSend}점을 넘는 구간 없음 — 경보가 나가지 않습니다`, `never crosses ${thrSend} — no alert will be sent`)}
            </p>
          )}
        </div>

        <div>
          <p className="dp-label">2 · {L("실제 메일 발송", "Real email")}</p>
          <input type="password" className="dp-input" placeholder={L("시연 키", "Demo key")} value={key}
                 onChange={(e) => setKey(e.target.value)} autoComplete="off" style={{ marginTop: 12 }}
                 disabled={!cfg?.send_configured} aria-label={L("시연 키", "Demo key")} />
          <p className="dp-small" style={{ margin: "8px 0 0" }}>
            {!cfg?.send_configured
              ? L("이 배포에는 시연 키가 설정돼 있지 않아 재생만 됩니다.", "No demo key on this deployment — playback only.")
              : armed
                ? <span className="dp-chip warn">{L("발송 준비됨 — 돌파 시 실제 경보 1건", "Armed — one real alert on crossing")}</span>
                : L("키를 넣으면 돌파 순간 실제 경보가 나갑니다. 비우면 미리보기만 합니다.", "Enter the key to send for real; leave empty to preview.")}
          </p>
        </div>

        <div>
          <p className="dp-label">3 · {L("재생", "Play")}</p>
          <div className="dp-row" style={{ justifyContent: "flex-start", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="dp-primary" disabled={!sim}
                    onClick={() => { if (idx >= scores.length - 1) setIdx(0); setPlaying((v) => !v); }}>
              {playing ? L("일시정지", "Pause") : idx > 0 ? L("계속", "Resume") : L("재생", "Play")}
            </button>
            <select className="dp-input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: "auto" }}>
              {SPEEDS.map((s) => <option key={s.ms} value={s.ms}>{s[lang]}</option>)}
            </select>
          </div>
          <label className="dp-small" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <input type="checkbox" checked={pauseOnSend} onChange={(e) => setPauseOnSend(e.target.checked)} />
            {L("돌파 순간 자동 일시정지", "Pause at the crossing")}
          </label>
        </div>
      </div>

      {sim && p && (
        <div className="dp-replay" style={{ marginTop: 16 }}>
          <div className="dp-panel">
            <p className="dp-h3">{L("모의 USDC 가격", "Simulated USDC price")}</p>
            <LineChart
              series={[{ key: "p", label: "price", color: SERIES.price, values: scores.map((s) => s.price) }]}
              times={scores.map((s) => s.t)} upto={idx}
              yMin={Math.min(0.9, ...scores.map((s) => s.price)) - 0.01} yMax={1.02}
              yTicks={[0.9, 0.95, 1.0]} formatY={(v) => `$${v.toFixed(2)}`}
              refLines={[{ y: 1, label: "$1.00", color: "rgba(237,243,255,0.45)" }]}
              hoverIdx={idx} height={190}
              ariaLabel={L("모의 위기 가격 재생", "Simulated price playback")}
            />
            <p className="dp-h3" style={{ marginTop: 24 }}>{L("위험 점수", "Risk score")}</p>
            <LineChart
              series={[{ key: "s", label: "score", color: SERIES.scoreFull, values: scores.map((s) => s.score) }]}
              times={scores.map((s) => s.t)} upto={idx}
              yMin={0} yMax={100} yTicks={[0, 25, 50, 75, 100]} formatY={String}
              refLines={[
                { y: thrSend, label: L(`사람 승인 ${thrSend}`, `Human approval ${thrSend}`), color: INK.bad },
                { y: thrAlert, label: L(`경보 ${thrAlert}`, `Alert ${thrAlert}`), color: INK.warn },
              ]}
              markers={sim.send_index != null ? [{
                i: sim.send_index, v: scores[sim.send_index].score, color: INK.bad, dy: -12,
                label: L("경보 발송", "Alert sent"), anchor: sim.send_index > scores.length * 0.7 ? "end" : "start",
              }] : []}
              hoverIdx={idx} height={230}
              ariaLabel={L("모의 위기 위험 점수 재생", "Simulated risk score playback")}
            />
            <input type="range" min={0} max={scores.length - 1} value={idx} style={{ width: "100%", marginTop: 14, accentColor: "#4d9fff" }}
                   onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
                   aria-label={L("시각 선택", "Choose hour")} />
          </div>

          <aside className="dp-readout">
            <div className="dp-panel" style={{ padding: 24 }}>
              <p className="dp-label">{L("현재 시각", "Now playing")}</p>
              <p className="dp-num" style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--text)" }}>{fmtTime(p.t, lang)}</p>
              <div className="dp-row" style={{ marginTop: 16 }}>
                <span className="dp-small">{L("가격", "Price")}</span>
                <span className="dp-num" style={{ fontSize: 15 }}>${p.price.toFixed(4)} · {p.bps > 0 ? "+" : ""}{p.bps} bps</span>
              </div>
              <div className="dp-inner" style={{ marginTop: 16 }}>
                <span className="dp-small">{L("위험 점수", "Risk score")}</span>
                <p className="dp-big" style={{ margin: "10px 0 14px",
                  color: p.score >= thrSend ? "var(--bad)" : p.score >= thrAlert ? "var(--warn)" : "var(--text)" }}>{p.score}</p>
                <FactorBars factors={p.factors.filter((f) => f.contribution > 0)} labelOf={labelOf} />
              </div>
            </div>

            <div className="dp-panel" style={{ padding: 24 }}>
              <p className="dp-label">{L("경보와 사람의 결정", "Alert and human decision")}</p>
              <span className={`dp-chip ${st.tone}`} style={{ marginTop: 12 }}>{st[lang]}</span>
              {flow.alertId && (
                <p className="dp-small" style={{ margin: "12px 0 0" }}>
                  {L("경보 ID", "Alert ID")} <span className="dp-num" style={{ color: "var(--accent)" }}>{flow.alertId.slice(0, 8)}…</span>
                  {flow.caseInfo && <> · ThreatWatch {flow.caseInfo.risk_level} ({flow.caseInfo.risk_score})</>}
                </p>
              )}
              {flow.step === "error" && <p className="dp-small" style={{ margin: "10px 0 0", color: "var(--bad)" }}>{flow.error}</p>}
              {["accepted", "waiting"].includes(flow.step) && (
                <p className="dp-small" style={{ margin: "10px 0 0" }}>
                  {L("메일의 승인/반려 링크를 누르면 몇 초 안에 이곳에 결과가 표시됩니다. 응답이 없으면 60분 뒤 만료됩니다.",
                     "Click approve or reject in the email; the result shows here within seconds. With no answer it expires after 60 minutes.")}
                </p>
              )}
              {flow.step === "dry" && (
                <p className="dp-small" style={{ margin: "10px 0 0" }}>
                  {L(`${flow.index + 1}번째 시간에 ${thrSend}점을 넘었습니다. 실제 시연에서는 이 순간 승인 메일이 나갑니다.`,
                     `Crossed ${thrSend} at hour ${flow.index + 1}. In the real demo, the approval email goes out now.`)}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
