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
        precheck_decision = state.precheck_result.decision if state.precheck_result else None
        
        # P1/P2는 보안 경고 메일, ESCALATE는 담당자 추가 데이터 요청 메일
        should_send = risk_level in ["P1", "P2"] or precheck_decision == "ESCALATE"
        
        if precheck_decision == "ESCALATE":
            logger.info("📧 Missing data escalation - Email request required")
        elif should_send:
            logger.info(f"🚨 {risk_level} - Email escalation required")
        else:
            logger.info(f"📝 {risk_level} - Log only (no email)")
        
        return should_send
