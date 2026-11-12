# AUTO-COPIED from depeg-early-warning/src/engine/risk_score.py @2607352
# 직접 고치지 말 것 — 엔진 저장소에서 고친 뒤 scripts/sync_depeg_engine.sh 로 다시 복사
"""리스크 엔진 스켈레톤 — 역할 3(리스크 엔진 + 백테스트) 담당.

랩 규칙 시연:
- 모든 함수는 순수 함수: 파일/네트워크 I/O 없음, 같은 입력이면 항상 같은 출력.
- I/O(파일 읽기, 큐 수신)는 호출하는 쪽(로컬 러너 또는 Lambda 핸들러)이 담당.
- 이 규칙 덕분에 로컬에서 돌던 코드가 그대로 Lambda에 올라간다.

TODO(역할 3): compute_risk_score 의 로직을 실제 스코어링 모델로 교체.
아래 구현은 파이프라인 관통용 베이스라인(가중 합)일 뿐이다.
"""

from __future__ import annotations

import uuid
from typing import Any

# 대응 트리거 임계값 — 변경은 팀 리뷰 필수 (대응 계층과의 계약)
RISK_THRESHOLD = 70.0

# 베이스라인 가중치 — 역할 3이 백테스트로 교정할 대상
_BASELINE_WEIGHTS = {
    "peg_deviation_bps": 0.5,
    "redemption_volume_usd": 0.2,
    "pool_imbalance_ratio": 0.1,
    "news_risk_flag": 0.1,
    "reserve_cash_ratio": 0.05,
    "attestation_age_days": 0.05,
}


def _normalize(metric: str, value: float) -> float:
    """지표별 원시 값을 0~1 위험 기여도로 정규화한다.

    TODO(역할 3): 지표별 정규화 근거를 문서화하고 교체할 것.
    """
    if metric == "peg_deviation_bps":
        return min(abs(value) / 500.0, 1.0)  # 500bps(5%) 이탈이면 최대 위험
    if metric == "news_risk_flag":
        return 1.0 if value >= 1 else 0.0
    if metric == "reserve_cash_ratio":
        return max(0.0, 1.0 - value)  # 현금 비중이 낮을수록 위험
    if metric == "attestation_age_days":
        return min(value / 90.0, 1.0)  # 공시가 오래될수록 위험
    if metric == "redemption_volume_usd":
        return min(value / 1_000_000_000, 1.0)  # 10억 달러 환매면 최대 위험
    if metric == "pool_imbalance_ratio":
        return min(max(value, 0.0), 1.0)  # 이미 0~1 비율
    return 0.0  # 미정의 지표는 기여 없음 — 조용히 0 처리하지 말지 여부는 팀 결정 사항


def compute_risk_score(signals: list[dict[str, Any]], coin: str) -> dict[str, Any]:
    """시그널 목록에서 특정 코인의 리스크 스코어 이벤트를 산출한다.

    입력: schemas/signal.schema.json 을 따르는 dict 목록 (검증은 호출자 책임)
    출력: schemas/score_event.schema.json 을 따르는 dict
    """
    relevant = [s for s in signals if s["coin"] == coin]

    contributions: dict[str, float] = {}
    for sig in relevant:
        metric = sig["metric"]
        weight = _BASELINE_WEIGHTS.get(metric, 0.0)
        risk = _normalize(metric, float(sig["value"]))
        contributions[metric] = max(contributions.get(metric, 0.0), weight * risk)

    score = min(sum(contributions.values()) * 100.0, 100.0)

    top = sorted(contributions.items(), key=lambda kv: kv[1], reverse=True)[:5]
    top_factors = [
        {"metric": m, "contribution": round(c, 4)} for m, c in top if c > 0
    ] or [{"metric": "none", "contribution": 0.0}]

    latest = max((s["observed_at"] for s in relevant), default="1970-01-01T00:00:00Z")

    return {
        "event_id": str(uuid.uuid4()),
        "coin": coin,
        "scored_at": latest,
        "risk_score": round(score, 2),
        # TODO(역할 3): 시그널 커버리지 기반 신뢰도 산식으로 교체
        "confidence": round(min(len(relevant) / 6.0, 1.0), 2),
        "top_factors": top_factors,
        "threshold_breached": score >= RISK_THRESHOLD,
    }
