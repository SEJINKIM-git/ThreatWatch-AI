"""디페그 권고안 — MKT 파싱, 등급, 권고 규칙, 승인 요청·결과 메일, 결과 화면."""
import os

os.environ.setdefault("APPROVALS_TABLE", "test-approvals")
os.environ.setdefault("TABLE_NAME", "test-cases")
os.environ.setdefault("TOPIC_ARN", "arn:aws:sns:ap-northeast-2:000000000000:test")
os.environ.setdefault("CALLBACK_URL", "https://example.invalid/approvals/callback")
os.environ.setdefault("AWS_REGION", "ap-northeast-2")

import pytest  # noqa: E402

import approval_callback  # noqa: E402
import approval_finalize  # noqa: E402
import approval_request  # noqa: E402
import depeg_advisory as da  # noqa: E402
import topic_router  # noqa: E402

URL = "https://example.invalid/cb"
MKT = (
    "|| MKT coin=USDC price=0.9312 peg=1.0000 dev_bps=-688 chg24h_pct=-6.88 ref24h=1.0000 "
    "score=93.7 redemption_usd=1600000000 pool=0.86 news=1 at=2026-11-26T15:00:00Z demo=1"
)
# 백엔드가 실제로 받는 형태: normalizer 가 summary_bullets 를 공백으로 이어 붙인다.
SUMMARY = (
    "External pre-scored alert (depeg engine) Engine severity 'high' mapped to P1 "
    "[DEMO SIMULATION · sim-template.csv · 2026-11-26T15:00:00Z] USDC depeg risk score 93.7 " + MKT
)
DEPEG_TYPE = "stablecoin_depeg_risk_usdc"
ALERT_ID = "a1b2c3d4-0000-4000-8000-000000000000"


def _case(summary=SUMMARY, incident_type=DEPEG_TYPE):
    return {"alert_id": ALERT_ID, "risk_level": "P1", "risk_score": 90,
            "incident_type": incident_type, "summary": summary}


def _market(**over):
    market = da.parse_market(SUMMARY)
    market.update(over)
    return market


# ---- 파싱 ----

def test_prefix_matches_topic_router():
    assert da.DEPEG_PREFIX == topic_router.DEPEG_PREFIX


def test_parse_normal():
    assert da.parse_market(SUMMARY) == {
        "coin": "USDC", "price": 0.9312, "peg": 1.0, "dev_bps": -688, "chg24h_pct": -6.88,
        "ref24h": 1.0, "score": 93.7, "redemption_usd": 1.6e9, "pool": 0.86, "news": 1,
        "at": "2026-11-26T15:00:00Z", "demo": 1,
    }


@pytest.mark.parametrize("summary", [None, "", "USDC depeg risk score 93.7", "x || MKT", "x || MKT "])
def test_parse_no_market(summary):
    assert da.parse_market(summary) is None


@pytest.mark.parametrize("missing", ["coin", "price", "dev_bps"])
def test_parse_missing_required_key(missing):
    tokens = [t for t in MKT.split() if not t.startswith(missing + "=")]
    assert da.parse_market(" ".join(tokens)) is None


def test_parse_broken_optional_number_is_dropped():
    market = da.parse_market("|| MKT coin=USDC price=0.9312 dev_bps=-688 score=abc pool=nan news= at=yesterday")
    assert market == {"coin": "USDC", "price": 0.9312, "dev_bps": -688, "peg": 1.0}


@pytest.mark.parametrize("bad", ["price=abc", "dev_bps=x", "price=inf", "price=0", "coin=US<b>", "coin=테더"])
def test_parse_broken_required_value_falls_back(bad):
    key = bad.split("=")[0]
    tokens = [bad if t.startswith(key + "=") else t for t in MKT.split()]
    assert da.parse_market(" ".join(tokens)) is None


def test_parse_ignores_unknown_keys():
    assert da.parse_market(SUMMARY + " foo=bar venue=bitstamp junk") == da.parse_market(SUMMARY)


# ---- 등급 ----

@pytest.mark.parametrize("bps,expected", [
    (0, None), (49, None), (50, "주의"), (99, "주의"), (100, "경계"), (299, "경계"), (300, "심각"), (688, "심각"),
])
def test_grade_boundaries_both_signs(bps, expected):
    assert da.grade(bps) == expected
    assert da.grade(-bps) == expected


# ---- 권고 ----

