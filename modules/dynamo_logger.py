"""
11_Store_Case_DynamoDB
케이스 상태를 DynamoDB에 저장합니다.

alert_id 조건부 쓰기로 멱등성을 보장합니다.
SQS는 at-least-once라 같은 메시지가 두 번 전달될 수 있는데,
두 번째 시도는 여기서 막혀 알림이 중복 발송되지 않습니다.
"""

import logging
import os
from datetime import datetime, timezone
from decimal import Decimal

from models import WorkflowState

logger = logging.getLogger(__name__)


class DynamoCaseStore:
    """DynamoDB 케이스 저장소"""

    def __init__(self):
        self.table_name = os.getenv("TABLE_NAME", "threatwatch-cases")
        self.region = os.getenv("AWS_REGION", "ap-northeast-2")
        self.table = None

        try:
            import boto3
            self.table = boto3.resource(
                "dynamodb", region_name=self.region
            ).Table(self.table_name)
        except Exception as e:
            logger.warning(f"⚠️ DynamoDB init failed: {e}")

    def put_case(self, state: WorkflowState) -> bool:
        """
        케이스를 저장합니다.
        새 케이스면 True, 이미 존재하면 False를 반환합니다.
        """

        payload = state.final_payload

        item = {
            "alert_id": payload.alert_id,
            "created_at": payload.timestamp,
            "risk_level": payload.risk_level,
            "risk_score": payload.risk_score,
            "incident_type": payload.incident_type,
            "summary": payload.summary,
            "missing_data_count": payload.missing_data_count,
            # DynamoDB는 float를 받지 않습니다. str 경유 Decimal이 정확합니다.
            "confidence": Decimal(str(payload.confidence)),
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        }

        if not self.table:
            logger.info(f"📝 [DDB SKIP] Would store {payload.alert_id}")
            return True

        try:
            self.table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(alert_id)",
            )
            logger.info(f"✅ Stored case: {payload.alert_id}")
            return True
        except Exception as e:
            if type(e).__name__ == "ConditionalCheckFailedException" or \
               "ConditionalCheckFailed" in str(e):
                logger.info(f"↩️ Duplicate case ignored: {payload.alert_id}")
                return False
            logger.error(f"❌ DynamoDB write failed: {e}")
            raise
