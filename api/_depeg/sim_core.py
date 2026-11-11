"""장면 3 — 사용자가 올린 모의 위기 파일을 시각별로 채점하고, 경보 본문을 만든다. 순수 함수.

파일 한 줄 = 한 시각. 엔진에는 "그 시각의 값만" 넣는다 (2023 리플레이와 같은 규칙).
지표 열이 파일에 없으면 그 지표는 넣지 않는다 — 없는 데이터를 0으로 꾸미지 않는다.
단, 준비금 현금 비중과 공시 경과일은 비어 있으면 최신 공시값을 쓴다 (실시간 화면과 같은 기본값).
"""

from __future__ import annotations

import math
import re
from typing import Any

import risk_score as engine
from threatwatch_sender import to_alert_request

MAX_ROWS = 500
THRESHOLD_ALERT = engine.RISK_THRESHOLD
THRESHOLD_SEND = 85.0  # 이 점수를 처음 넘는 순간 경보를 보낸다 (사람 승인 = P1)

DEFAULTS = {"reserve_cash_ratio": 0.1377, "attestation_age_days": 15.0}

# 열 이름 → (최솟값, 최댓값). signal.schema.json 의 지표별 범위와 같다.
OPTIONAL = {
    "redemption_volume_usd": (0, None),
    "pool_imbalance_ratio": (0, 1),
    "news_risk_flag": (0, 1),
    "reserve_cash_ratio": (0, 1),
    "attestation_age_days": (0, None),
}
TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class RowError(ValueError):
    pass


def _num(v: Any, col: str, i: int) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise RowError(f"{i + 1}행 {col}: 숫자가 아닙니다 ({v!r})") from None
    if not math.isfinite(x):
        raise RowError(f"{i + 1}행 {col}: 유한한 숫자가 아닙니다")
    return x


def validate_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """업로드된 행을 검사하고 숫자로 정리한다. 문제가 있으면 RowError (몇 행, 어느 열인지 포함)."""
    if not isinstance(rows, list) or not rows:
        raise RowError("데이터 행이 없습니다")
    if len(rows) > MAX_ROWS:
        raise RowError(f"최대 {MAX_ROWS}행까지 올릴 수 있습니다 ({len(rows)}행)")
    present = {c for c in OPTIONAL if any(r.get(c) not in (None, "") for r in rows)}
    clean, last_t = [], None
    for i, r in enumerate(rows):
        t = str(r.get("t", "")).strip()
        if not TS.match(t):
            raise RowError(f"{i + 1}행 t: 2026-11-25T09:00:00Z 형식(UTC)이어야 합니다 ({t!r})")
        if last_t and t <= last_t:
            raise RowError(f"{i + 1}행 t: 시각은 위에서 아래로 늘어나야 합니다")
        last_t = t
        price = _num(r.get("price_usd"), "price_usd", i)
        if not 0 <= price <= 2:
            raise RowError(f"{i + 1}행 price_usd: 0~2 사이여야 합니다 ({price})")
        row = {"t": t, "price_usd": price}
        for col, (lo, hi) in OPTIONAL.items():
            v = r.get(col)
            if v in (None, ""):
                if col in DEFAULTS:
                    row[col] = DEFAULTS[col]
                continue
            x = _num(v, col, i)
            if (lo is not None and x < lo) or (hi is not None and x > hi):
                raise RowError(f"{i + 1}행 {col}: {lo}~{hi if hi is not None else '∞'} 범위를 벗어났습니다 ({x})")
            if col == "news_risk_flag" and x not in (0, 1):
                raise RowError(f"{i + 1}행 news_risk_flag: 0 또는 1이어야 합니다")
            row[col] = x
        clean.append(row)
    return clean, sorted(present | set(DEFAULTS))


def row_signals(row: dict[str, Any]) -> list[dict[str, Any]]:
    t = row["t"]
    sig = lambda metric, value, src: {  # noqa: E731
        "schema_version": 1, "signal_id": f"sim-usdc-{t}-{metric}", "source": src,
        "coin": "USDC", "observed_at": t, "metric": metric, "value": value,
    }
    out = [
        sig("price_usd", row["price_usd"], "onchain"),
        sig("peg_deviation_bps", round((row["price_usd"] - 1.0) * 10000, 2), "onchain"),
    ]
    for col in OPTIONAL:
        if col in row:
            src = "onchain" if col in ("redemption_volume_usd", "pool_imbalance_ratio") else "offchain"
            out.append(sig(col, row[col], src))
    return out


def score_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """행마다 엔진 점수. 화면 재생용 결과 목록."""
    out = []
    for row in rows:
        ev = engine.compute_risk_score(row_signals(row), coin="USDC")
        out.append({
            "t": row["t"], "price": row["price_usd"],
            "bps": round((row["price_usd"] - 1.0) * 10000, 1),
            "score": ev["risk_score"], "confidence": ev["confidence"],
            "factors": ev["top_factors"],
        })
    return out


def first_send_index(scores: list[dict[str, Any]]) -> int | None:
    for i, s in enumerate(scores):
        if s["score"] >= THRESHOLD_SEND:
            return i
    return None


def build_alert(rows: list[dict[str, Any]], index: int, label: str) -> dict[str, Any]:
    """index 번째 행으로 엔진 → 어댑터를 거쳐 ThreatWatch 경보 본문을 만든다."""
    if not 0 <= index < len(rows):
        raise RowError("경보를 만들 행 번호가 범위를 벗어났습니다")
    event = engine.compute_risk_score(row_signals(rows[index]), coin="USDC")
    if event["risk_score"] < THRESHOLD_SEND:
        raise RowError(f"{index + 1}행 점수 {event['risk_score']}는 발송 기준 {THRESHOLD_SEND} 미만입니다")
    alert = to_alert_request(event)  # threshold_breached=False 이면 어댑터가 거부한다
    safe_label = re.sub(r"[^\w .\-]", "", label)[:60] or "upload"
    alert["description"] = (
        f"[DEMO SIMULATION · {safe_label} · {rows[index]['t']}] " + alert["description"]
    )[:2000]
    return {"alert": alert, "event": event}
