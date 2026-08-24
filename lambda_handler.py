"""
ThreatWatch AI - Lambda Handler
SQS(threatwatch-alerts)에서 실제 알림 페이로드를 받아 트리아지를 수행합니다.

콜드스타트 시점에 config가 SSM에서 시크릿을 해석하고,
아래 클라이언트들이 한 번만 생성됩니다.
"""

import json
import logging
import os

from config import Config
from modules.alert_builder import AlertBuilder
from modules.precheck import PreCheckValidator
from modules.ai_analyzer import AIAnalyzer
from modules.normalizer import PayloadNormalizer
from modules.decision_router import DecisionRouter
from modules.dynamo_logger import DynamoCaseStore
from modules.sns_notifier import SNSNotifier
from modules.s3_logger import S3AuditLogger

logger = logging.getLogger()
logger.setLevel(logging.INFO)


class InvalidPayload(Exception):
    """
    재시도해도 결과가 같은 페이로드 오류.

    파이프라인 중간에서 발생하는 오류와 반드시 구분되어야 합니다.
    이 예외만 메시지 삭제로 이어지고, 나머지는 전부 재시도 → DLQ 경로를 탑니다.
    UnicodeEncodeError 같은 ValueError 하위 예외가 여기 섞이면
    실제 장애가 조용히 삭제되므로 전용 예외 타입을 씁니다.
    """


# --- 콜드스타트 초기화 (핸들러 밖) ---
_builder = AlertBuilder()
_validator = PreCheckValidator()
_analyzer = AIAnalyzer()
_normalizer = PayloadNormalizer()
_router = DecisionRouter()
_store = DynamoCaseStore()
_notifier = SNSNotifier()
_audit = S3AuditLogger()

REQUIRED_FIELDS = ("incident_type", "severity")

_sfn = None


def _start_approval(state) -> None:
    """
    P1 케이스를 승인 워크플로로 넘깁니다.

    실행 이름을 alert_id로 고정하면 Step Functions가 중복 실행을 거부하므로
    DynamoDB 조건부 쓰기에 이은 두 번째 멱등성 장치가 됩니다.
    """
    global _sfn

    if _sfn is None:
        import boto3
        _sfn = boto3.client("stepfunctions", region_name=os.environ.get("AWS_REGION"))

    p = state.final_payload
    _sfn.start_execution(
        stateMachineArn=os.environ["STATE_MACHINE_ARN"],
        name=p.alert_id[:80],
        input=json.dumps({
            "alert_id": p.alert_id,
            "risk_level": p.risk_level,
            "risk_score": p.risk_score,
            "incident_type": p.incident_type,
            "summary": p.summary,
            "confidence": float(p.confidence),
        }),
    )
    logger.info(f"⏸️ approval workflow started: {p.alert_id}")

def _parse_body(record: dict) -> dict:
    """SQS 레코드 본문을 dict로 변환합니다."""
    raw = record.get("body", "")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        raise InvalidPayload(f"body is not valid JSON: {e}") from e

    if not isinstance(payload, dict):
        raise InvalidPayload("body must be a JSON object")

    missing = [f for f in REQUIRED_FIELDS if not payload.get(f)]
    if missing:
        raise InvalidPayload(f"missing required fields: {missing}")

    return payload


def process_record(record: dict) -> dict:
    """알림 한 건을 처리합니다."""

    payload = _parse_body(record)

    # Step 02 - 실제 페이로드로 알림 구성
    state = _builder.build_from_payload(payload)
    alert_id = state.alert_data.alert_id

    # Step 03 - 데이터 완전성 검사
    state = _validator.check(state)
    logger.info(
        f"[{alert_id}] precheck={state.precheck_result.decision} "
        f"missing={state.precheck_result.total_missing}"
    )

    # Step 04 - LLM 위험도 평가
    state = _analyzer.analyze(state)

    # Step 07 - 최종 페이로드 정규화
    state = _normalizer.normalize(state)

    # 실제 알림 경로에서는 scenario_switch를 적용하지 않습니다.
    # 시나리오 오버라이드는 데모 전용이며, LLM 판정을 덮어쓰면 안 됩니다.

    # Step 11 - DynamoDB 조건부 쓰기 (멱등성 게이트)
    is_new = _store.put_case(state)
    if not is_new:
        logger.warning(f"[{alert_id}] duplicate - skipping notification")
        return {"alert_id": alert_id, "duplicate": True}

    # Step 11b - S3 감사 로그
    _audit.log_incident(state)

        # Step 09/10 - 위험도 라우팅
    # P1은 자동 통지로 끝내지 않고 승인 워크플로로 넘깁니다.
    # 담당자가 격리를 승인하거나 오탐으로 판정할 때까지 케이스가 열려 있습니다.
    if state.final_payload.risk_level == "P1" and os.environ.get("STATE_MACHINE_ARN"):
        _start_approval(state)
    elif _router.should_send_email(state):
        _notifier.send_alert(state)

    logger.info(
        f"[{alert_id}] complete risk={state.final_payload.risk_level} "
        f"score={state.final_payload.risk_score}"
    )
    return {"alert_id": alert_id, "duplicate": False}


def handler(event, context):
    """SQS 이벤트 진입점."""

    records = event.get("Records", [])
    logger.info(f"received {len(records)} record(s)")

    failures = []

    for record in records:
        message_id = record.get("messageId", "unknown")
        try:
            process_record(record)
        except InvalidPayload as e:
            # 페이로드 자체가 잘못된 경우는 재시도해도 결과가 같습니다.
            # 실패로 올리지 않고 삭제해서 DLQ 낭비를 막습니다.
            logger.error(f"[{message_id}] invalid payload, dropping: {e}")
        except Exception as e:
            # 그 외 모든 오류는 일시적일 수 있으므로 재시도시킵니다.
            # maxReceiveCount(3) 초과 시 DLQ로 격리됩니다.
            logger.exception(f"[{message_id}] processing failed: {e}")
            failures.append({"itemIdentifier": message_id})

    return {"batchItemFailures": failures}
