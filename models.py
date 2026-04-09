"""
데이터 모델 정의
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime

class AlertData(BaseModel):
    """02_Build_Alert_Data 출력"""
    alert_id: str = "UNKNOWN"
    timestamp: datetime = Field(default_factory=datetime.now)
    severity: str = "medium"
    asset_criticality: str = "medium"
    pii_flag: bool = False
    user_role: str = "Standard"
    incident_type: str = "unknown"
    indicators: List[str] = Field(default_factory=list)
    description: Optional[str] = None

class AIAnalysisResult(BaseModel):
    """04_LLM_Risk_Assessment 출력"""
    summary_bullets: List[str]
    risk_level: Literal["P1", "P2", "P3"]
    risk_score: int = Field(ge=0, le=100)
    rationale: List[str]
    recommended_actions: List[str]
    missing_data_list: List[str]
    confidence: float = Field(ge=0, le=1)

class PreCheckResult(BaseModel):
    """03_PreCheck 출력"""
    has_enough_data: bool
    missing_critical: List[str]
    missing_important: List[str]
    total_missing: int
    can_retry: bool
    decision: Literal["PROCEED", "RETRY", "ESCALATE"]

class FinalPayload(BaseModel):
    """07_Normalize_Final_Payload 출력"""
    alert_id: str
    timestamp: str
    risk_level: Literal["P1", "P2", "P3"]
    risk_score: int
    incident_type: str
    summary: str
    missing_data_count: int
    confidence: float

class WorkflowState(BaseModel):
    """전체 워크플로우 상태"""
    retry_count: int = 0
    alert_data: Optional[AlertData] = None
    precheck_result: Optional[PreCheckResult] = None
    ai_result: Optional[AIAnalysisResult] = None
    final_payload: Optional[FinalPayload] = None
    enrichment_attempts: List[str] = Field(default_factory=list)
