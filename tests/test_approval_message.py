"""승인 요청 메일 문구 — 디페그 경보는 '대응 실행' 결정, 보안 경보는 기존 '격리' 문구 유지."""
import os

os.environ.setdefault("APPROVALS_TABLE", "test-approvals")
os.environ.setdefault("TOPIC_ARN", "arn:aws:sns:ap-northeast-2:000000000000:test")
os.environ.setdefault("CALLBACK_URL", "https://example.invalid/approvals/callback")
os.environ.setdefault("AWS_REGION", "ap-northeast-2")

import approval_request  # noqa: E402
import topic_router  # noqa: E402

URL = "https://example.invalid/cb"


def test_prefix_matches_topic_router():
    assert approval_request.DEPEG_PREFIX == topic_router.DEPEG_PREFIX


def test_depeg_message_asks_for_response_not_containment():
    case = {"alert_id": "fed175d0-aaaa", "risk_level": "P1", "risk_score": 90,
            "incident_type": "stablecoin_depeg_risk_usdc",
            "summary": "[DEMO SIMULATION] USDC depeg risk score 93.7"}
    subject, lines = approval_request.build_message(case, "tok", URL)
    body = "\n".join(lines)
    assert subject.startswith("[APPROVAL] Depeg alert fed175d0")
    assert "containment" not in body.lower()
    assert f"{URL}?id=tok&decision=approve" in body
    assert f"{URL}?id=tok&decision=reject" in body
    assert "93.7" in body  # 엔진 원래 점수는 summary 로 전달된다
    # SNS 제목 제약: ASCII, 100자 미만, 줄바꿈 없음
    assert subject.isascii() and len(subject) < 100 and "\n" not in subject


def test_security_message_unchanged():
    case = {"alert_id": "A-1", "risk_score": 95, "incident_type": "ransomware", "summary": "s"}
    subject, lines = approval_request.build_message(case, "tok", URL)
    assert subject == "[APPROVAL] A-1 requires review" and subject.isascii()
    assert "Approve containment:" in lines
