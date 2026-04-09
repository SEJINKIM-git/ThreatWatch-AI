#!/usr/bin/env python3
"""
ThreatWatch AI - Main Workflow
"""

import logging
import sys
from config import Config
from scenarios import select_demo_scenario
from modules.alert_builder import AlertBuilder
from modules.precheck import PreCheckValidator
from modules.ai_analyzer import AIAnalyzer
from modules.normalizer import PayloadNormalizer
from modules.scenario_switch import ScenarioSwitcher
from modules.decision_router import DecisionRouter
from modules.email_notifier import EmailNotifier
from modules.sheets_logger import GoogleSheetsLogger

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)


def print_header(title: str):
    """섹션 헤더"""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)


def print_step(step_num: int, step_name: str):
    """단계 출력"""
    print(f"\n▶️  Step {step_num:02d}: {step_name}")


def run_workflow(demo_scenario: str = "P1"):
    """워크플로우 실행"""
    selected_scenario = select_demo_scenario(
        risk_level=demo_scenario if demo_scenario in ["P1", "P2", "P3"] else None,
        scenario_id=None if demo_scenario in ["P1", "P2", "P3"] else demo_scenario,
    )

    print_header("🛡️  ThreatWatch AI - Python Workflow")
    print(f"Demo Scenario: {selected_scenario['label']} ({selected_scenario['id']})")
    
    try:
        # Step 02
        print_step(2, "Building Alert Data")
        builder = AlertBuilder()
        state = builder.build_demo_alert(selected_scenario)
        print(f"   ✅ Alert: {state.alert_data.alert_id}")
        
        # Step 03
        print_step(3, "PreCheck")
        validator = PreCheckValidator()
        state = validator.check(state)
        print(f"   ✅ Decision: {state.precheck_result.decision}")
        
        # Step 04
        print_step(4, "AI Risk Assessment")
        analyzer = AIAnalyzer()
        state = analyzer.analyze(state)
        print(f"   🤖 Risk: {state.ai_result.risk_level} ({state.ai_result.risk_score}/100)")
        
        # Step 07
        print_step(7, "Normalize Payload")
        normalizer = PayloadNormalizer()
        state = normalizer.normalize(state)
        print(f"   📦 Payload created")
        
        # Step 08
        print_step(8, f"Demo Switch → {selected_scenario['label']}")
        switcher = ScenarioSwitcher()
        state = switcher.switch(state, selected_scenario)
        print(f"   🎭 Switched to {state.final_payload.risk_level}")
        
        # Step 09
        print_step(9, "Risk Decision")
        router = DecisionRouter()
        should_email = router.should_send_email(state)
        
        # Step 10
        if should_email:
            print_step(10, "Sending Email")
            notifier = EmailNotifier()
            notifier.send_alert(state)
        
        # Step 11
        print_step(11, "Logging to Sheets")
        sheets_logger = GoogleSheetsLogger()
        sheets_logger.log_incident(state)
        
        print_header("✅ Workflow Complete!")
        print(f"Alert: {state.final_payload.alert_id}")
        print(f"Risk: {state.final_payload.risk_level} ({state.final_payload.risk_score}/100)")
        print(f"Email: {'Yes' if should_email else 'No'}")
        print("=" * 70)
        
        return state
        
    except Exception as e:
        logger.error(f"❌ Error: {e}", exc_info=True)
        raise


def main():
    """메인 함수"""
    scenario = sys.argv[1] if len(sys.argv) > 1 else "P1"
    
    if scenario in ["-h", "--help"]:
        print("Usage: python main.py [P1|P2|P3|scenario-id]")
        return
    
    run_workflow(demo_scenario=scenario)


if __name__ == "__main__":
    main()
