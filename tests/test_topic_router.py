"""
알림 토픽 라우팅 테스트
"""

from topic_router import resolve_topic_arn

DEFAULT_ARN = "arn:aws:sns:ap-northeast-2:000000000000:threatwatch-escalations"
DEPEG_ARN = "arn:aws:sns:ap-northeast-2:000000000000:threatwatch-depeg-alerts"


def test_depeg_incident_goes_to_depeg_topic(monkeypatch):
    monkeypatch.setenv("TOPIC_ARN", DEFAULT_ARN)
    monkeypatch.setenv("DEPEG_TOPIC_ARN", DEPEG_ARN)
    assert resolve_topic_arn("stablecoin_depeg_risk_usdc") == DEPEG_ARN


def test_security_incident_goes_to_default_topic(monkeypatch):
    monkeypatch.setenv("TOPIC_ARN", DEFAULT_ARN)
    monkeypatch.setenv("DEPEG_TOPIC_ARN", DEPEG_ARN)
    assert resolve_topic_arn("privileged_account_compromise") == DEFAULT_ARN


def test_missing_depeg_arn_falls_back_to_default(monkeypatch, caplog):
    # 배포 전 로컬 실행에서 DEPEG_TOPIC_ARN이 없어도 깨지지 않아야 합니다.
    monkeypatch.setenv("TOPIC_ARN", DEFAULT_ARN)
    monkeypatch.delenv("DEPEG_TOPIC_ARN", raising=False)

    with caplog.at_level("WARNING"):
        arn = resolve_topic_arn("stablecoin_depeg_risk_usdc")

    assert arn == DEFAULT_ARN
    assert any("DEPEG_TOPIC_ARN" in r.message for r in caplog.records)
