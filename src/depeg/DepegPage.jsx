import { useEffect, useMemo, useState } from "react";
import "./depeg.css";
import { LineChart, FactorBars, SERIES, INK } from "./charts.jsx";
import LiveNow from "./LiveNow.jsx";
import SimCrisis from "./SimCrisis.jsx";
import { APPROVAL_TIMELINE, OUTCOMES } from "./content.js";

/**
 * /depeg — ThreatWatch 위에 얹은 디페그 조기경보 시스템 설명 화면
 *
 * 화면의 모든 숫자는 public/depeg/replay.json 에서 온다.
 * 그 파일은 scripts/build_depeg_replay.py 가 depeg-early-warning 저장소의
 * 실제 엔진을 돌려 만든다. 이 화면은 계산하지 않고 보여주기만 한다.
 */

const METRIC = {
  price_usd: { ko: "가격", en: "Price" },
  peg_deviation_bps: { ko: "1달러 대비 이탈폭", en: "Peg deviation" },
  reserve_cash_ratio: { ko: "준비금 현금 비중", en: "Reserve cash share" },
  reserve_tbill_ratio: { ko: "준비금 국채 비중", en: "Reserve T-bill share" },
  attestation_age_days: { ko: "공시 경과 일수", en: "Attestation age" },
  redemption_volume_usd: { ko: "대량 상환 규모", en: "Redemption volume" },
  pool_imbalance_ratio: { ko: "유동성 쏠림", en: "Pool imbalance" },
  news_risk_flag: { ko: "뉴스 위험 신호", en: "News risk flag" },
  none: { ko: "기여 없음", en: "None" },
};

const LANG_KEY = "tw-depeg-lang";

function readLang() {
  try { return localStorage.getItem(LANG_KEY) === "en" ? "en" : "ko"; } catch { return "ko"; }
}

/** UTC 시각 → "3/11 17:00 KST · 3/11 08:00 UTC" (short=true면 앞쪽 하나만) */
function fmtTime(t, lang, short = false) {
  const d = new Date(t);
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const hh = (x) => String(x).padStart(2, "0");
  const utc = `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh(d.getUTCHours())}:${hh(d.getUTCMinutes())} UTC`;
  const kst = `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${hh(k.getUTCHours())}:${hh(k.getUTCMinutes())} KST`;
  if (short) return lang === "ko" ? kst : utc;
  return lang === "ko" ? `${kst} · ${utc}` : `${utc} · ${kst}`;
}

