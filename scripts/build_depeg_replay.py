"""디페그 조기경보 화면(/depeg)이 쓰는 정적 데이터를 만든다.

대시보드는 점수를 직접 계산하지 않는다. 이 스크립트가 depeg-early-warning
저장소의 실제 엔진(compute_risk_score)과 어댑터(to_alert_request)를 그대로
호출해 결과만 JSON으로 남긴다. 엔진이 바뀌면 이 스크립트를 다시 돌리면 된다.

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
    crisis = []
    for t, m in hourly_points(depeg).items():
        onchain = [by_signal[(t, "price_usd")], by_signal[(t, "peg_deviation_bps")]]
        price_only = score(onchain)
        with_off = score(onchain + offchain_signals_at(t))
        crisis.append({
            "t": t,
            "price": m["price_usd"],
            "bps": m["peg_deviation_bps"],
            "score_price": price_only["risk_score"],
            "score_full": with_off["risk_score"],
            "factors": with_off["top_factors"],
            "confidence": with_off["confidence"],
            "breached": with_off["threshold_breached"],
        })

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

    commit = subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"],
                            capture_output=True, text=True).stdout.strip()

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "engine_commit": commit,
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
            "crisis_hours_breached": sum(p["breached"] for p in crisis),
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
