"""
ThreatWatch AI - Request Authorizer

헤더 기반 HMAC-SHA256 서명을 검증합니다.

서명 대상: "{timestamp}.{nonce}"
헤더:
  x-tw-timestamp : Unix epoch 초
  x-tw-nonce     : 요청마다 고유한 값
  x-tw-signature : HMAC-SHA256(secret, "{timestamp}.{nonce}") 의 hex

한계:
  요청 본문은 서명에 포함되지 않습니다. REST API의 REQUEST 타입 authorizer는
  본문을 전달받지 못하기 때문입니다. 따라서 이 방식은 발신자 인증과
  재전송 방지를 제공하지만 본문 무결성은 보장하지 않습니다.
  본문 변조는 HTTPS와 게이트웨이 스키마 검증에 의존합니다.
"""

import hashlib
import hmac
import logging
import os
import time

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# 허용 시간 창(초). 짧을수록 안전하지만 시계 오차에 민감해집니다.
MAX_SKEW_SEC = 300

REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
SECRET_PARAM = os.environ.get("HMAC_SECRET_PARAM", "/threatwatch/hmac-secret")
NONCE_TABLE = os.environ.get("NONCE_TABLE", "")

_secret = None
_nonce_table = None


def _get_secret() -> str:
    """SSM에서 공유 시크릿을 읽습니다. 콜드스타트에 한 번만 조회됩니다."""
    global _secret
    if _secret is not None:
        return _secret

    import boto3
    client = boto3.client("ssm", region_name=REGION)
    _secret = client.get_parameter(Name=SECRET_PARAM, WithDecryption=True)["Parameter"]["Value"]
    logger.info("🔑 HMAC secret loaded from SSM")
    return _secret


def _get_nonce_table():
    global _nonce_table
    if _nonce_table is not None:
        return _nonce_table

    if not NONCE_TABLE:
        return None

    import boto3
    _nonce_table = boto3.resource("dynamodb", region_name=REGION).Table(NONCE_TABLE)
    return _nonce_table


def _lower_headers(event: dict) -> dict:
    """헤더 이름은 대소문자를 구분하지 않으므로 정규화합니다."""
    return {k.lower(): v for k, v in (event.get("headers") or {}).items()}


def _check_timestamp(raw: str) -> int:
    """타임스탬프가 허용 창 안에 있는지 확인합니다."""
    try:
        ts = int(raw)
    except (TypeError, ValueError):
        raise PermissionError("timestamp is not an integer")

    drift = abs(int(time.time()) - ts)
    if drift > MAX_SKEW_SEC:
        raise PermissionError(f"timestamp outside allowed window ({drift}s)")

    return ts


def _check_signature(timestamp: str, nonce: str, provided: str) -> None:
    """서명을 재계산해 비교합니다."""
    payload = f"{timestamp}.{nonce}".encode("utf-8")
    expected = hmac.new(
        _get_secret().encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()

    # compare_digest는 상수 시간 비교입니다.
    # == 로 비교하면 일치하는 접두사 길이에 따라 응답 시간이 달라져
    # 타이밍 공격으로 서명을 한 바이트씩 추측할 수 있습니다.
    if not hmac.compare_digest(expected, provided):
        raise PermissionError("signature mismatch")


def _consume_nonce(nonce: str, timestamp: int) -> None:
    """
    논스를 소비합니다. 이미 사용된 값이면 거부합니다.

    조건부 쓰기를 쓰기 때문에 동시에 같은 논스로 두 요청이 와도
    하나만 통과합니다.
    """
    table = _get_nonce_table()
    if table is None:
        logger.warning("⚠️ NONCE_TABLE not set - replay protection disabled")
        return

    # 허용 창을 벗어난 요청은 어차피 타임스탬프 검사에서 걸리므로
    # 그 시점까지만 보관하면 됩니다.
    expires_at = timestamp + MAX_SKEW_SEC + 60

    try:
        table.put_item(
            Item={"nonce": nonce, "expires_at": expires_at},
            ConditionExpression="attribute_not_exists(nonce)",
        )
    except Exception as e:
        if type(e).__name__ == "ConditionalCheckFailedException" or \
           "ConditionalCheckFailed" in str(e):
            raise PermissionError("nonce already used")
        logger.error(f"❌ nonce store failed: {e}")
        raise


def _policy(effect: str, resource: str, principal: str = "caller") -> dict:
    return {
        "principalId": principal,
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [{
                "Action": "execute-api:Invoke",
                "Effect": effect,
                "Resource": resource,
            }],
        },
    }


def handler(event, context):
    """API Gateway REQUEST authorizer 진입점."""

    # 캐시를 켤 경우를 대비해 메서드 ARN 전체가 아니라 API 단위로 허용합니다.
    method_arn = event.get("methodArn", "*")

    headers = _lower_headers(event)
    timestamp = headers.get("x-tw-timestamp")
    nonce = headers.get("x-tw-nonce")
    signature = headers.get("x-tw-signature")

    if not (timestamp and nonce and signature):
        logger.warning("missing signature headers")
        # Unauthorized 예외는 401을, Deny 정책은 403을 반환합니다.
        # 헤더 자체가 없으면 인증 시도가 없었던 것이므로 401이 맞습니다.
        raise Exception("Unauthorized")

    try:
        ts = _check_timestamp(timestamp)
        _check_signature(timestamp, nonce, signature)
        _consume_nonce(nonce, ts)
    except PermissionError as e:
        # 실패 사유를 응답에 담지 않습니다.
        # 어느 검사에서 걸렸는지 알려주면 공격자에게 정보를 주게 됩니다.
        logger.warning(f"authorization denied: {e}")
        return _policy("Deny", method_arn)

    logger.info("✅ signature verified")
    return _policy("Allow", method_arn)