const fmtBps = (v) => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()} bps`;

export default function DepegPage() {
  const [lang, setLang] = useState(readLang);
  const L = (ko, en) => (lang === "ko" ? ko : en);

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/depeg/replay.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* 저장 불가 환경 무시 */ }
    document.documentElement.lang = lang;
  }, [lang]);

  if (error) {
    return (
      <div className="dp"><Header lang={lang} setLang={setLang} L={L} />
        <main className="dp-main"><p className="dp-body">{L("데이터를 불러오지 못했습니다", "Could not load data")}: {error}</p></main>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="dp"><Header lang={lang} setLang={setLang} L={L} />
        <main className="dp-main"><p className="dp-body">{L("불러오는 중…", "Loading…")}</p></main>
      </div>
    );
  }

  return (
    <div className="dp">
      <Header lang={lang} setLang={setLang} L={L} />
      <main className="dp-main">
        <Hero data={data} L={L} lang={lang} />
        <LiveNow L={L} lang={lang} fmtTime={fmtTime} labelOf={(m) => METRIC[m]?.[lang] ?? m} />
        <Replay data={data} L={L} lang={lang} />
        <SimCrisis L={L} lang={lang} fmtTime={fmtTime} labelOf={(m) => METRIC[m]?.[lang] ?? m} />
        <Handoff data={data} L={L} lang={lang} />
        <Footer data={data} L={L} />
      </main>
    </div>
  );
}

// =============================================================
// 헤더
// =============================================================

function Header({ lang, setLang, L }) {
  return (
    <header className="dp-header">
      <div className="dp-header-in">
        <div>
          <p className="dp-brand">ThreatWatch AI · Depeg Early Warning</p>
          <p className="dp-brand-sub">{L("스테이블코인 조기경보 · 파이프라인 설명", "Stablecoin early warning · how it works")}</p>
        </div>
        <nav className="dp-nav" aria-label={L("화면 이동", "Screens")}>
          <a href="/">{L("소개", "Overview")}</a>
          <a href="/workspace">{L("워크스페이스", "Workspace")}</a>
          <a href="/depeg" aria-current="page">{L("디페그 조기경보", "Depeg")}</a>
          <span className="dp-seg" role="group" aria-label="Language">
            <button type="button" aria-pressed={lang === "ko"} onClick={() => setLang("ko")}>KO</button>
            <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
          </span>
        </nav>
      </div>
    </header>
  );
}

// =============================================================
// 히어로
// =============================================================

function Hero({ data, L, lang }) {
  const s = data.summary;
  return (
    <section className="dp-hero dp-hero--kpis">
      <div className="dp-kpis">
        <Kpi label={L("2023년 3월 최저가", "March 2023 low")} value={`$${s.low.price.toFixed(4)}`}
             sub={fmtTime(s.low.t, lang)} />
        <Kpi label={L("최대 이탈폭", "Max deviation")} value={fmtBps(s.low.bps)}
             sub={L("1달러 대비 −13.7%", "−13.7% from $1")} />
        <Kpi label={L("실데이터 최고 점수 (뉴스 포함)", "Peak score, real data (with news)")}
             value={<>{s.crisis_max_score_news}<span style={{ fontSize: 15, color: "var(--faint)" }}> / {data.thresholds.alert}</span></>}
             sub={L("경보 기준 미달 — 아래에서 이유 설명", "Below the alert line — see why below")}
             tone="warn" />
        <Kpi label={L("평상시 4주 최고 점수", "Peak score, calm 4 weeks")} value={s.calm_max_score}
             sub={L(`잘못 울린 경보 ${s.calm_hours_breached}회`, `${s.calm_hours_breached} false alarms`)} />
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="dp-kpi">
      <p className="dp-label">{label}</p>
      <p className="dp-kpi-v" style={tone === "warn" ? { color: "var(--warn)" } : undefined}>{value}</p>
      <p className="dp-kpi-s">{sub}</p>
    </div>
  );
}

// =============================================================
// 2023년 3월 리플레이
// =============================================================

function Replay({ data, L, lang }) {
  const crisis = data.crisis;
  const times = crisis.map((p) => p.t);
  const lowIdx = times.indexOf(data.summary.low.t);
  const firstIdx = times.indexOf(data.summary.first_minus_50bps);
  const peakIdx = crisis.reduce((best, d, i) => (d.score_news > crisis[best].score_news ? i : best), 0);
  const news = data.summary.news;
  const newsBands = useMemo(() => news.on_segments.map((g) => ({
    from: times.indexOf(g.from), to: times.indexOf(g.to), color: SERIES.newsBand,
    label: L("뉴스 신호 켜짐", "News signal on"),
  })), [news, times, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const [idx, setIdx] = useState(lowIdx >= 0 ? lowIdx : 0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= crisis.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 90);
    return () => clearInterval(id);
  }, [playing, crisis.length]);

  const p = crisis[idx];
  const thr = data.thresholds;
  const verdict = p.score_news >= thr.approval ? "high" : p.score_news >= thr.alert ? "alert" : "ok";
  const hoursBefore = lowIdx - firstIdx;
  const newsHoursBefore = news.streak_hours_before_low;

  const priceSeries = useMemo(() => [{
    key: "price", label: L("USDC 가격", "USDC price"), color: SERIES.price, values: crisis.map((d) => d.price),
  }], [crisis, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const scoreSeries = useMemo(() => [
    { key: "sp", label: L("가격만", "Price only"), short: L("가격만", "Price"), color: SERIES.scorePrice, values: crisis.map((d) => d.score_price) },
    { key: "sf", label: L("가격 + 공시", "Price + filings"), short: L("+공시", "+filings"), color: SERIES.scoreFull, values: crisis.map((d) => d.score_full) },
    { key: "sn", label: L("가격 + 공시 + 뉴스", "Price + filings + news"), short: L("+뉴스", "+news"), color: SERIES.scoreNews, values: crisis.map((d) => d.score_news) },
  ], [crisis, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const refLines = [
    { y: thr.approval, label: L(`사람 승인 ${thr.approval}`, `Human approval ${thr.approval}`), color: INK.bad },
    { y: thr.alert, label: L(`경보 ${thr.alert}`, `Alert ${thr.alert}`), color: INK.warn },
  ];

  return (
    <section className="dp-section" id="replay">
      <p className="dp-label">{L("장면 2 · 실제 데이터 리플레이", "Scene 2 · Real-data replay")}</p>
      <h2 className="dp-h2">{L("2023년 3월 USDC 사태에 그대로 돌려보기", "Replaying the March 2023 USDC depeg")}</h2>
      <p className="dp-lede" style={{ fontSize: 15.5 }}>
        {L(
          "실리콘밸리은행(SVB) 파산으로 Circle 준비금 일부가 묶이자 USDC는 하루 만에 87센트까지 떨어졌습니다. 그 5일을 1시간 단위로 다시 재생하며, 매 시각 우리 엔진이 몇 점을 냈을지 보여줍니다. 그 시각에 공개돼 있던 정보만 씁니다.",
          "When Silicon Valley Bank failed with part of Circle's reserves inside, USDC fell to 87 cents within a day. This replays those five days hour by hour and shows what our engine would have scored — using only information public at that hour.",
        )}
      </p>

      <div className="dp-replay">
        <div className="dp-panel">
          <p className="dp-h3">{L("USDC 가격 (달러)", "USDC price (USD)")}</p>
          <p className="dp-small" style={{ margin: "4px 0 12px" }}>{L("Bitstamp 1시간 종가 · 점선은 1달러", "Bitstamp hourly close · dashed line is $1")}</p>
          <LineChart
            series={priceSeries} times={times} yMin={0.84} yMax={1.02}
            yTicks={[0.85, 0.9, 0.95, 1.0]} formatY={(v) => `$${v.toFixed(2)}`}
            refLines={[{ y: 1, label: "$1.00", color: "rgba(237,243,255,0.45)" }]}
            markers={[
              { i: lowIdx, v: crisis[lowIdx].price, label: L("최저 $0.863", "Low $0.863"), color: SERIES.price },
            ]}
            hoverIdx={idx} onHover={setIdx} height={210}
            ariaLabel={L("2023년 3월 9일부터 14일까지 USDC 시간별 가격", "USDC hourly price, March 9–14 2023")}
          />

          <p className="dp-h3" style={{ marginTop: 28 }}>{L("위험 점수 (0~100)", "Risk score (0–100)")}</p>
          <div className="dp-legend">
            <span><i style={{ background: SERIES.scorePrice }} />{L("가격만", "Price only")}</span>
            <span><i style={{ background: SERIES.scoreFull }} />{L("가격 + 공시", "Price + filings")}</span>
            <span><i style={{ background: SERIES.scoreNews }} />{L("가격 + 공시 + 뉴스", "Price + filings + news")}</span>
            <span><i style={{ background: SERIES.newsBand, outline: `1px solid ${SERIES.scoreNews}` }} />{L("뉴스 신호 켜진 시간", "News signal on")}</span>
            <span style={{ color: INK.warn }}><i className="dash" />{L("경보 기준", "Alert line")}</span>
            <span style={{ color: INK.bad }}><i className="dash" />{L("사람 승인 기준", "Approval line")}</span>
          </div>
          <LineChart
            series={scoreSeries} times={times} yMin={0} yMax={100}
            yTicks={[0, 25, 50, 75, 100]} formatY={(v) => String(v)}
            refLines={refLines}
            markers={[
              { i: peakIdx, v: crisis[peakIdx].score_news, label: L(`최고 ${crisis[peakIdx].score_news}점`, `Peak ${crisis[peakIdx].score_news}`), color: SERIES.scoreNews, dy: -10, anchor: "end" },
            ]}
            bands={newsBands} endLabels
            hoverIdx={idx} onHover={setIdx} height={230}
            ariaLabel={L("시간별 위험 점수와 경보 기준선", "Hourly risk score with alert thresholds")}
          />

          <div className="dp-scrub">
            <button type="button" className="dp-secondary"
                    onClick={() => { if (idx >= crisis.length - 1) setIdx(0); setPlaying((v) => !v); }}>
              {playing ? L("일시정지", "Pause") : L("▶ 재생", "▶ Play")}
            </button>
            <input type="range" min={0} max={crisis.length - 1} value={idx}
                   onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
                   aria-label={L("시각 선택", "Choose hour")} />
          </div>
        </div>

        <aside className="dp-readout">
          <div className="dp-panel" style={{ padding: 24 }}>
            <p className="dp-label">{L("선택한 시각", "Selected hour")}</p>
            <p className="dp-num" style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--text)" }}>{fmtTime(p.t, lang)}</p>

            <div className="dp-row" style={{ marginTop: 18 }}>
              <span className="dp-small">{L("가격", "Price")}</span>
              <span className="dp-num" style={{ fontSize: 15 }}>${p.price.toFixed(4)}</span>
            </div>
            <div className="dp-row" style={{ marginTop: 6 }}>
              <span className="dp-small">{L("1달러 대비", "vs $1")}</span>
              <span className="dp-num" style={{ fontSize: 15 }}>{fmtBps(p.bps)}</span>
            </div>

            <div className="dp-inner" style={{ marginTop: 18 }}>
              <div className="dp-row">
                <span className="dp-small">{L("위험 점수 (가격 + 공시 + 뉴스)", "Score (price + filings + news)")}</span>
                <span className="dp-small dp-num">{L("가격만", "price only")} {p.score_price} · {L("+공시", "+filings")} {p.score_full}</span>
              </div>
              <p className="dp-big" style={{ margin: "10px 0 16px" }}>{p.score_news}</p>
              <FactorBars factors={p.factors} labelOf={(m) => METRIC[m]?.[lang] ?? m} />
            </div>

            <div className="dp-inner" style={{ marginTop: 12 }}>
              <div className="dp-row">
                <span className="dp-small">{L("뉴스 신호 (지난 24시간 기사)", "News signal (last 24h)")}</span>
                <span className="dp-small dp-num">{p.news === 1 ? L("켜짐", "on") : p.news === 0 ? L("꺼짐", "off") : "—"}</span>
              </div>
              {p.news_top && (
                <p className="dp-small" style={{ margin: "8px 0 0" }}>
                  {p.news_top.tier} · {p.news_top.outlet} — “{p.news_top.title}”
                </p>
              )}
            </div>

            <div className={`dp-verdict ${verdict}`} style={{ marginTop: 12 }}>
              {verdict === "ok" && (<>
                <strong>{L(`경보 없음 — ${thr.alert}점 미만`, `No alert — below ${thr.alert}`)}</strong>
                {p.score_price >= 50
                  ? L("가격은 이미 크게 무너졌지만 가격 항목의 최대 기여가 50점이라 기준선에 닿지 못합니다.", "Price has collapsed, but the price factor maxes out at 50, so the line is never reached.")
                  : L("정상 범위입니다.", "Within the normal range.")}
              </>)}
              {verdict === "alert" && <strong>{L("경보 발생 → ThreatWatch P2", "Alert → ThreatWatch P2")}</strong>}
              {verdict === "high" && <strong>{L("높음 → ThreatWatch P1, 사람 승인", "High → ThreatWatch P1, human approval")}</strong>}
            </div>
          </div>
        </aside>
      </div>

      <div className="dp-insights">
        <div className="dp-insight">
          <p className="dp-label">{L("가격만 볼 때 한계", "Price-only lead time")}</p>
          <p className="dp-num" style={{ margin: "10px 0 6px" }}>
            {L(`가격만 최대 ${hoursBefore}시간 전 → 뉴스 포함 ${newsHoursBefore}시간 전`, `Price only ≤ ${hoursBefore} h → with news ${newsHoursBefore} h`)}
          </p>
          <p className="dp-small" style={{ margin: 0 }}>
            {L(
              `가격은 처음 −50bps를 넘은 ${fmtTime(data.summary.first_minus_50bps, lang).split(" · ")[0]}부터, 뉴스는 끊기지 않고 켜진 ${fmtTime(news.streak_start, lang).split(" · ")[0]}부터 최저점까지. 뉴스 기준표 ${news.rubric_version} · 기사 표 승인 전이라 잠정값입니다.`,
              `Price: from the first −50 bps hour to the low. News: from the start of its unbroken run (${fmtTime(news.streak_start, lang).split(" · ")[0]}). Rubric ${news.rubric_version} · provisional until the article table is approved.`,
            )}
          </p>
        </div>
        <div className="dp-insight">
          <p className="dp-label">{L("기준선과의 거리", "Gap to the alert line")}</p>
          <p className="dp-num" style={{ margin: "10px 0 6px" }}>
            {L(`현재 최고 ${data.summary.crisis_max_score_news}점 / 기준 ${thr.alert}`, `Peak ${data.summary.crisis_max_score_news} / line ${thr.alert}`)}
          </p>
          <p className="dp-small" style={{ margin: 0 }}>
            {L("뉴스가 리드타임은 늘렸지만 점수 공식이 그대로라 기준선을 넘지 못합니다. 재석의 비중 재설계를 기다리는 중입니다.", "News lengthens the lead time, but the formula is unchanged, so the line is still not reached. Waiting on Jaeseok's reweighting.")}
          </p>
        </div>
        <div className="dp-insight">
          <p className="dp-label">{L("평상시 4주", "Calm four weeks")}</p>
          <p className="dp-num" style={{ margin: "10px 0 6px" }}>{L(`최고 ${data.summary.calm_max_score}점`, `Peak ${data.summary.calm_max_score}`)}</p>
          <p className="dp-small" style={{ margin: 0 }}>
            {L(`2023년 1~2월, 1달러에서 최대 ${data.summary.calm_max_abs_bps}bps만 벗어났습니다. 잘못 울린 경보 ${data.summary.calm_hours_breached}회. 가격만 본 값이며, 평상시 뉴스는 아직 미반영입니다.`,
               `Jan–Feb 2023 never moved more than ${data.summary.calm_max_abs_bps} bps from $1. ${data.summary.calm_hours_breached} false alarms. Price only — calm-period news is not included yet.`)}
          </p>
          <div style={{ marginTop: 12 }}>
            <LineChart compact
              series={[{ key: "calm", label: "calm", color: SERIES.scorePrice, values: data.calm.map((d) => d.score_price) }]}
              times={data.calm.map((d) => d.t)} yMin={0} yMax={100} yTicks={[0, 70]} formatY={String}
              refLines={[{ y: thr.alert, label: "", color: INK.warn }]} height={90}
              ariaLabel={L("평상시 4주 위험 점수", "Calm-period risk score")}
            />
          </div>
        </div>
      </div>

      <details className="dp-table-wrap">
        <summary>{L("표로 보기 (120시간)", "View as table (120 hours)")}</summary>
        <div className="dp-table-scroll">
          <table className="dp-table">
            <thead><tr>
              <th>{L("시각", "Hour")}</th><th>{L("가격", "Price")}</th><th>bps</th>
              <th>{L("점수(가격만)", "Score (price)")}</th><th>{L("점수(+공시)", "Score (+filings)")}</th>
              <th>{L("뉴스", "News")}</th><th>{L("점수(+뉴스)", "Score (+news)")}</th>
            </tr></thead>
            <tbody>
              {crisis.map((r) => (
                <tr key={r.t}>
                  <td>{fmtTime(r.t, lang).split(" · ")[0]}</td>
                  <td>{r.price.toFixed(4)}</td><td>{r.bps}</td>
                  <td>{r.score_price}</td><td>{r.score_full}</td>
                  <td>{r.news === 1 ? L("켜짐", "on") : r.news === 0 ? L("꺼짐", "off") : "—"}</td><td>{r.score_news}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

// =============================================================
// 경보 인계 (엔진 → ThreatWatch → 승인)
// =============================================================

function Handoff({ data, L, lang }) {
  const { event, alert } = data.mock;
  const thr = data.thresholds;
  const map = data.tw_severity_map;

  return (
    <section className="dp-section" id="handoff">
      <p className="dp-label">{L("경보 인계", "Handoff")}</p>
      <h2 className="dp-h2">{L("경보가 ThreatWatch로 넘어가는 모습", "How an alert crosses into ThreatWatch")}</h2>
      <p className="dp-lede" style={{ fontSize: 15.5 }}>
        {L(
          "아래는 가상 위기 상황(mock)을 실제 엔진과 경보 변환 코드에 넣어 나온 그대로의 결과입니다.",
          "These are the literal outputs of the real engine and adapter on the mock crisis.",
        )}
      </p>

      <div className="dp-handoff">
        <div className="dp-panel" style={{ padding: 24 }}>
          <p className="dp-label">1 · {L("엔진 점수", "Engine score")}</p>
          <p className="dp-big" style={{ margin: "14px 0 6px", color: "var(--bad)" }}>{event.risk_score}</p>
          <p className="dp-small" style={{ margin: 0 }}>
            {L(`${thr.approval}점 이상이라 등급 '높음'`, `≥ ${thr.approval}, so severity "high"`)}
          </p>
          <div style={{ marginTop: 16 }}>
            <FactorBars factors={event.top_factors} labelOf={(m) => METRIC[m]?.[lang] ?? m} />
          </div>
        </div>
        <div className="dp-arrow" aria-hidden="true">→</div>
        <div className="dp-panel" style={{ padding: 24 }}>
          <p className="dp-label">2 · {L("ThreatWatch로 보내는 경보", "Alert sent to ThreatWatch")}</p>
          <pre className="dp-pre">{JSON.stringify(alert, null, 2)}</pre>
        </div>
        <div className="dp-arrow" aria-hidden="true">→</div>
        <div className="dp-panel" style={{ padding: 24 }}>
          <p className="dp-label">3 · {L("ThreatWatch 등급 변환", "ThreatWatch mapping")}</p>
          <p className="dp-small" style={{ margin: "10px 0 0" }}>
            {L("AI가 다시 채점하지 않고 표대로만 옮깁니다.", "No LLM re-scoring — a fixed table.")}
          </p>
          <div className="dp-map">
            {Object.entries(map).map(([sev, v]) => (
              <div key={sev} className="dp-map-row"
                   style={alert?.severity === sev ? { background: "var(--s-top)" } : undefined}>
                <span className="dp-num">{sev}</span>
                <span style={{ color: "var(--faint)" }}>→</span>
                <span className="dp-num" style={{ textAlign: "right" }}>
                  {v.level} · {v.score}
                </span>
              </div>
            ))}
          </div>
          <p className="dp-small" style={{ margin: "14px 0 0" }}>
            {L("디페그 경보는 보안 알림과 다른 전용 채널(threatwatch-depeg-alerts)로 갑니다.", "Depeg alerts go to their own channel (threatwatch-depeg-alerts).")}
          </p>
        </div>
      </div>

      <div className="dp-approval">
        <div className="dp-panel">
          <div className="dp-row">
            <p className="dp-h3">{L("P1이면 사람이 결정할 때까지 기다립니다", "P1 waits for a human")}</p>
            <span className="dp-chip warn">{L("대응표 v1 제안값", "Proposed (v1)")}</span>
          </div>
          <p className="dp-small" style={{ margin: "8px 0 0" }}>
            {L("응답이 없으면 받는 사람을 늘려 가며 다시 알리고, 60분이 지나면 '만료'로 끝냅니다.", "Silence widens the audience step by step; after 60 minutes the request expires.")}
          </p>
          <div className="dp-tl">
            {APPROVAL_TIMELINE.map((t, i) => (
              <div key={t.at} className={`dp-tl-item ${i === APPROVAL_TIMELINE.length - 1 ? "end" : ""}`}>
                <span className="dp-num">{lang === "ko" ? t.at : (t.atEn || t.at)}</span>
                <p>{t[lang]}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="dp-panel">
          <p className="dp-h3">{L("세 가지 결과", "Three outcomes")}</p>
          <div className="dp-outcomes">
            {OUTCOMES.map((o) => (
              <div key={o.key} className="dp-outcome">
                <span className={`dp-chip ${o.tone}`} style={{ justifySelf: "start" }}>{o[lang]}</span>
                <span className="dp-small">{lang === "ko" ? o.dKo : o.dEn}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================
// 남은 빈칸
// =============================================================

function Footer({ data, L }) {
  return (
    <footer className="dp-foot">
      {L("데이터", "Data")}: Bitstamp USDC/USD 1h OHLC (2023-01-15 ~ 02-12, 2023-03-09 ~ 03-14) ·
      Circle USDC {data.attestation.report} {L("준비금 보고서", "reserve report")} ({L("발행", "published")} {data.attestation.published_at.slice(0, 10)}, {L("손 검증값", "hand-verified")})<br />
      {L("엔진", "Engine")}: depeg-early-warning @{data.engine_commit} · {L("뉴스 기준표", "news rubric")} {data.news_rubric_version} · {L("임시 공식(베이스라인) 가중치", "baseline weights")} {Object.entries(data.weights).map(([k, v]) => `${k} ${v}`).join(", ")}<br />
      {L("생성", "Generated")} {data.generated_at} · scripts/build_depeg_replay.py · {L("점수는 실제 엔진 출력이며, 이 화면은 계산하지 않습니다.", "Scores are real engine output; this page computes nothing.")}
    </footer>
  );
}
