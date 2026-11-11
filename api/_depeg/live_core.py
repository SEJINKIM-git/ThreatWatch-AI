"""실시간 분석의 계산 부분 — 네트워크 없이 테스트할 수 있게 입력을 받아 결과만 만든다.

입력: Bitstamp 1시간 캔들, GDELT 기사 목록, 현재 시각
출력: 화면이 그대로 그리는 JSON (점수, 근거, 기사, 수신자 미리보기)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import risk_score as engine
from news_rubric import news_flag

# 최신 Circle 준비금 보고서 (2026-09, 2026-10-26 발행) — 09-30 기준일 값.
# 출처: depeg-early-warning/docs/offchain_attestation_anatomy.md §1-8 (손 검증값, 조정 반영 현금 비중)
# 공시 자동 추출이 완성되면 그 출력으로 바꾼다.
ATTESTATION = {
    "report": "2026-09",
    "published_at": "2026-10-26T23:59:59Z",
    "as_of": "2026-09-30",
    "cash_ratio": 0.1377,
    "tbill_ratio": 0.3667,
    "repo_ratio": 0.4956,
}

def _engine_stamp() -> str:
    """복사된 엔진 파일 첫 줄의 커밋 표시를 읽는다 (화면 하단 출처 표기용)."""
    try:
        with open(engine.__file__, encoding="utf-8") as f:
            first = f.readline()
        return first.split("@", 1)[1].strip() if "@" in first else "unknown"
    except OSError:
        return "unknown"


ENGINE_STAMP = _engine_stamp()

THRESHOLD_ALERT = 70.0
THRESHOLD_APPROVAL = 85.0
FMT = "%Y-%m-%dT%H:%M:%SZ"


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime(FMT)


def completed_candles(ohlc: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    """끝난 캔들만 남기고, 시각을 종가 확정 시각(시작 + 1시간)으로 바꾼다 (온체인 수집기와 같은 규칙)."""
    out = []
    for c in ohlc:
        start = datetime.fromtimestamp(int(c["timestamp"]), tz=timezone.utc)
        close_at = start + timedelta(hours=1)
        if close_at <= now:
            out.append({"t": iso(close_at), "price": float(c["close"])})
    out.sort(key=lambda r: r["t"])
    return out


def build_signals(price: dict[str, Any], flag: int | None, now: datetime) -> list[dict[str, Any]]:
    """flag=None 이면 뉴스를 확인하지 못한 것 — 뉴스 시그널을 아예 넣지 않는다.
    (0을 넣으면 '위험 없음'으로 계산돼 확인 못 한 것을 확인한 것처럼 보이게 된다)"""
    t = price["t"]
    bps = round((price["price"] - 1.0) * 10000, 2)
    pub = datetime.strptime(ATTESTATION["published_at"], FMT).replace(tzinfo=timezone.utc)
    age = round((now - pub).total_seconds() / 86400, 2)
    base = f"offchain-usdc-{ATTESTATION['published_at']}"
    return [
        {"schema_version": 1, "signal_id": f"onchain-usdc-{t}-price", "source": "onchain", "coin": "USDC",
         "observed_at": t, "metric": "price_usd", "value": price["price"]},
        {"schema_version": 1, "signal_id": f"onchain-usdc-{t}-peg", "source": "onchain", "coin": "USDC",
         "observed_at": t, "metric": "peg_deviation_bps", "value": bps},
        {"schema_version": 1, "signal_id": f"{base}-cash", "source": "offchain", "coin": "USDC",
         "observed_at": ATTESTATION["published_at"], "metric": "reserve_cash_ratio", "value": ATTESTATION["cash_ratio"]},
        {"schema_version": 1, "signal_id": f"{base}-tbill", "source": "offchain", "coin": "USDC",
         "observed_at": ATTESTATION["published_at"], "metric": "reserve_tbill_ratio", "value": ATTESTATION["tbill_ratio"]},
        {"schema_version": 1, "signal_id": f"offchain-usdc-{iso(now)}-age", "source": "offchain", "coin": "USDC",
         "observed_at": iso(now), "metric": "attestation_age_days", "value": age},
    ] + ([] if flag is None else [
        {"schema_version": 1, "signal_id": f"offchain-usdc-{iso(now)}-news", "source": "offchain", "coin": "USDC",
         "observed_at": iso(now), "metric": "news_risk_flag", "value": flag},
    ])


def recipients(score: float) -> list[dict[str, str]]:
    """대응표 v1 기준 — 지금 점수라면 누가 무엇을 받는가 (미리보기, 발송하지 않음)."""
    if score >= THRESHOLD_APPROVAL:
        return [
            {"who": "operator", "now": "push", "what": "high"},
            {"who": "approver", "now": "approval_request", "what": "high"},
            {"who": "investor", "now": "after_approval", "what": "notice_template"},
        ]
    if score >= THRESHOLD_ALERT:
        return [
            {"who": "operator", "now": "push", "what": "medium"},
            {"who": "approver", "now": "heads_up", "what": "medium"},
            {"who": "investor", "now": "none", "what": "none"},
        ]
    return [
        {"who": "operator", "now": "dashboard_only", "what": "none"},
        {"who": "approver", "now": "none", "what": "none"},
        {"who": "investor", "now": "none", "what": "none"},
    ]


def analyze(ohlc: list[dict[str, Any]], articles: list[dict[str, Any]], now: datetime,
            news_error: str | None = None, news_source: str = "none") -> dict[str, Any]:
    candles = completed_candles(ohlc, now)
    if not candles:
        raise ValueError("no completed hourly candle from Bitstamp")
    latest = candles[-1]
    # 24시간 안의 기사만 본다 (출처 쪽 기간 필터에만 기대지 않음). 시각을 모르는 기사는 남긴다.
    cutoff = (now - timedelta(hours=24)).strftime("%Y%m%dT%H%M%SZ")
    articles = [a for a in articles if not a.get("seen") or a["seen"] >= cutoff]
    flag, matched = news_flag(articles)
    if news_error:
        flag, matched = None, []
    signals = build_signals(latest, flag, now)
    price_age_h = (now - datetime.strptime(latest["t"], FMT).replace(tzinfo=timezone.utc)).total_seconds() / 3600
    event = engine.compute_risk_score(signals, coin="USDC")
    score = event["risk_score"]
    verdict = "high" if score >= THRESHOLD_APPROVAL else "alert" if score >= THRESHOLD_ALERT else "ok"
    return {
        "generated_at": iso(now),
        "verdict": verdict,
        "thresholds": {"alert": THRESHOLD_ALERT, "approval": THRESHOLD_APPROVAL},
        "event": event,
        "inputs": {
            "price": latest,
            # 거래소 정지 등으로 최신 확정 캔들이 2시간보다 오래되면 화면에 '지연' 표시
            "price_stale": price_age_h > 2,
            "peg_bps": signals[1]["value"],
            "prices_24h": candles[-24:],
            "attestation": {**ATTESTATION, "age_days": signals[4]["value"]},
            "news": {
                "scanned": len(articles),
                "flag": flag,
                "matched": matched[:12],
                "error": news_error,
                "source": f"{news_source} · last 24h",
            },
        },
        "recipients": recipients(score),
        "engine": ENGINE_STAMP,
    }
