"""
05_Parse_LLM_Output
AI 응답 파싱
"""

import json
import re
import logging

logger = logging.getLogger(__name__)


class LLMOutputParser:
    """AI 응답 파서"""
    
    @staticmethod
    def parse(ai_response: dict) -> dict:
        """Claude API 응답 파싱"""
        
        try:
            # 텍스트 추출
            raw_text = LLMOutputParser._extract_text(ai_response)
            
            # Markdown 제거
            cleaned = re.sub(r'```json|```', '', raw_text).strip()
            
            # JSON 파싱
            parsed = json.loads(cleaned)
            
            logger.info("✅ AI response parsed successfully")
            return parsed
            
        except Exception as e:
            logger.warning(f"⚠️ Parsing failed: {e}")
            return {"summary_text": str(ai_response)}
    
    @staticmethod
    def _extract_text(response: dict) -> str:
        """응답에서 텍스트 추출"""
        try:
            return response['output'][0]['content'][0]['text']
        except:
            return ''
