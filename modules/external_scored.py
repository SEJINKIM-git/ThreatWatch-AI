"""
외부 사전 평가 경보 처리 (Phase A)

디페그 조기경보 엔진이 보내는 경보는 severity가 이미
외부 리스크 엔진의 판정 결과입니다. LLM이 재채점하면 위험 평가의
출처가 둘이 되므로, 이 경보는 LLM을 거치지 않고 severity를
내부 위험 등급으로 결정론적으로 매핑합니다.

두 함수 모두 순수 함수입니다. 네트워크도 환경변수도 건드리지 않습니다.
"""

from models import AlertData, AIAnalysisResult
from topic_router import is_depeg_incident


class UnknownSeverityError(Exception):
    """
    매핑 테이블에 없는 severity.

    모르는 값을 조용히 P3로 저장하지 않습니다 (fallback 금지 원칙,
    Phase 2 결정 4와 같은 맥락). 이 예외는 InvalidPayload로 감싸지 않고
    그대로 전파시켜 재시도 후 DLQ에 격리합니다. 외부 엔진이 보낸
    경보가 흔적 없이 사라지는 것보다 DLQ에 남는 쪽이 낫습니다.
    """


# severity → (risk_level, risk_score) 결정론적 매핑.
# 점수는 각 등급의 대표값입니다. 외부 엔진은 등급만 전달하므로
# 등급 내 세부 점수는 존재하지 않습니다.
_SEVERITY_MAP = {
    "high": ("P1", 90),
    "medium": ("P2", 60),
    "low": ("P3", 30),
}


def is_external_scored(incident_type) -> bool:
    """외부 리스크 엔진이 이미 위험도를 판정한 경보인지 판정합니다."""
    return is_depeg_incident(incident_type)


def build_assessment_from_severity(alert: AlertData) -> AIAnalysisResult:
    """
    외부 판정 severity를 내부 위험 등급으로 매핑한 평가 결과를 만듭니다.

    LLM 출력과 같은 형태(AIAnalysisResult)를 채워 파이프라인의
    나머지 단계(normalize, 라우팅, 저장)가 구분 없이 동작하게 합니다.
    결정론적 매핑이므로 confidence는 1.0입니다.
    """
    severity = (alert.severity or "").lower()

    if severity not in _SEVERITY_MAP:
        raise UnknownSeverityError(
            f"unmapped severity '{alert.severity}' on external pre-scored alert "
            f"'{alert.incident_type}' - refusing to guess a risk level"
        )

    risk_level, risk_score = _SEVERITY_MAP[severity]

    summary_bullets = [
        "External pre-scored alert (depeg engine)",
        f"Engine severity '{severity}' mapped to {risk_level}",
    ]
    if alert.description:
        summary_bullets.append(alert.description)

    return AIAnalysisResult(
        summary_bullets=summary_bullets,
        risk_level=risk_level,
        risk_score=risk_score,
        rationale=[
            "external pre-scored alert (depeg engine)",
            f"deterministic mapping: severity '{severity}' -> {risk_level}",
        ],
        recommended_actions=[
            "Verdict comes from the external depeg risk engine - see the source system for market context",
        ],
        missing_data_list=[],
        confidence=1.0,
    )
