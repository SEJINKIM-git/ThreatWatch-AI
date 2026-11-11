import { useCallback, useEffect, useState } from "react";
import { LineChart, FactorBars, SERIES, INK } from "./charts.jsx";

/**
 * 장면 1 — 오늘의 실시간 분석
 *
 * /api/depeg-live 가 오늘의 가격·뉴스·공시를 불러와 엔진으로 점수를 낸다.
 * 이 화면은 결과를 보여주기만 하고, 아무것도 발송하지 않는다.
 */

const TIER = {
  A: { tone: "bad", ko: "발행사 위기", en: "Issuer distress" },
  B: { tone: "warn", ko: "보관처 위기", en: "Custodian distress" },
  C: { tone: "neutral", ko: "관찰", en: "Watch" },
};

const WHO = {
  operator: { ko: "운영자", en: "Operator" },
  approver: { ko: "승인자", en: "Approver" },
  investor: { ko: "투자자·이해관계자", en: "Investors & stakeholders" },
};

const NOW_TEXT = {
  push: { ko: "즉시 알림", en: "Notified now", tone: "warn" },
  approval_request: { ko: "승인 요청", en: "Approval request", tone: "bad" },
  heads_up: { ko: "사전 통지 (승인 요청 아님)", en: "Heads-up (no approval yet)", tone: "info" },
  after_approval: { ko: "사람 승인 후에만 안내문", en: "Notice only after approval", tone: "info" },
  dashboard_only: { ko: "대시보드 표시만", en: "Dashboard only", tone: "good" },
  none: { ko: "보내지 않음", en: "Nothing sent", tone: "neutral" },
};

/** 외부 피드 URL은 http/https만 링크로 쓴다 (javascript: 등 차단) */
function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function gdeltTime(s) {
  // GDELT seendate: 20261111T063000Z
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(s || "");
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : null;
}

