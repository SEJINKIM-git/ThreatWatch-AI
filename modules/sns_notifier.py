"""
10_Send_Alert_SNS
에스컬레이션 알림을 SNS로 발행합니다.
email_notifier.py(SMTP)의 Lambda 대체 구현입니다.
"""

import logging
import os

from models import WorkflowState

logger = logging.getLogger(__name__)


class SNSNotifier:
    """SNS 알림 발행기"""

    def __init__(self):
        self.topic_arn = os.getenv("TOPIC_ARN", "")
        self.region = os.getenv("AWS_REGION", "ap-northeast-2")
        self.client = None

        if not self.topic_arn:
            logger.warning("⚠️ TOPIC_ARN not set - SNS disabled")
            return

        try:
            import boto3
            self.client = boto3.client("sns", region_name=self.region)
        except Exception as e:
            logger.warning(f"⚠️ SNS client init failed: {e}")

    def send_alert(self, state: WorkflowState) -> bool:
        """에스컬레이션 알림을 발행합니다."""

        payload = state.final_payload
        ai = state.ai_result

        subject = f"[{payload.risk_level}] Security Alert - {payload.incident_type}"[:100]

        lines = [
            f"Alert ID   : {payload.alert_id}",
            f"Risk Level : {payload.risk_level} ({payload.risk_score}/100)",
            f"Type       : {payload.incident_type}",
            f"Confidence : {payload.confidence}",
            f"Detected   : {payload.timestamp}",
            "",
            "Summary",
            f"  {payload.summary}",
        ]

        if ai and ai.recommended_actions:
            lines += ["", "Recommended Actions"]
            lines += [f"  - {a}" for a in ai.recommended_actions]

        if payload.missing_data_count:
            lines += ["", f"Missing data points: {payload.missing_data_count}"]

        message = "\n".join(lines)

        if not self.client:
            logger.info(f"📧 [SNS SKIP] Would publish: {subject}")
            return True

        try:
            self.client.publish(
                TopicArn=self.topic_arn,
                Subject=subject,
                Message=message,
            )
            logger.info(f"✅ Published to SNS: {payload.alert_id}")
            return True
        except Exception as e:
            logger.error(f"❌ SNS publish failed: {e}")
            raise
