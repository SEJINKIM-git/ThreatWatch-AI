"""
승인 결과 처리

상태 머신의 마지막 단계입니다.
승인 / 거부 / 만료 결과를 케이스에 기록하고 통지합니다.
"""

import logging
import os
import time

import boto3

import depeg_advisory
from topic_router import resolve_topic_arn

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
TABLE_NAME = os.environ["TABLE_NAME"]
TOPIC_ARN = os.environ["TOPIC_ARN"]  # 기본 토픽. 미설정이면 여기서 바로 실패해야 합니다.

_table = boto3.resource("dynamodb", region_name=REGION).Table(TABLE_NAME)
_sns = boto3.client("sns", region_name=REGION)

MESSAGES = {
    "approve": (
        "Containment approved",
        "An analyst approved containment for this case.",
    ),
    "reject": (
        "Marked false positive",
        "An analyst rejected this case as a false positive.",
    ),
    "expired": (
        "No response received",
        "No decision was made within the approval window. "
        "This case remains open and requires attention.",
    ),
}


def build_result(decision: str, case: dict) -> tuple:
    """결과 메일의 제목과 본문 줄을 만든다. 순수 함수.

    디페그 건은 "권고안 발송" 결정의 결과를 알린다. 보안 건은 기존 문구 그대로다.
    """
    alert_id = case.get("alert_id")
    incident_type = case.get("incident_type")
    _, detail = MESSAGES[decision]
    subject = f"[{decision.upper()}] {alert_id}"

    if depeg_advisory.is_depeg(incident_type):
        if decision == "expired":
            # 만료는 기존 경로 유지 + 권고안이 나가지 않았음을 한 줄로 밝힌다.
            lines = [detail, depeg_advisory.RESULT_TEXT["expired"]]
        else:
            subject = depeg_advisory.result_subject(decision, incident_type, alert_id)
            lines = [depeg_advisory.RESULT_TEXT[decision]]
    else:
        lines = [detail]

    lines += [
        "",
        f"Alert ID : {alert_id}",
        f"Outcome  : {decision}",
    ]
    return subject, lines


def handler(event, context):
    # 상태 머신은 두 경로로 이 함수를 호출합니다:
    #   콜백 경유  → {"case": {...}, "decision": "approve"|"reject"}
    #   타임아웃   → {"case": {...}, "decision": "expired"}
    case = event.get("case", {})
    decision = event.get("decision", "expired")

    alert_id = case.get("alert_id")
    if not alert_id:
        raise ValueError("alert_id missing from state machine payload")

    if decision not in MESSAGES:
        logger.warning(f"unexpected decision '{decision}', treating as expired")
        decision = "expired"

    # 케이스에 승인 결과를 기록합니다.
    # 조건 없이 갱신합니다. 상태 머신은 케이스당 한 번만 실행되고,
    # 여기서 실패하면 Step Functions가 재시도합니다.
    try:
        _table.update_item(
            Key={"alert_id": alert_id},
            UpdateExpression="SET approval_status = :s, approval_decided_at = :t",
            ExpressionAttributeValues={
                ":s": decision,
                ":t": int(time.time()),
            },
        )
    except Exception as e:
        logger.error(f"❌ case update failed for {alert_id}: {e}")
        raise

    subject, lines = build_result(decision, case)

    # 디페그 케이스의 결과 알림은 트리아지와 같은 라우팅 규칙으로
    # 전용 토픽에 발행합니다. incident_type은 콜백 경로에서는
    # 승인 레코드에서, 만료 경로에서는 원본 입력에서 옵니다.
    _sns.publish(
        TopicArn=resolve_topic_arn(case.get("incident_type")),
        Subject=subject[:100],
        Message="\n".join(lines),
    )

    logger.info(f"✅ finalized {alert_id}: {decision}")

    return {"alert_id": alert_id, "decision": decision}
