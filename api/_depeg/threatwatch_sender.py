# AUTO-COPIED from depeg-early-warning/src/adapters/threatwatch_sender.py @9d8cc01
# 직접 고치지 말 것 — 엔진 저장소에서 고친 뒤 scripts/sync_depeg_engine.sh 로 다시 복사
"""ThreatWatch 어댑터 — score_event를 AlertRequest로 변환한다.

『코드 통합 설계』 4장의 매핑 표가 이 모듈의 전부다.
랩 규칙: 이 파일의 함수는 전부 순수 함수 — 실제 전송(HMAC 서명 + HTTP)은
랩장이 ThreatWatch의 기존 클라이언트(send_signed.py)를 재사용해 연결한다.

TODO(역할 3 / 학생 C): 매핑 로직 검토, severity 경계값 근거 문서화.
TODO(랩장): 게이트웨이의 severity enum 실제 값 확인 후 스키마 사본 갱신.
"""
from __future__ import annotations

from typing import Any

# severity 경계 — 대응 설계와 리스크 엔진의 팀 합의 사항 (변경은 리뷰 미팅에서)
HIGH_SEVERITY_SCORE = 85.0   # 이상이면 high → 사람 승인(HITL) 경로
MEDIUM_SEVERITY_SCORE = 70.0  # 이상이면 medium → 알림 경로


def to_alert_request(event: dict[str, Any]) -> dict[str, Any]:
    """score_event(schemas/score_event.schema.json)를
    ThreatWatch AlertRequest(schemas/alert_request.schema.json)로 변환한다.

    threshold_breached 가 아닌 이벤트는 경보 대상이 아니므로 호출 자체가 오류다.
    조용히 무시하지 않고 예외를 던진다 (실패를 드러내는 원칙).
    """
    if not event.get("threshold_breached"):
        raise ValueError("threshold_breached=False 이벤트는 경보로 변환할 수 없음")

    score = float(event["risk_score"])
    severity = "high" if score >= HIGH_SEVERITY_SCORE else "medium"

    return {
        "alert_id": event["event_id"],  # 그대로 전달 → ThreatWatch 멱등성이 중복 경보 차단
        "incident_type": f"stablecoin_depeg_risk_{event['coin'].lower()}",
        "severity": severity,
        "timestamp": event["scored_at"],
        "indicators": [f["metric"] for f in event["top_factors"]],
        "description": (
            f"{event['coin']} depeg risk score {score:.1f} "
            f"(confidence {float(event['confidence']):.2f})"
        ),
    }
