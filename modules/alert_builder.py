"""
02_Build_Alert_Data
"""

from datetime import datetime, timezone
import sys
import os
from typing import Any, Dict, Optional
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import AlertData, WorkflowState
import logging

logger = logging.getLogger(__name__)


class AlertBuilder:
    """보안 알림 빌더"""
    
    @staticmethod
    def build_demo_alert(scenario: Optional[Dict[str, Any]] = None) -> WorkflowState:
        """데모 알림 생성"""
        
        now_iso = datetime.now(timezone.utc)

        scenario_input = (scenario or {}).get("input", {})
        default_values = {
            "alert_id": "A-1001",
            "timestamp": now_iso,
            "severity": "medium",
            "asset_criticality": "medium",
            "pii_flag": True,
            "user_role": "Privileged",
            "incident_type": "credential_stuffing_admin_compromise",
            "indicators": [
                "multiple_failed_logins_spike",
                "successful_login_after_failures",
                "impossible_travel",
                "privileged_account_used",
                "pii_database_access",
                "potential_data_exfiltration",
            ],
            "description": "Multiple failed login attempts followed by successful authentication",
        }

        alert_values = default_values.copy()
        for key, value in scenario_input.items():
            if value is not None:
                alert_values[key] = value

        if scenario:
            scenario_name = scenario.get("id", "demo").replace("-", "_").upper()
            alert_values["alert_id"] = f"A-{scenario_name}-{int(now_iso.timestamp())}"

        alert_data = AlertData(**alert_values)

        logger.info(f"✅ Demo alert created: {alert_data.alert_id}")

        state = WorkflowState(
            alert_data=alert_data,
            retry_count=(scenario or {}).get("precheck", {}).get("retry_count", 0),
        )
        return state

    @staticmethod
    def build_from_payload(payload: Dict[str, Any]) -> WorkflowState:
        """실제 알림 페이로드로 상태 생성 (Lambda 경로)"""

        now = datetime.now(timezone.utc)

        alert_data = AlertData(
            alert_id=payload.get("alert_id") or f"A-{int(now.timestamp())}",
            timestamp=payload.get("timestamp") or now,
            severity=payload.get("severity", "medium"),
            asset_criticality=payload.get("asset_criticality", "medium"),
            pii_flag=bool(payload.get("pii_flag", False)),
            user_role=payload.get("user_role", "Standard"),
            incident_type=payload.get("incident_type", "unknown"),
            indicators=payload.get("indicators") or [],
            description=payload.get("description"),
        )

        logger.info(f"✅ Alert built from payload: {alert_data.alert_id}")
        return WorkflowState(alert_data=alert_data, retry_count=0)
