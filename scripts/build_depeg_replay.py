"""디페그 조기경보 화면(/depeg)이 쓰는 정적 데이터를 만든다.

대시보드는 점수를 직접 계산하지 않는다. 이 스크립트가 depeg-early-warning
저장소의 실제 엔진(compute_risk_score)과 어댑터(to_alert_request)를 그대로
호출해 결과만 JSON으로 남긴다. 엔진이 바뀌면 이 스크립트를 다시 돌리면 된다.
가중치·뉴스 규칙은 여기에 복사하지 않는다 — 엔진 저장소의 것을 import 해서 쓴다.

점수 세 줄
  score_price : 가격만
  score_full  : 가격 + 공시
  score_news  : 가격 + 공시 + 뉴스 (엔진의 signals_usdc_2023_news_hourly.json, 같은 시각 값만)

사용법 (depeg-early-warning 저장소의 가상환경에서):
    python scripts/build_depeg_replay.py \
        --engine-repo ../depeg-early-warning \
        --out public/depeg/replay.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# 2023-01 Circle 준비금 보고서 (2023-03-02 발행) — 디페그 주간에 공개돼 있던 최신 공시.
# 값은 depeg-early-warning/docs/offchain_attestation_anatomy.md 4장의 손 검증값이다.
# 자동 추출 파서가 완성되면 이 상수 대신 파서 출력을 읽도록 바꾼다.
ATTESTATION = {
    "report": "2023-01",
    "published_at": "2023-03-02T23:59:59Z",
    "as_of": "2023-01-31",
    "cash_ratio": 0.2034,
    "tbill_ratio": 0.7966,
    "source": "docs/offchain_attestation_anatomy.md §4 (hand-verified)",
}

THRESHOLD_ALERT = 70.0
THRESHOLD_APPROVAL = 85.0

# ThreatWatch modules/external_scored.py 의 _SEVERITY_MAP 사본 (표시용)
TW_SEVERITY_MAP = {"medium": {"level": "P2", "score": 60}, "high": {"level": "P1", "score": 90}}


def parse_ts(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def hourly_points(signals: list[dict]) -> dict[str, dict[str, float]]:
    by_t: dict[str, dict[str, float]] = {}
    for s in signals:
        by_t.setdefault(s["observed_at"], {})[s["metric"]] = float(s["value"])
    return dict(sorted(by_t.items()))


def offchain_signals_at(t: str) -> list[dict]:
    """관측 시각 t에 '이미 공개돼 있던' 공시만 붙인다 (미래 정보 차단)."""
    pub = ATTESTATION["published_at"]
    if parse_ts(t) < parse_ts(pub):
        return []
    age_days = (parse_ts(t) - parse_ts(pub)).total_seconds() / 86400
    base = f"offchain-usdc-{pub}"
    return [
        {"schema_version": 1, "signal_id": f"{base}-cash", "source": "offchain", "coin": "USDC",
         "observed_at": pub, "metric": "reserve_cash_ratio", "value": ATTESTATION["cash_ratio"]},
        {"schema_version": 1, "signal_id": f"{base}-tbill", "source": "offchain", "coin": "USDC",
         "observed_at": pub, "metric": "reserve_tbill_ratio", "value": ATTESTATION["tbill_ratio"]},
        {"schema_version": 1, "signal_id": f"offchain-usdc-{t}-age", "source": "offchain", "coin": "USDC",
         "observed_at": t, "metric": "attestation_age_days", "value": round(age_days, 2)},
    ]


def first_at_or_above(points: list[dict], key: str, line: float) -> str | None:
    return next((p["t"] for p in points if p[key] >= line), None)


def hours_between(a: str | None, b: str) -> float | None:
    if a is None:
        return None
    return round((parse_ts(b) - parse_ts(a)).total_seconds() / 3600, 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine-repo", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    repo = args.engine_repo.resolve()
    sys.path.insert(0, str(repo))
    from jsonschema import Draft202012Validator, FormatChecker  # noqa: E402
    from src.adapters.threatwatch_sender import to_alert_request  # noqa: E402
    from src.contracts import validate_signals  # noqa: E402
    from src.engine import risk_score as engine  # noqa: E402
    from src.intelligence.news_rubric import RUBRIC_VERSION  # noqa: E402
    from src.intelligence.news_signal import hourly_axis, hourly_news_signals, lead_time_summary  # noqa: E402

    schema = json.loads((repo / "schemas/signal.schema.json").read_text(encoding="utf-8"))
    validators = {1: Draft202012Validator(schema, format_checker=FormatChecker())}

    def load(rel: str) -> list[dict]:
        data = json.loads((repo / rel).read_text(encoding="utf-8"))
        validate_signals(data, validators)
        return data

    def score(signals: list[dict]) -> dict:
        validate_signals(signals, validators)
        return engine.compute_risk_score(signals, coin="USDC")

    # --- 디페그 주간: 시각마다 그 시각의 시그널만 넣어 점수를 낸다 ---
    depeg = load("data/historical/signals_usdc_2023_depeg_hourly.json")
    by_signal = {(s["observed_at"], s["metric"]): s for s in depeg}
    # 뉴스: 엔진이 만든 시간별 뉴스 신호 (관측 시각 t 이전 24시간 기사만, 그 시각 공개 보관처 기준)
    news_rel = "data/historical/signals_usdc_2023_news_hourly.json"
    news = {s["observed_at"]: s for s in load(news_rel)}
    crisis = []
    for t, m in hourly_points(depeg).items():
        onchain = [by_signal[(t, "price_usd")], by_signal[(t, "peg_deviation_bps")]]
        price_only = score(onchain)
        with_off = score(onchain + offchain_signals_at(t))
        n = news.get(t)  # 그 시각의 값만 넣는다
        with_news = score(onchain + offchain_signals_at(t) + ([n] if n else []))
        ev = (n or {}).get("meta", {}).get("evidence", [])
        crisis.append({
            "t": t,
            "price": m["price_usd"],
            "bps": m["peg_deviation_bps"],
            "score_price": price_only["risk_score"],
            "score_full": with_off["risk_score"],
            "score_news": with_news["risk_score"],
            "news": int(n["value"]) if n else None,
            "news_top": ({k: ev[0][k] for k in ("title", "outlet", "tier", "published_at")} if ev else None),
            "factors": with_news["top_factors"],
            "confidence": with_news["confidence"],
            "breached": with_news["threshold_breached"],
        })
    news_rubrics = sorted({s.get("meta", {}).get("rubric_version") for s in news.values()} - {None})

    # --- 평시 4주: 비교용 ---
    calm = load("data/historical/signals_usdc_2023_calm_hourly.json")
    calm_by = {(s["observed_at"], s["metric"]): s for s in calm}
    calm_series = []
    for t, m in hourly_points(calm).items():
        ev = score([calm_by[(t, "price_usd")], calm_by[(t, "peg_deviation_bps")]])
        calm_series.append({"t": t, "price": m["price_usd"], "bps": m["peg_deviation_bps"],
                            "score_price": ev["risk_score"]})

    # --- mock 위기 시나리오: 모든 지표가 있을 때 경보가 어떻게 나가는지 ---
    mock_signals = load("data/mock/signals_usdc_crisis.json")
    mock_event = score(mock_signals)
    mock_alert = to_alert_request(mock_event) if mock_event["threshold_breached"] else None
    calm_mock_event = score(load("data/mock/signals_usdc_sample.json"))

    low = min(crisis, key=lambda p: p["price"])
    first_50 = next((p for p in crisis if p["bps"] <= -50), None)

    # 세 줄 각각 기준선(70·85)을 처음 넘은 시각과 최저점까지 남은 시간
    lines = {}
    for key in ("score_price", "score_full", "score_news"):
        lines[key] = {"max": max(p[key] for p in crisis)}
        for name, line in (("alert", THRESHOLD_ALERT), ("approval", THRESHOLD_APPROVAL)):
            t_hit = first_at_or_above(crisis, key, line)
            lines[key][name] = {"first_at": t_hit, "hours_before_low": hours_between(t_hit, low["t"])}

    # 뉴스가 처음 켜진 시각 — 리플레이 창 안 값과, 리드타임 문서와 같은 방식(03-06부터 훑기)의 값을 대조
    news_first_in_window = next((p["t"] for p in crisis if p["news"] == 1), None)
    articles = json.loads((repo / "data/historical/news_2023_handpicked.json").read_text(encoding="utf-8"))
    scan_from = "2023-03-06T01:00:00Z"  # src/intelligence/build_news_signals.py SCAN_FROM 과 같은 값
    lead = lead_time_summary(
        hourly_news_signals("USDC", hourly_axis(scan_from, crisis[-1]["t"]), articles), depeg)
    news_on_segments = []
    for p in crisis:  # 화면의 옅은 배경 띠
        if p["news"] == 1 and (not news_on_segments or news_on_segments[-1]["_open"] is False):
            news_on_segments.append({"from": p["t"], "to": p["t"], "_open": True})
        elif p["news"] == 1:
            news_on_segments[-1]["to"] = p["t"]
        elif news_on_segments:
            news_on_segments[-1]["_open"] = False
    for seg in news_on_segments:
        seg.pop("_open")

    commit = subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"],
                            capture_output=True, text=True).stdout.strip()

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "engine_commit": commit,
        "news_rubric_version": RUBRIC_VERSION,
        "thresholds": {"alert": THRESHOLD_ALERT, "approval": THRESHOLD_APPROVAL},
        "weights": engine._BASELINE_WEIGHTS,
        "attestation": ATTESTATION,
        "tw_severity_map": TW_SEVERITY_MAP,
        "crisis": crisis,
        "calm": calm_series,
        "summary": {
            "low": {"t": low["t"], "price": low["price"], "bps": low["bps"]},
            "first_minus_50bps": first_50["t"] if first_50 else None,
            "crisis_max_score_price": max(p["score_price"] for p in crisis),
            "crisis_max_score_full": max(p["score_full"] for p in crisis),
            "crisis_max_score_news": max(p["score_news"] for p in crisis),
            "crisis_hours_breached": sum(p["breached"] for p in crisis),
            "lines": lines,
            "news": {
                "file": news_rel,
                "rubric_version": news_rubrics[0] if len(news_rubrics) == 1 else news_rubrics,
                "engine_rubric_version": RUBRIC_VERSION,
                "hours_on": sum(p["news"] == 1 for p in crisis),
                "on_segments": news_on_segments,
                "first_on_in_replay": news_first_in_window,
                # 리드타임 문서(docs/news_leadtime_2023.md)와 같은 계산 — 리플레이 창 시작(03-09 01:00) 이전도 본다
                "first_on": lead["news_first_on"],
                "streak_start": lead["streak_start"],
                "streak_hours_before_low": hours_between(lead["streak_start"], low["t"]),
                "streak_hours_before_minus_50bps": lead["streak_lead_before_breach_hours"],
                "calm": None,  # 평상시 4주 뉴스 파일 없음 — 화면에 "평상시 뉴스는 아직 미반영"
            },
            "calm_max_abs_bps": max(abs(p["bps"]) for p in calm_series),
            "calm_max_score": max(p["score_price"] for p in calm_series),
            "calm_hours_breached": sum(p["score_price"] >= THRESHOLD_ALERT for p in calm_series),
        },
        "mock": {
            "signals": mock_signals,
            "event": mock_event,
            "alert": mock_alert,
            "calm_event": calm_mock_event,
        },
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(out["summary"], ensure_ascii=False, indent=1))
    print("mock:", mock_event["risk_score"], "->", mock_alert and mock_alert["severity"])


if __name__ == "__main__":
    main()
