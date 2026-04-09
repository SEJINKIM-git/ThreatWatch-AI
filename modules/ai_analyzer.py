"""
04_LLM_Risk_Assessment
AI 위험도 분석
"""

from anthropic import Anthropic
from models import WorkflowState, AIAnalysisResult
from config import Config
import logging
import json

logger = logging.getLogger(__name__)


class AIAnalyzer:
    """AI 분석 엔진"""
    
    def __init__(self):
        self.client = Anthropic(api_key=Config.ANTHROPIC_API_KEY) if Config.ANTHROPIC_API_KEY else None
    
    def analyze(self, state: WorkflowState) -> WorkflowState:
        """AI 위험도 분석"""
        
        if Config.DEMO_MODE or not self.client:
            logger.info("🎭 Demo mode - using mock AI response")
            return self._mock_analysis(state)
        
        alert = state.alert_data
        
        prompt = self._build_prompt(alert)
        
        try:
            logger.info("🤖 Calling Claude API...")
            
            message = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1000,
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )
            
            # 응답 파싱
            response_text = message.content[0].text
            
            # JSON 추출
            cleaned = response_text.replace('```json', '').replace('```', '').strip()
            ai_result = json.loads(cleaned)
            
            state.ai_result = AIAnalysisResult(**ai_result)
            
            logger.info(f"✅ AI Analysis: {state.ai_result.risk_level} ({state.ai_result.risk_score}/100)")
            
        except Exception as e:
            logger.error(f"❌ AI Analysis failed: {e}")
            state.ai_result = self._fallback_analysis(alert)
        
        return state
    
    def _build_prompt(self, alert) -> str:
        """AI 프롬프트 생성"""
        return f"""You are a security analyst. Analyze this security alert and provide a risk assessment.

Alert Details:
- ID: {alert.alert_id}
- Type: {alert.incident_type}
- Severity: {alert.severity}
- User Role: {alert.user_role}
- Asset Criticality: {alert.asset_criticality}
- PII Involved: {alert.pii_flag}
- Indicators: {', '.join(alert.indicators)}

Return ONLY a JSON object with this exact structure:
{{
  "summary_bullets": ["bullet 1", "bullet 2"],
  "risk_level": "P1" or "P2" or "P3",
  "risk_score": 0-100,
  "rationale": ["reason 1", "reason 2"],
  "recommended_actions": ["action 1", "action 2"],
  "missing_data_list": ["field1", "field2"],
  "confidence": 0.0-1.0
}}"""
    
    def _mock_analysis(self, state: WorkflowState) -> WorkflowState:
        """데모용 Mock 분석"""
        state.ai_result = AIAnalysisResult(
            summary_bullets=[
                "Privileged account compromise detected",
                "Multiple failed login attempts from unusual location",
                "Successful authentication after failures"
            ],
            risk_level="P1",
            risk_score=95,
            rationale=[
                "Privileged account targeted",
                "Impossible travel indicator",
                "PII database accessed"
            ],
            recommended_actions=[
                "Disable compromised account immediately",
                "Review access logs",
                "Initiate incident response"
            ],
            missing_data_list=["source_ip", "destination_ip"],
            confidence=0.85
        )
        return state
    
    def _fallback_analysis(self, alert) -> AIAnalysisResult:
        """AI 실패 시 대체 분석"""
        return AIAnalysisResult(
            summary_bullets=["Alert detected"],
            risk_level="P2",
            risk_score=50,
            rationale=["AI analysis unavailable"],
            recommended_actions=["Manual review required"],
            missing_data_list=[],
            confidence=0.5
        )
