"""
승인 요청 발송

Step Functions의 waitForTaskToken 상태에서 호출됩니다.
task token을 저장하고 승인 링크가 담긴 메일을 보낸 뒤 종료합니다.
상태 머신은 콜백이 올 때까지 대기 상태로 남습니다.
"""

import logging
import os
import secrets
import time

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
APPROVALS_TABLE = os.environ["APPROVALS_TABLE"]
TOPIC_ARN = os.environ["TOPIC_ARN"]
CALLBACK_URL = os.environ["CALLBACK_URL"]

# 상태 머신 타임아웃보다 넉넉하게 잡습니다.
# 승인 레코드가 먼저 사라지면 콜백이 실패합니다.
APPROVAL_TTL_SEC = 7200

_table = boto3.resource("dynamodb", region_name=REGION).Table(APPROVALS_TABLE)
_sns = boto3.client("sns", region_name=REGION)


def handler(event, context):
    case = event.get("case", {})
    task_token = event.get("taskToken")

    if not task_token:
        raise ValueError("taskToken missing from state machine payload")

    alert_id = case.get("alert_id", "unknown")

    # 추측 불가능한 식별자. 이 값 자체가 승인 권한입니다.
    approval_id = secrets.token_urlsafe(32)
    now = int(time.time())

    _table.put_item(Item={
        "approval_id": approval_id,
        "alert_id": alert_id,
        "task_token": task_token,
        "status": "pending",
        "created_at": now,
        "expires_at": now + APPROVAL_TTL_SEC,
    })

    approve_url = f"{CALLBACK_URL}?id={approval_id}&decision=approve"
    reject_url = f"{CALLBACK_URL}?id={approval_id}&decision=reject"

    lines = [
        "P1 case requires your decision.",
        "",
        f"Alert ID   : {alert_id}",
        f"Risk Score : {case.get('risk_score', 'n/a')}/100",
        f"Type       : {case.get('incident_type', 'n/a')}",
        f"Confidence : {case.get('confidence', 'n/a')}",
        "",
        "Summary",
        f"  {case.get('summary', 'n/a')}",
        "",
        "Approve containment:",
        f"  {approve_url}",
        "",
        "Reject (false positive):",
        f"  {reject_url}",
        "",
        f"This request expires in {APPROVAL_TTL_SEC // 3600} hours.",
        "If no decision is made, the case is escalated automatically.",
    ]

    _sns.publish(
        TopicArn=TOPIC_ARN,
        Subject=f"[APPROVAL] {alert_id} requires review"[:100],
        Message="\n".join(lines),
    )

    logger.info(f"📨 approval requested: {alert_id} ({approval_id[:8]}...)")

    # 이 함수는 여기서 끝나지만 상태 머신은 계속 대기합니다.
    # 반환값은 사용되지 않습니다.
    return {"approval_id": approval_id}
