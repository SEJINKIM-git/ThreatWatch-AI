"""
승인 콜백

이메일 링크에서 GET으로 호출됩니다.
브라우저는 커스텀 헤더를 붙일 수 없으므로 HMAC 서명을 요구할 수 없습니다.
대신 approval_id 자체가 인증 수단입니다:
  - secrets.token_urlsafe(32) 로 생성된 추측 불가능한 값
  - 조건부 업데이트로 일회용 보장
  - DynamoDB TTL로 만료
"""

import json
import logging
import os
import time

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
APPROVALS_TABLE = os.environ["APPROVALS_TABLE"]

VALID_DECISIONS = ("approve", "reject")

_table = boto3.resource("dynamodb", region_name=REGION).Table(APPROVALS_TABLE)
_sfn = boto3.client("stepfunctions", region_name=REGION)


def _page(status_code: int, title: str, detail: str) -> dict:
    """브라우저에 표시할 최소한의 HTML."""
    html = (
        "<!doctype html><meta charset=utf-8>"
        "<title>ThreatWatch</title>"
        "<div style='font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem'>"
        f"<h1 style='font-size:1.25rem'>{title}</h1>"
        f"<p style='color:#555'>{detail}</p>"
        "</div>"
    )
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "text/html; charset=utf-8"},
        "body": html,
    }


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    approval_id = params.get("id")
    decision = params.get("decision")

    if not approval_id or decision not in VALID_DECISIONS:
        logger.warning("malformed callback")
        return _page(400, "Invalid request", "The link appears to be malformed.")

    # 조건부 업데이트로 상태를 소비합니다.
    # 두 번 클릭하거나 링크가 공유되어도 첫 요청만 반영됩니다.
    try:
        result = _table.update_item(
            Key={"approval_id": approval_id},
            UpdateExpression="SET #s = :new, decided_at = :now",
            ConditionExpression="attribute_exists(approval_id) AND #s = :pending",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":new": decision,
                ":pending": "pending",
                ":now": int(time.time()),
            },
            ReturnValues="ALL_NEW",
        )
    except Exception as e:
        if type(e).__name__ == "ConditionalCheckFailedException" or \
           "ConditionalCheckFailed" in str(e):
            # 이미 처리됐거나 만료된 링크입니다.
            # 어느 쪽인지 구분해서 알려주지 않습니다.
            logger.info(f"callback rejected: {approval_id[:8]}...")
            return _page(
                409,
                "Already handled",
                "This request has already been decided or has expired.",
            )
        logger.error(f"❌ approval update failed: {e}")
        return _page(500, "Error", "Could not process the decision.")

    item = result["Attributes"]
    task_token = item["task_token"]
    alert_id = item.get("alert_id", "unknown")

    payload = {
        "case": {"alert_id": alert_id},
        "decision": decision,
    }

    # 상태 머신을 재개시킵니다.
    # 거부도 실패가 아니라 정상적인 결과이므로 SendTaskSuccess를 씁니다.
    # SendTaskFailure는 워크플로 자체의 오류에만 사용합니다.
    try:
        _sfn.send_task_success(
            taskToken=task_token,
            output=json.dumps(payload),
        )
    except Exception as e:
        logger.error(f"❌ send_task_success failed: {e}")
        return _page(
            500,
            "Error",
            "The decision was recorded but the workflow could not be resumed.",
        )

    logger.info(f"✅ {decision}: {alert_id}")

    verb = "approved" if decision == "approve" else "rejected"
    return _page(
        200,
        f"Case {verb}",
        f"{alert_id} has been {verb}. You can close this window.",
    )
