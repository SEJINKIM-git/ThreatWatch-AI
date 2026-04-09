"""
08_Demo_Scenario_Switch
발표용 시나리오 전환
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union

from models import WorkflowState, FinalPayload
from scenarios import select_demo_scenario
import logging

logger = logging.getLogger(__name__)


class ScenarioSwitcher:
    """시나리오 전환기"""
    
    @staticmethod
    def switch(state: WorkflowState, scenario_type: Optional[Union[str, Dict[str, Any]]]) -> WorkflowState:
        """시나리오 전환"""
        if isinstance(scenario_type, dict):
            scenario_data = scenario_type
        else:
            selector = scenario_type or "P2"
            scenario_data = select_demo_scenario(
                risk_level=selector if selector in ["P1", "P2", "P3"] else None,
                scenario_id=None if selector in ["P1", "P2", "P3"] else selector,
            )

        expected = scenario_data.get("expected_output", {})
        alert = state.alert_data

        state.final_payload = FinalPayload(
            alert_id=alert.alert_id if alert else f"{scenario_data.get('id', 'demo')}-{int(datetime.now(timezone.utc).timestamp())}",
            timestamp=datetime.now(timezone.utc).isoformat(),
            risk_level=expected.get("risk_level", scenario_data.get("risk_level", "P2")),
            risk_score=expected.get("risk_score", 50),
            incident_type=alert.incident_type if alert else scenario_data.get("input", {}).get("incident_type", "unknown"),
            summary=expected.get("summary", "Scenario processed"),
            missing_data_count=expected.get("missing_data_count", len(expected.get("missing_data_list", []))),
            confidence=expected.get("confidence", 0.5),
        )

        logger.info(f"🎭 Scenario switched to: {scenario_data.get('id')} ({state.final_payload.alert_id})")

        return state
