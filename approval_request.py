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


# topic_router.DEPEG_PREFIX 와 같은 값. 이 Lambda 는 단일 파일로 묶여 배포되므로
# topic_router 를 import 할 수 없다. 두 값이 같은지는 tests/test_approval_message.py 가 확인한다.
DEPEG_PREFIX = "stablecoin_depeg_"


def build_message(case: dict, approval_id: str, callback_url: str) -> tuple:
    """승인 요청 메일의 제목과 본문 줄을 만든다. 순수 함수.

    디페그 경보는 보안 사건이 아니므로 "격리(containment)" 대신 대응 실행 여부를 묻는다.
    위험 점수는 ThreatWatch 내부 등급 점수다. 디페그 엔진의 원래 점수는 Summary 에 있다.
    """
    alert_id = case.get("alert_id", "unknown")
    approve_url = f"{callback_url}?id={approval_id}&decision=approve"
    reject_url = f"{callback_url}?id={approval_id}&decision=reject"
    hours = APPROVAL_TTL_SEC // 3600
    incident_type = str(case.get("incident_type", ""))

    if incident_type.startswith(DEPEG_PREFIX):
        # SNS 메일 제목은 ASCII만 허용된다 (한글·em dash가 있으면 publish 가 실패). 본문은 UTF-8 가능.
        subject = f"[APPROVAL] Depeg alert {alert_id[:8]} - response decision required"
        lines = [
            "스테이블코인 디페그 조기경보 — 대응 실행 여부를 결정해 주세요.",
            "Stablecoin depeg early warning — your decision is required.",
            "",
            f"Alert ID   : {alert_id}",
            f"Level      : {case.get('risk_level', 'n/a')} (ThreatWatch {case.get('risk_score', 'n/a')}/100)",
            f"Type       : {incident_type}",
            "",
            "Summary (디페그 엔진 판정)",
            f"  {case.get('summary', 'n/a')}",
            "",
            "승인 — 대응 실행 (운영자 상황실 유지, 자금팀 노출 축소 검토, 사용자 안내 1회)",
            "Approve — run the response:",
            f"  {approve_url}",
            "",
            "반려 — 오탐·데이터 장애로 판단, 기록만 남김",
            "Reject — false alarm, record only:",
            f"  {reject_url}",
            "",
            f"이 요청은 {hours}시간 뒤 만료됩니다. 무응답도 결과로 기록되고 상급자에게 통지됩니다.",
            f"This request expires in {hours} hours; no answer is recorded and escalated.",
        ]
        return subject, lines

    subject = f"[APPROVAL] {alert_id} requires review"
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
        f"This request expires in {hours} hours.",
        "If no decision is made, the case is escalated automatically.",
    ]
    return subject, lines


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
        # 콜백 경로의 결과 알림이 토픽을 라우팅할 때 필요합니다.
        # 콜백은 이 레코드 말고는 케이스 정보를 갖지 못합니다.
        "incident_type": case.get("incident_type", ""),
        "task_token": task_token,
        "status": "pending",
        "created_at": now,
        "expires_at": now + APPROVAL_TTL_SEC,
    })

    subject, lines = build_message(case, approval_id, CALLBACK_URL)

    _sns.publish(
        TopicArn=TOPIC_ARN,
        Subject=subject[:100],
        Message="\n".join(lines),
    )

    logger.info(f"📨 approval requested: {alert_id} ({approval_id[:8]}...)")

    # 이 함수는 여기서 끝나지만 상태 머신은 계속 대기합니다.
    # 반환값은 사용되지 않습니다.
    return {"approval_id": approval_id}
