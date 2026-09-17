"""
외부 사전 평가 경보 매핑의 순수 함수 테스트
"""

import pytest

from models import AlertData
from modules.external_scored import (
    UnknownSeverityError,
    build_assessment_from_severity,
    is_external_scored,
)


def _alert(severity, incident_type="stablecoin_depeg_risk_usdc", description=None):
    return AlertData(
        alert_id="A-TEST-0001",
        severity=severity,
        incident_type=incident_type,
        description=description,
    )


class TestIsExternalScored:
    def test_depeg_prefix_matches(self):
        assert is_external_scored("stablecoin_depeg_risk_usdc")
        assert is_external_scored("stablecoin_depeg_risk_usdt")

    def test_security_incident_does_not_match(self):
        assert not is_external_scored("privileged_account_compromise")
        assert not is_external_scored("unknown")

    def test_non_string_does_not_match(self):
        assert not is_external_scored(None)


class TestBuildAssessmentFromSeverity:
    def test_high_maps_to_p1(self):
        result = build_assessment_from_severity(_alert("high"))
        assert result.risk_level == "P1"

    def test_medium_maps_to_p2(self):
        result = build_assessment_from_severity(_alert("medium"))
        assert result.risk_level == "P2"

    def test_low_maps_to_p3(self):
        result = build_assessment_from_severity(_alert("low"))
        assert result.risk_level == "P3"

    def test_deterministic_mapping_has_full_confidence(self):
        result = build_assessment_from_severity(_alert("high"))
        assert result.confidence == 1.0
        assert result.missing_data_list == []

    def test_summary_marks_external_origin_and_keeps_description(self):
        result = build_assessment_from_severity(
            _alert("medium", description="USDC deviated 1.2% from peg")
        )
        joined = " ".join(result.summary_bullets).lower()
        assert "depeg engine" in joined
        assert "USDC deviated 1.2% from peg" in result.summary_bullets

    def test_unknown_severity_raises_instead_of_falling_back(self):
        # 게이트웨이 enum은 critical도 통과시키지만 매핑에는 없습니다.
        # 조용히 P3로 저장하는 대신 실패해야 합니다.
        with pytest.raises(UnknownSeverityError):
            build_assessment_from_severity(_alert("critical"))

    def test_empty_severity_raises(self):
        with pytest.raises(UnknownSeverityError):
            build_assessment_from_severity(_alert(""))