def test_severe_base_recommendations():
    investor, issuer = da.recommendations(_market(news=0, redemption_usd=0, pool=0))
    assert len(investor) == 3 and len(issuer) == 3
    assert investor[0].startswith("신규 매수와 담보·결제 수단 사용을 잠시 멈추고")
    assert issuer[0].startswith("1시간 안에 준비금 구성")


@pytest.mark.parametrize("bps,investor0,issuer0", [
    (-60, "가격·공지 모니터링", "시장 상황 점검"),
    (150, "신규 매수·담보 사용 보류 검토", "준비금 현황 공개 준비"),
    (10, "가격·공지 모니터링", "시장 상황 점검"),  # 등급 없음 → 가장 낮은 문구
])
def test_lower_grade_recommendations(bps, investor0, issuer0):
    investor, issuer = da.recommendations(_market(dev_bps=bps, news=0, redemption_usd=0, pool=0))
    assert investor[0] == investor0 and issuer[0] == issuer0


@pytest.mark.parametrize("field,on,off,text,side", [
    ("news", 1, 0, da.EXTRA_ISSUER_NEWS, 1),
    ("redemption_usd", 5e8, 4.99e8, da.EXTRA_ISSUER_REDEMPTION, 1),
    ("pool", 0.5, 0.49, da.EXTRA_INVESTOR_POOL, 0),
])
def test_extra_conditions_attach_and_detach(field, on, off, text, side):
    base = dict(news=0, redemption_usd=0, pool=0)
    assert text in da.recommendations(_market(**{**base, field: on}))[side]
    assert text not in da.recommendations(_market(**{**base, field: off}))[side]
    without = _market(**base)
    del without[field]
    assert text not in da.recommendations(without)[side]


def test_no_trade_instructions_in_any_recommendation():
    for bps in (60, 150, 688):
        investor, issuer = da.recommendations(_market(dev_bps=bps))
        for line in investor + issuer:
            assert "매도하세요" not in line and "매수하세요" not in line and "파세요" not in line


# ---- 승인 요청 메일 ----

def test_request_message_with_market():
    subject, lines = approval_request.build_message(_case(), "tok", URL)
    body = "\n".join(lines)
    assert subject == "[APPROVAL] USDC -6.9% depeg - advisory decision (a1b2c3d4)"
    assert subject.isascii() and len(subject) < 100 and "\n" not in subject
    assert lines[0].startswith("[시연 · 모의 위기]")
    for expected in (
        "USDC (목표 1.0000 USD)", "0.9312 USD  (2026-11-26 15:00 UTC)", "-688bps (-6.88%)  → 등급: 심각",
        "1.0000 → 0.9312 (-6.88%)", "93.7 / 100  (경보 70 · 사람 승인 85 초과)",
        "시간당 16억 달러", "유동성 쏠림  0.86", "발행사·수탁은행 위기 기사 감지",
        "■ 투자자 권고", "■ 발행사 권고", "투자 권유가 아닙니다",
        "[승인] 위 권고안을 투자자·발행사에 발송합니다. (시연: 발송 확정만 기록)",
        "[반려] 권고안을 보내지 않습니다. 오탐·데이터 오류로 기록하고 감시는 계속합니다.",
        f"{URL}?id=tok&decision=approve", f"{URL}?id=tok&decision=reject", f"Alert ID: {ALERT_ID}",
    ):
        assert expected in body, expected
    assert "containment" not in body.lower()


def test_request_message_not_demo_and_optional_fields_absent():
    case = _case("x || MKT coin=usdt price=1.0061 dev_bps=61")
    subject, lines = approval_request.build_message(case, "tok", URL)
    body = "\n".join(lines)
    assert subject == "[APPROVAL] USDT +0.6% depeg - advisory decision (a1b2c3d4)"
    assert "시연" not in body and "판단 근거" not in body and "24시간 변화" not in body and "위험 점수" not in body
    assert "+61bps (+0.61%)  → 등급: 주의" in body


def test_expiry_text_matches_state_machine_timeout(monkeypatch):
    assert approval_request.APPROVAL_TIMEOUT_SEC == 3600  # terraform approval_timeout_sec 기본값
    assert approval_request.APPROVAL_TTL_SEC == 7200  # 레코드 보관 시간은 그대로
    for incident_summary in (SUMMARY, "no market"):
        body = "\n".join(approval_request.build_message(_case(incident_summary), "tok", URL)[1])
        assert "60분 뒤 만료" in body and "2시간" not in body
    monkeypatch.setattr(approval_request, "APPROVAL_TIMEOUT_SEC", 1800)
    assert "30분 뒤 만료" in "\n".join(approval_request.build_message(_case(), "tok", URL)[1])


