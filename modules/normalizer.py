"""
07_Normalize_Final_Payload
최종 데이터 정규화
"""

from models import WorkflowState, FinalPayload
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class PayloadNormalizer:
    """데이터 정규화"""
    
    @staticmethod
    def normalize(state: WorkflowState) -> WorkflowState:
        """최종 페이로드 생성"""
        
        ai_result = state.ai_result
        alert = state.alert_data
        
        # 요약 생성
        summary = " ".join(ai_result.summary_bullets) if ai_result.summary_bullets else "No summary available"
        
        final_payload = FinalPayload(
            alert_id=alert.alert_id,
            timestamp=datetime.now().isoformat(),
            risk_level=ai_result.risk_level,
            risk_score=ai_result.risk_score,
            incident_type=alert.incident_type,
            summary=summary,
            missing_data_count=len(ai_result.missing_data_list),
            confidence=ai_result.confidence
        )
        
        state.final_payload = final_payload
        
        logger.info(f"📦 Payload normalized: {final_payload.risk_level}")
        
        return state
