"""
09_Risk_Decision
위험도 기반 라우팅
"""

from models import WorkflowState
import logging

logger = logging.getLogger(__name__)


class DecisionRouter:
    """의사결정 라우터"""
    
    @staticmethod
    def should_send_email(state: WorkflowState) -> bool:
        """이메일 발송 여부 결정"""
        
        risk_level = state.final_payload.risk_level
        
        # P1, P2는 이메일 발송
        should_send = risk_level in ["P1", "P2"]
        
        if should_send:
            logger.info(f"🚨 {risk_level} - Email escalation required")
        else:
            logger.info(f"📝 {risk_level} - Log only (no email)")
        
        return should_send
