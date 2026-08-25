"""
케이스 조회 API

GET /cases                    최근 케이스 목록
GET /cases?risk_level=P1      위험도 필터 (GSI 사용)
GET /cases/{alert_id}         단건 상세

읽기 전용입니다. 쓰기 권한은 부여하지 않습니다.
"""

import json
import logging
import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
TABLE_NAME = os.environ["TABLE_NAME"]

DEFAULT_LIMIT = 20
MAX_LIMIT = 100
VALID_LEVELS = ("P1", "P2", "P3")

_table = boto3.resource("dynamodb", region_name=REGION).Table(TABLE_NAME)


class _DecimalEncoder(json.JSONEncoder):
    """DynamoDB는 숫자를 Decimal로 돌려주는데 JSON이 이를 직렬화하지 못합니다."""

    def default(self, o):
        if isinstance(o, Decimal):
            # 정수는 정수로 유지합니다. risk_score가 92.0으로 나오면 어색합니다.
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)


def _response(status: int, body) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            # 프록시(Vercel Function)를 통해 호출되므로 브라우저 CORS는
            # 실제로 필요하지 않습니다. 직접 호출 디버깅용으로만 열어둡니다.
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(body, cls=_DecimalEncoder, ensure_ascii=False),
    }


def _parse_limit(raw) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_LIMIT
    return max(1, min(n, MAX_LIMIT))


def _get_one(alert_id: str) -> dict:
    result = _table.get_item(Key={"alert_id": alert_id})
    item = result.get("Item")

    if not item:
        return _response(404, {"error": "case not found"})

    return _response(200, {"case": item})


def _list_by_level(level: str, limit: int) -> dict:
    """
    GSI로 특정 위험도의 케이스를 최신순 조회합니다.
    파티션 키(alert_id)만으로는 불가능한 접근 패턴입니다.
    """
    result = _table.query(
        IndexName="risk-level-index",
        KeyConditionExpression=Key("risk_level").eq(level),
        # created_at이 정렬 키이므로 역순이 곧 최신순입니다.
        ScanIndexForward=False,
        Limit=limit,
    )
    return _response(200, {
        "cases": result.get("Items", []),
        "count": result.get("Count", 0),
        "filter": {"risk_level": level},
    })


def _list_all(limit: int) -> dict:
    """
    필터 없는 조회는 Scan을 씁니다.

    Scan은 테이블 전체를 읽으므로 대규모 데이터에서는 부적절합니다.
    이 프로젝트의 데이터 규모에서는 문제가 없지만, 운영 환경이라면
    날짜 파티션을 키로 하는 별도 GSI가 필요합니다.
    """
    result = _table.scan(Limit=limit)
    items = result.get("Items", [])

    # Scan은 순서를 보장하지 않으므로 애플리케이션 레벨에서 정렬합니다.
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    return _response(200, {
        "cases": items,
        "count": len(items),
    })


def handler(event, context):
    path_params = event.get("pathParameters") or {}
    query = event.get("queryStringParameters") or {}

    alert_id = path_params.get("alert_id")

    try:
        if alert_id:
            return _get_one(alert_id)

        limit = _parse_limit(query.get("limit"))
        level = query.get("risk_level")

        if level:
            if level not in VALID_LEVELS:
                return _response(400, {"error": f"risk_level must be one of {list(VALID_LEVELS)}"})
            return _list_by_level(level, limit)

        return _list_all(limit)

    except Exception as e:
        logger.exception(f"query failed: {e}")
        # 내부 오류 상세를 클라이언트에 노출하지 않습니다.
        return _response(500, {"error": "internal error"})
