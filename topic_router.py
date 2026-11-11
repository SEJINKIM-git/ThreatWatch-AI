"""
알림 토픽 라우팅

보안 에스컬레이션과 디페그 경보는 수신자가 다르므로 SNS 토픽을 분리합니다.
이 파일은 트리아지 Lambda(modules/sns_notifier.py)와
승인 결과 Lambda(approval_finalize.py)가 같은 라우팅 규칙을 쓰도록
루트에 둡니다. approval_finalize의 배포 zip은 modules/ 를 포함하지
않는 단일 파일 패키지라서, 공유 코드는 루트 모듈이어야 합니다.
"""

import logging
import os

logger = logging.getLogger(__name__)

# 외부 디페그 조기경보 엔진이 보내는 incident_type 접두어.
# 위험도 매핑(modules/external_scored.py)과 토픽 라우팅이 같은 값을 씁니다.
DEPEG_PREFIX = "stablecoin_depeg_"


def is_depeg_incident(incident_type) -> bool:
    """디페그 조기경보 엔진이 보낸 경보인지 판정합니다."""
    return isinstance(incident_type, str) and incident_type.startswith(DEPEG_PREFIX)


def resolve_topic_arn(incident_type) -> str:
    """
    발행 대상 토픽 ARN을 결정합니다.

    디페그 경보는 DEPEG_TOPIC_ARN, 그 외에는 기존 TOPIC_ARN입니다.
    DEPEG_TOPIC_ARN이 아직 설정되지 않은 환경(배포 전 로컬 실행 등)에서는
    기존 토픽으로 폴백하고 경고를 남깁니다. 알림이 끊기는 것보다
    잘못된 토픽으로라도 도착하는 쪽이 낫습니다.
    """
    default_arn = os.getenv("TOPIC_ARN", "")

    if not is_depeg_incident(incident_type):
        return default_arn

    depeg_arn = os.getenv("DEPEG_TOPIC_ARN", "")
    if not depeg_arn:
        logger.warning(
            "⚠️ DEPEG_TOPIC_ARN not set - routing depeg alert to default topic"
        )
        return default_arn

    return depeg_arn