def test_depeg_without_market_keeps_previous_wording():
    subject, lines = approval_request.build_message(_case("USDC depeg risk score 93.7"), "tok", URL)
    assert subject == "[APPROVAL] Depeg alert a1b2c3d4 - response decision required"
    assert "스테이블코인 디페그 조기경보 — 대응 실행 여부를 결정해 주세요." in lines
    assert "■ 가격 변동" not in lines


def test_security_alert_ignores_market_block():
    case = _case(SUMMARY, incident_type="ransomware")
    subject, lines = approval_request.build_message(case, "tok", URL)
    assert subject == f"[APPROVAL] {ALERT_ID} requires review"
    assert "Approve containment:" in lines and "This request expires in 2 hours." in lines


# ---- 결과 메일 ----

def test_result_mail_depeg():
    case = {"alert_id": ALERT_ID, "incident_type": DEPEG_TYPE}
    subject, lines = approval_finalize.build_result("approve", case)
    assert subject == "[APPROVED] USDC advisory - send approved (a1b2c3d4)"
    assert lines[0] == "권고안 발송 승인 — 투자자·발행사 권고 발송 확정"
    subject, lines = approval_finalize.build_result("reject", case)
    assert subject == "[REJECTED] USDC advisory - not sent (a1b2c3d4)"
    assert lines[0] == "권고안 반려 — 발송 안 함, 오탐 기록·감시 유지"
    subject, lines = approval_finalize.build_result("expired", case)
    assert subject == f"[EXPIRED] {ALERT_ID}"
    assert any("권고안 미발송" in line for line in lines)
    for decision in ("approve", "reject", "expired"):
        subject, lines = approval_finalize.build_result(decision, case)
        assert subject.isascii() and len(subject) < 100
        assert "containment" not in "\n".join(lines).lower()
        assert f"Alert ID : {ALERT_ID}" in lines


def test_result_mail_security_unchanged():
    case = {"alert_id": "A-1", "incident_type": "ransomware"}
    assert approval_finalize.build_result("approve", case) == (
        "[APPROVE] A-1",
        ["An analyst approved containment for this case.", "", "Alert ID : A-1", "Outcome  : approve"],
    )
    assert approval_finalize.build_result("expired", case)[1][0].startswith("No decision was made")


@pytest.mark.parametrize("incident_type,coin", [
    ("stablecoin_depeg_risk_usdc", "USDC"), ("stablecoin_depeg_risk_usdt", "USDT"),
    ("stablecoin_depeg_risk", "Depeg"), ("stablecoin_depeg_", "Depeg"), ("ransomware_usdc", "Depeg"),
])
def test_coin_from_incident_type(incident_type, coin):
    assert da.coin_from_incident_type(incident_type) == coin


# ---- 결과 화면 ----

class _Table:
    def __init__(self, incident_type):
        self.incident_type = incident_type

    def update_item(self, **kwargs):
        return {"Attributes": {"task_token": "t", "alert_id": "<script>x</script>",
                               "incident_type": self.incident_type}}


class _Sfn:
    def send_task_success(self, **kwargs):
        return {}


def _click(monkeypatch, incident_type, decision):
    monkeypatch.setattr(approval_callback, "_table", _Table(incident_type))
    monkeypatch.setattr(approval_callback, "_sfn", _Sfn())
    return approval_callback.handler({"queryStringParameters": {"id": "tok", "decision": decision}}, None)


def test_callback_page_depeg(monkeypatch):
    page = _click(monkeypatch, DEPEG_TYPE, "approve")
    assert page["statusCode"] == 200 and "권고안 발송 승인" in page["body"]
    assert "<script>" not in page["body"]  # 저장된 값도 HTML 에 넣지 않는다
    page = _click(monkeypatch, DEPEG_TYPE, "reject")
    assert "권고안 반려" in page["body"] and "<script>" not in page["body"]


def test_callback_page_security_unchanged(monkeypatch):
    page = _click(monkeypatch, "ransomware", "approve")
    assert "Case approved" in page["body"] and "권고안" not in page["body"]
