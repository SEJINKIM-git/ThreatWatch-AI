"""
트리아지 파이프라인의 디페그 우회 분기 테스트

lambda_handler.process_record를 실제로 통과시키되
AWS 클라이언트와 LLM 호출부만 mock으로 바꿉니다.
"""

import json
from unittest.mock import MagicMock

import pytest

import lambda_handler
from models import AIAnalysisResult
from modules.external_scored import UnknownSeverityError


def _record(severity, incident_type):
    return {
        "messageId": "test-message",
        "body": json.dumps({
            "alert_id": f"A-TEST-{incident_type}-{severity}",
            "incident_type": incident_type,
            "severity": severity,
            "description": "test alert",
        }),
    }


def _llm_result():
    return AIAnalysisResult(
        summary_bullets=["mocked LLM assessment"],
        risk_level="P2",
        risk_score=55,
        rationale=["mocked"],
        recommended_actions=["mocked"],
        missing_data_list=[],
        confidence=0.8,
    )


@pytest.fixture
def pipeline(monkeypatch):
    """LLM과 AWS 의존부를 mock으로 바꾼 파이프라인."""

    def fake_analyze(state):
        state.ai_result = _llm_result()
        return state

    analyzer = MagicMock()
    analyzer.analyze.side_effect = fake_analyze

    store = MagicMock()
    store.put_case.return_value = True

    monkeypatch.setattr(lambda_handler, "_analyzer", analyzer)
    monkeypatch.setattr(lambda_handler, "_store", store)
    monkeypatch.setattr(lambda_handler, "_audit", MagicMock())
    monkeypatch.setattr(lambda_handler, "_notifier", MagicMock())
    monkeypatch.setattr(lambda_handler, "_start_approval", MagicMock())
    # STATE_MACHINE_ARN 유무와 무관하게 P1 분기가 mock을 타게 합니다.
    monkeypatch.setenv("STATE_MACHINE_ARN", "arn:aws:states:test")

    return analyzer, store


def _stored_state(store):
    return store.put_case.call_args.args[0]


def test_depeg_high_maps_to_p1_without_llm(pipeline):
    analyzer, store = pipeline

    lambda_handler.process_record(_record("high", "stablecoin_depeg_risk_usdc"))

    analyzer.analyze.assert_not_called()
    state = _stored_state(store)
    assert state.final_payload.risk_level == "P1"
    assert state.ai_result.confidence == 1.0


def test_depeg_medium_maps_to_p2_without_llm(pipeline):
    analyzer, store = pipeline

    lambda_handler.process_record(_record("medium", "stablecoin_depeg_risk_usdt"))

    analyzer.analyze.assert_not_called()
    assert _stored_state(store).final_payload.risk_level == "P2"


def test_depeg_unknown_severity_raises(pipeline):
    analyzer, store = pipeline

    with pytest.raises(UnknownSeverityError):
        lambda_handler.process_record(_record("critical", "stablecoin_depeg_risk_usdc"))

    analyzer.analyze.assert_not_called()
    store.put_case.assert_not_called()


def test_security_alert_still_uses_llm(pipeline):
    analyzer, store = pipeline

    lambda_handler.process_record(_record("high", "privileged_account_compromise"))

    analyzer.analyze.assert_called_once()
    assert _stored_state(store).final_payload.risk_level == "P2"  # mock LLM 판정
