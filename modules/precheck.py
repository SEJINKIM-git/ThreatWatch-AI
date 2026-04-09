"""
03_PreCheck
데이터 충분성 검증
"""

from models import WorkflowState, PreCheckResult
import logging

logger = logging.getLogger(__name__)


class PreCheckValidator:
    """데이터 사전 검증"""
    
    @staticmethod
    def check(state: WorkflowState) -> WorkflowState:
        """데이터 충분성 체크"""
        
        alert = state.alert_data
        
        # 필수 필드
        critical_fields = {
            "alert_id": alert.alert_id,
            "timestamp": alert.timestamp,
            "incident_type": alert.incident_type
        }
        
        # 중요 필드
        important_fields = {
            "user_role": alert.user_role,
            "asset_criticality": alert.asset_criticality,
            "severity": alert.severity
        }
        
        missing_critical = [k for k, v in critical_fields.items() if not v or v == "UNKNOWN"]
        missing_important = [k for k, v in important_fields.items() if not v or v == "UNKNOWN"]
        
        total_missing = len(missing_critical) + len(missing_important)
        has_enough = len(missing_critical) == 0 and len(missing_important) <= 2
        can_retry = state.retry_count < 3
        
        decision = "PROCEED" if has_enough else ("RETRY" if can_retry else "ESCALATE")
        
        result = PreCheckResult(
            has_enough_data=has_enough,
            missing_critical=missing_critical,
            missing_important=missing_important,
            total_missing=total_missing,
            can_retry=can_retry,
            decision=decision
        )
        
        state.precheck_result = result
        
        logger.info(f"📋 PreCheck: {decision} (missing: {total_missing})")
        
        return state