export default function LiveNow({ L, lang, labelOf, fmtTime }) {
  const [state, setState] = useState({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    fetch("/api/depeg-live")
      .then(async (r) => {
        const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body;
      })
      .then((data) => setState({ status: "ok", data }))
      .catch((e) => setState({ status: "error", error: e.message }));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="dp-section" id="live">
      <p className="dp-label">{L("장면 1 · 오늘의 실시간 분석", "Scene 1 · Live today")}</p>
      <h2 className="dp-h2">{L("지금 이 순간, 시스템이 보는 USDC", "USDC right now, as the system sees it")}</h2>
      <p className="dp-lede" style={{ fontSize: 15.5 }}>
        {L(
          "페이지를 열면 오늘의 가격·뉴스·공시를 새로 불러와 같은 엔진으로 점수를 냅니다. 아무것도 발송하지 않는 미리보기이며, 결과는 최대 10분 동안 재사용됩니다.",
          "Opening the page pulls today's price, news and filings and scores them with the same engine. It is a preview that sends nothing; results are reused for up to 10 minutes.",
        )}
      </p>

      {state.status === "loading" && (
        <div className="dp-panel" style={{ marginTop: 32 }}>
          <p className="dp-body">{L("오늘 데이터를 불러오는 중…", "Fetching today's data…")}</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="dp-panel" style={{ marginTop: 32 }}>
          <span className="dp-chip warn">{L("실시간 데이터 없음", "Live data unavailable")}</span>
          <p className="dp-body" style={{ marginTop: 12 }}>
            {L("외부 데이터를 불러오지 못했습니다", "Could not reach the live sources")}: <span className="dp-num">{state.error}</span>
          </p>
          <p className="dp-small" style={{ marginTop: 6 }}>
            {L("아래의 2023년 리플레이는 저장된 데이터라 그대로 볼 수 있습니다.", "The 2023 replay below uses stored data and still works.")}
          </p>
          <button type="button" className="dp-secondary" style={{ marginTop: 14 }} onClick={load}>
            {L("다시 시도", "Retry")}
          </button>
        </div>
      )}

      {state.status === "ok" && <LiveBody data={state.data} L={L} lang={lang} labelOf={labelOf} fmtTime={fmtTime} reload={load} />}
    </section>
  );
}

function LiveBody({ data, L, lang, labelOf, fmtTime, reload }) {
  const { event, inputs, thresholds, verdict, recipients } = data;
  const prices = inputs.prices_24h;
  const vals = prices.map((p) => p.price);
  const lo = Math.min(...vals, 0.999);
  const hi = Math.max(...vals, 1.001);
  const pad = Math.max(0.0005, (hi - lo) * 0.25);
  const news = inputs.news;
  const att = inputs.attestation;

  const verdictText = {
    ok: L(`경보 없음 — ${thresholds.alert}점 미만`, `No alert — below ${thresholds.alert}`),
    alert: L("경보 → 운영자 알림 (ThreatWatch P2)", "Alert → operator (ThreatWatch P2)"),
    high: L("높음 → 사람 승인 요청 (ThreatWatch P1)", "High → human approval (ThreatWatch P1)"),
  }[verdict];

  return (
    <>
      <div className="dp-live">
        <div className="dp-panel">
          <div className="dp-row" style={{ alignItems: "center" }}>
            <span className="dp-chip good">LIVE · {fmtTime(data.generated_at, lang, true)}</span>
            <button type="button" className="dp-secondary" onClick={reload}>{L("다시 불러오기", "Refresh")}</button>
          </div>

          <div className="dp-live-score">
            <div>
              <p className="dp-label">{L("현재 위험 점수", "Current risk score")}</p>
              <p className="dp-big" style={{ margin: "12px 0 0", fontSize: 52,
                color: verdict === "high" ? "var(--bad)" : verdict === "alert" ? "var(--warn)" : "var(--text)" }}>
                {event.risk_score}
              </p>
              <p className="dp-small" style={{ margin: "8px 0 0" }}>{L("기준", "Lines")} {thresholds.alert} / {thresholds.approval}</p>
            </div>
            <div className={`dp-verdict ${verdict}`} style={{ alignSelf: "end" }}>
              <strong>{verdictText}</strong>
              {verdict === "ok" && news.flag === null
                ? L("뉴스를 확인하지 못해 가격·공시만으로 낸 점수입니다. 뉴스 신호는 '위험 없음'이 아니라 '확인 불가'입니다.", "Scored from price and filings only — news could not be checked, which is not the same as no news risk.")
                : verdict === "ok" && (news.flag || event.risk_score >= 25)
                ? L("기준선 아래지만 주의할 신호가 있습니다. 운영자가 대시보드에서 지켜보는 단계입니다.", "Below the line, but there are warning signs. Operators watch it on the dashboard.")
                : verdict === "ok"
                ? L("평상시 범위입니다. 오탐 없이 조용히 있는 것도 시스템의 역할입니다.", "Within the normal range. Staying quiet without false alarms is part of the job.")
                : L("실제 운영에서는 이 시점에 ThreatWatch로 경보가 넘어갑니다.", "In production the alert would hand off to ThreatWatch now.")}
            </div>
          </div>

          <div className="dp-inner" style={{ marginTop: 20 }}>
            <p className="dp-small" style={{ margin: "0 0 12px" }}>{L("점수 구성", "What makes up the score")}</p>
            <FactorBars factors={event.top_factors.filter((f) => f.contribution > 0)} labelOf={labelOf} />
            {event.top_factors.every((f) => f.contribution === 0) && (
              <p className="dp-small" style={{ margin: 0 }}>{L("기여한 항목 없음", "No contributing factors")}</p>
            )}
          </div>

          <dl className="dp-kv dp-live-inputs">
            <div><dt>{L("USDC 가격", "USDC price")}</dt>
              <dd className="dp-num">${inputs.price.price.toFixed(4)} · {inputs.peg_bps > 0 ? "+" : ""}{inputs.peg_bps} bps
                <span className="dp-small"> ({fmtTime(inputs.price.t, lang, true)} {L("확정", "close")})</span>
                {inputs.price_stale && <span className="dp-chip warn" style={{ marginLeft: 8 }}>{L("가격 데이터 지연", "Price feed delayed")}</span>}</dd></div>
            <div><dt>{L("최신 공시", "Latest filing")}</dt>
              <dd>{att.report} · {L("발행", "published")} {att.published_at.slice(0, 10)} · {L(`${Math.floor(att.age_days)}일 경과`, `${Math.floor(att.age_days)} days old`)}
                <span className="dp-small"> · {L("현금", "cash")} {(att.cash_ratio * 100).toFixed(1)}% · {L("국채", "T-bills")} {(att.tbill_ratio * 100).toFixed(1)}% · {L("레포", "repo")} {(att.repo_ratio * 100).toFixed(1)}%</span></dd></div>
            <div><dt>{L("뉴스 위험 신호", "News risk flag")}</dt>
              <dd>{news.flag === null
                ? <span className="dp-chip neutral">{L("확인 불가", "Unavailable")}</span>
                : news.flag ? <span className="dp-chip bad">{L("켜짐", "On")}</span> : <span className="dp-chip good">{L("꺼짐", "Off")}</span>}
                {news.flag !== null && <span className="dp-small"> {L(`최근 24시간 기사 ${news.scanned}건 확인`, `${news.scanned} articles checked, last 24h`)}</span>}</dd></div>
          </dl>

          <p className="dp-h3" style={{ marginTop: 24, fontSize: 15 }}>{L("최근 24시간 가격", "Last 24 hours")}</p>
          <div style={{ marginTop: 8 }}>
            <LineChart
              series={[{ key: "p", label: "USDC", color: SERIES.price, values: vals }]}
              times={prices.map((p) => p.t)} yMin={lo - pad} yMax={hi + pad}
              yTicks={[1.0, ...(lo < 0.998 ? [Math.round(lo * 1000) / 1000] : []), ...(hi > 1.002 ? [Math.round(hi * 1000) / 1000] : [])]}
              formatY={(v) => `$${v.toFixed(3)}`}
              refLines={[{ y: 1, label: "$1.00", color: "rgba(237,243,255,0.45)" }]}
              height={120} compact
              ariaLabel={L("최근 24시간 USDC 가격", "USDC price, last 24 hours")}
            />
          </div>
        </div>

        <div className="dp-panel">
          <div className="dp-row">
            <p className="dp-h3">{L("오늘의 관련 뉴스", "Today's relevant news")}</p>
            <span className="dp-small">{news.source}</span>
          </div>
          <p className="dp-small" style={{ margin: "8px 0 0" }}>
            {L(
              "AI가 아니라 정해진 기준표로 분류합니다. 발행사나 준비금 보관처의 위기 기사만 신호를 켜고, 규제 소식은 관찰로만 남깁니다.",
              "Classified by a fixed rubric, not by AI. Only issuer or custodian distress turns the flag on; regulatory news is kept as watch-only.",
            )}
          </p>
          {news.error && <div className="dp-verdict alert" style={{ marginTop: 14 }}><strong>{L("뉴스 확인 불가", "News unavailable")}</strong>{news.error}</div>}
          <div className="dp-news">
            {news.matched.length === 0 && !news.error && (
              <p className="dp-body" style={{ fontSize: 13.5 }}>
                {L(`해당하는 기사가 없습니다 (${news.scanned}건 확인).`, `No matching articles (${news.scanned} checked).`)}
              </p>
            )}
            {news.matched.map((a, i) => {
              const t = gdeltTime(a.seen);
              const href = safeUrl(a.url);
              const Tag = href ? "a" : "div";
              const linkProps = href ? { href, target: "_blank", rel: "noreferrer noopener" } : {};
              return (
                <Tag key={`${i}-${a.url}`} className="dp-news-item" {...linkProps}>
                  <span className="dp-row" style={{ justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    <span className={`dp-chip ${TIER[a.tier].tone}`}>{TIER[a.tier][lang]}</span>
                    <span className="dp-owner">{a.domain}{t ? ` · ${fmtTime(t, lang, true)}` : ""}</span>
                  </span>
                  <span className="dp-news-title">{a.title}</span>
                  <span className="dp-owner">{L("근거", "Rule")}: “{a.who}” + “{a.why}”</span>
                </Tag>
              );
            })}
          </div>
        </div>
      </div>

      <div className="dp-panel-low" style={{ marginTop: 16 }}>
        <div className="dp-row" style={{ flexWrap: "wrap" }}>
          <p className="dp-h3">{L("지금 점수라면 누가 무엇을 받나", "Who would hear what at this score")}</p>
          <span className="dp-chip neutral">{L("미리보기 · 발송 안 함", "Preview · nothing sent")}</span>
        </div>
        <div className="dp-recips">
          {recipients.map((r) => {
            const n = NOW_TEXT[r.now];
            return (
              <div key={r.who} className="dp-recip">
                <p className="dp-label">{WHO[r.who][lang]}</p>
                <span className={`dp-chip ${n.tone}`} style={{ justifySelf: "start" }}>{n[lang]}</span>
              </div>
            );
          })}
        </div>
        <p className="dp-small" style={{ margin: "16px 0 0" }}>
          {L(
            "투자자·이해관계자 안내는 점수와 관계없이 사람이 승인한 뒤에만 나갑니다. AI는 판단하지 않고, 엔진이 정한 등급에 맞춰 안내 문장만 씁니다.",
            "Investor and stakeholder notices only go out after a person approves, whatever the score. AI does not decide; it only drafts the wording for the level the engine set.",
          )}
        </p>
      </div>
      <p className="dp-foot" style={{ marginTop: 14, paddingTop: 0 }}>
        {L("엔진", "Engine")} @{data.engine} · {L("가격", "Price")}: Bitstamp USDC/USD 1h · {L("뉴스", "News")}: {news.source} · {L("공시", "Filing")}: Circle {att.report} ({L("손 검증값", "hand-verified")})
      </p>
    </>
  );
}
