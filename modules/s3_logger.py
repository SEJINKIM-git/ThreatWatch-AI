"""
12_Log_to_S3
S3 감사 로그 적재 (Phase 3에서 Glue/Athena가 읽을 원본 데이터)
"""

import json
import logging
from datetime import datetime, timezone
from models import WorkflowState
from config import Config

logger = logging.getLogger(__name__)


class S3AuditLogger:
    """S3 감사 로거"""

    def __init__(self):
        self.client = None

        if Config.S3_AUDIT_BUCKET:
            try:
                import boto3
                self.client = boto3.client('s3', region_name=Config.AWS_REGION)
            except Exception as e:
                logger.warning(f"⚠️ S3 client init failed: {e}")

    def log_incident(self, state: WorkflowState) -> bool:
        """사건 로그 S3 적재 (DEMO_MODE에서도 기록, 데모 여부는 컬럼으로 남긴다)"""

        payload = state.final_payload
        ingested_at = datetime.now(timezone.utc).isoformat()

        record = {
            "timestamp": payload.timestamp,
            "alert_id": payload.alert_id,
            "risk_level": payload.risk_level,
            "risk_score": payload.risk_score,
            "incident_type": payload.incident_type,
            "summary": payload.summary,
            "missing_data_count": payload.missing_data_count,
            "confidence": payload.confidence,
            "demo_mode": Config.DEMO_MODE,
            "ingested_at": ingested_at,
        }

        if not Config.S3_AUDIT_BUCKET or not self.client:
            logger.info("📝 [S3 SKIP] S3_AUDIT_BUCKET not set — would write:")
            logger.info(f"   {json.dumps(record, ensure_ascii=False)}")
            return True

        # Hive 스타일 dt= 파티션 (Athena 파티션 인식용)
        dt = ingested_at[:10]
        key = f"cases/dt={dt}/{payload.alert_id}.json"

        # Athena JSON SerDe가 읽을 수 있도록 한 줄 JSON + 개행
        body = json.dumps(record, ensure_ascii=False) + "\n"

        try:
            self.client.put_object(
                Bucket=Config.S3_AUDIT_BUCKET,
                Key=key,
                Body=body.encode("utf-8"),
                ContentType="application/json",
            )
            logger.info(f"✅ Logged to S3: s3://{Config.S3_AUDIT_BUCKET}/{key}")
            return True
        except Exception as e:
            logger.error(f"❌ S3 logging failed: {e}")
            return False
