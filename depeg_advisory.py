"""
디페그 권고안 (가격 변동 + 투자자·발행사 권고)

승인 메일(approval_request), 결과 화면(approval_callback), 결과 메일(approval_finalize)이
같은 규칙과 문구를 쓰도록 한곳에 둔다. 세 Lambda 의 배포 zip 에 이 파일이 함께 들어간다
(terraform/hitl.tf 의 archive_file).

전부 순수 함수다. 네트워크·환경변수·시계를 건드리지 않는다.
권고는 사전에 정한 고정 규칙이며 AI 판단이 아니다. 매매 지시 문구는 쓰지 않는다.

입력 계약 — 대시보드(api/_depeg/sim_core.py)가 경보 description 끝에 붙이는 한 줄:
  ... || MKT coin=USDC price=0.9312 peg=1.0000 dev_bps=-688 chg24h_pct=-6.88 ref24h=1.0000
         score=93.7 redemption_usd=1600000000 pool=0.86 news=1 at=2026-11-26T15:00:00Z demo=1
공백 구분 key=value. 모르는 key 는 무시하고, 숫자 변환에 실패한 key 는 없는 것으로 본다.
"""

import math
import re

# topic_router.DEPEG_PREFIX 와 같은 값. approval_request / approval_callback 의 zip 에는
# topic_router 가 없으므로 여기에 둔다. 일치 여부는 tests/test_depeg_advisory.py 가 확인한다.
DEPEG_PREFIX = "stablecoin_depeg_"

MKT_MARKER = "|| MKT "
REQUIRED_KEYS = ("coin", "price", "dev_bps")

_FLOAT_KEYS = ("price", "peg", "chg24h_pct", "ref24h", "score", "redemption_usd", "pool")
_INT_KEYS = ("dev_bps", "news", "demo")
_COIN_RE = re.compile(r"^[A-Za-z0-9]{1,10}$")
_AT_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|\+00:00)$")

# 엔진 점수 기준 (팀 확정값): 70 이상 경보, 85 이상 사람 승인
SCORE_ALERT = 70
SCORE_APPROVAL = 85

GRADE_WATCH = "주의"
GRADE_WARN = "경계"
GRADE_SEVERE = "심각"

_BASE = {
    GRADE_WATCH: (
        ["가격·공지 모니터링", "신규 대규모 매수 신중"],
        ["시장 상황 점검", "공지 준비"],
    ),
    GRADE_WARN: (
        ["신규 매수·담보 사용 보류 검토", "상환 경로 확인"],
        ["준비금 현황 공개 준비", "상환 처리 용량 점검"],
    ),
    GRADE_SEVERE: (
        [
            "신규 매수와 담보·결제 수단 사용을 잠시 멈추고 보유 규모를 점검하세요.",
            "1:1 상환은 발행사 공식 채널로만 진행하고, 장외 할인 매도 권유에 주의하세요.",
            "거래소·디파이의 입출금·청산 기준 변경 공지를 확인하세요.",
        ],
        [
            "1시간 안에 준비금 구성과 은행별 예치 현황을 공개하세요.",
            "상환 처리 용량을 늘리고, 지연이 있으면 예상 처리 시간을 공지하세요.",
            "주요 거래소·시장조성자와 유동성 공급 계획을 확인하세요.",
        ],
    ),
}

EXTRA_ISSUER_NEWS = "수탁은행 노출 규모와 대체 은행 확보 여부를 공개하세요."
EXTRA_ISSUER_REDEMPTION = "상환 대기 규모와 처리 순서를 공지하세요."
EXTRA_INVESTOR_POOL = "유동성 풀에서의 대량 교환은 체결 가격을 확인한 뒤 진행하세요."

REDEMPTION_THRESHOLD_USD = 5e8
POOL_THRESHOLD = 0.5

DISCLAIMER = "※ 사전에 정한 규칙에 따른 위험 관리 권고이며 투자 권유가 아닙니다."


def is_depeg(incident_type) -> bool:
    return isinstance(incident_type, str) and incident_type.startswith(DEPEG_PREFIX)


def _number(text):
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def parse_market(summary):
    """summary(=경보 description 이 섞인 문자열)에서 MKT 묶음을 읽는다.

    묶음이 없거나 필수 key(coin, price, dev_bps)가 빠지면 None — 호출 쪽은 기존 문구로 돌아간다.
    """
    if not isinstance(summary, str) or MKT_MARKER not in summary:
        return None

    raw = {}
    for token in summary.rsplit(MKT_MARKER, 1)[1].split():
        key, sep, value = token.partition("=")
        if sep and key and value and key not in raw:
            raw[key] = value

    market = {}

    coin = raw.get("coin", "")
    if _COIN_RE.match(coin):  # 메일 제목(ASCII)에 들어가므로 영숫자만 받는다
        market["coin"] = coin.upper()

    for key in _FLOAT_KEYS:
        value = _number(raw.get(key))
        if value is not None:
            market[key] = value

    for key in _INT_KEYS:
        value = _number(raw.get(key))
        if value is not None:
            market[key] = int(round(value))

    at = raw.get("at", "")
    if _AT_RE.match(at):
        market["at"] = at

    if any(key not in market for key in REQUIRED_KEYS):
        return None
    if market["price"] <= 0 or market.get("peg", 1.0) <= 0:
        return None

    market.setdefault("peg", 1.0)
    return market


def grade(dev_bps):
    """이탈폭 절댓값으로 등급을 정한다. 50bps 미만은 None."""
    size = abs(dev_bps)
    if size >= 300:
        return GRADE_SEVERE
    if size >= 100:
        return GRADE_WARN
    if size >= 50:
        return GRADE_WATCH
    return None


def recommendations(market):
    """(투자자 권고, 발행사 권고). 등급별 기본 문구 + 해당하는 추가 조건.

    50bps 미만(등급 없음)이어도 사람 승인까지 올라온 경보이므로 가장 낮은 '주의' 문구를 쓴다.
    """
    base_investor, base_issuer = _BASE[grade(market["dev_bps"]) or GRADE_WATCH]
    investor, issuer = list(base_investor), list(base_issuer)

    if market.get("news") == 1:
        issuer.append(EXTRA_ISSUER_NEWS)
    if market.get("redemption_usd", 0) >= REDEMPTION_THRESHOLD_USD:
        issuer.append(EXTRA_ISSUER_REDEMPTION)
    if market.get("pool", 0) >= POOL_THRESHOLD:
        investor.append(EXTRA_INVESTOR_POOL)

    return investor, issuer


def _usd_korean(amount):
    if amount >= 1e8:
        return f"{amount / 1e8:,.1f}".removesuffix(".0") + "억 달러"
    return f"{amount / 1e4:,.0f}만 달러"


def _at_display(at):
    match = _AT_RE.match(at or "")
    return f"{match.group(1)} {match.group(2)} UTC" if match else ""


def _score_note(score):
    if score >= SCORE_APPROVAL:
        return f"경보 {SCORE_ALERT} · 사람 승인 {SCORE_APPROVAL} 초과"
    if score >= SCORE_ALERT:
        return f"경보 {SCORE_ALERT} 초과 · 사람 승인 기준 {SCORE_APPROVAL}"
    return f"경보 기준 {SCORE_ALERT} · 사람 승인 기준 {SCORE_APPROVAL}"


def timeout_text(seconds):
    """승인 대기 시간 표시. 3600 → '60분'."""
    return f"{max(1, int(seconds) // 60)}분"


def request_subject(market, alert_id):
    """승인 요청 메일 제목. SNS 제약상 ASCII·100자 미만."""
    pct = market["dev_bps"] / 100
    return f"[APPROVAL] {market['coin']} {pct:+.1f}% depeg - advisory decision ({str(alert_id)[:8]})"


def request_lines(market, alert_id, approve_url, reject_url, timeout_sec):
    """승인 요청 메일 본문 줄."""
    demo = market.get("demo") == 1
    dev_bps = market["dev_bps"]
    dev_pct = dev_bps / 100
    level = grade(dev_bps) or "관찰 (50bps 미만)"
    investor, issuer = recommendations(market)

    title = "스테이블코인 디페그 조기경보 — 권고안 발송 결정 요청"
    lines = [
        f"[시연 · 모의 위기] {title}" if demo else title,
        "Stablecoin depeg early warning — advisory decision required",
        "",
        "■ 가격 변동",
        f"  코인          {market['coin']} (목표 {market['peg']:.4f} USD)",
    ]

    when = _at_display(market.get("at"))
    lines.append(f"  현재 가격     {market['price']:.4f} USD" + (f"  ({when})" if when else ""))
    lines.append(f"  이탈폭        {dev_bps:+d}bps ({dev_pct:+.2f}%)  → 등급: {level}")
    if "ref24h" in market and "chg24h_pct" in market:
        lines.append(
            f"  24시간 변화   {market['ref24h']:.4f} → {market['price']:.4f} ({market['chg24h_pct']:+.2f}%)"
        )
    if "score" in market:
        lines.append(f"  위험 점수     {market['score']:.1f} / 100  ({_score_note(market['score'])})")

    reasons = []
    if market.get("redemption_usd", 0) > 0:
        reasons.append(f"  - 대량 상환    시간당 {_usd_korean(market['redemption_usd'])}")
    if "pool" in market:
        reasons.append(f"  - 유동성 쏠림  {market['pool']:.2f}")
    if market.get("news") == 1:
        reasons.append("  - 뉴스         발행사·수탁은행 위기 기사 감지")
    if reasons:
        lines += ["", "■ 판단 근거"] + reasons

    lines += ["", "■ 투자자 권고"]
    lines += [f"  {n}. {text}" for n, text in enumerate(investor, 1)]
    lines += ["", "■ 발행사 권고"]
    lines += [f"  {n}. {text}" for n, text in enumerate(issuer, 1)]

    approve = "[승인] 위 권고안을 투자자·발행사에 발송합니다."
    if demo:
        approve += " (시연: 발송 확정만 기록)"

    lines += [
        "",
        DISCLAIMER,
        "",
        "──── 결정 ────",
        approve,
        f"  {approve_url}",
        "",
        "[반려] 권고안을 보내지 않습니다. 오탐·데이터 오류로 기록하고 감시는 계속합니다.",
        f"  {reject_url}",
        "",
        f"이 요청은 {timeout_text(timeout_sec)} 뒤 만료됩니다. "
        "응답이 없으면 권고안은 발송되지 않고 랩장에게 통지됩니다.",
        f"Alert ID: {alert_id}",
    ]
    return lines


# ---- 결정 뒤 화면·결과 메일 ----

RESULT_TEXT = {
    "approve": "권고안 발송 승인 — 투자자·발행사 권고 발송 확정",
    "reject": "권고안 반려 — 발송 안 함, 오탐 기록·감시 유지",
    "expired": "무응답 만료 — 권고안 미발송, 랩장 통지",
}

# 승인 링크를 누른 뒤 브라우저에 보이는 (제목, 설명). 고정 문구만 쓴다 — 입력값을 HTML 에 넣지 않는다.
PAGE_TEXT = {
    "approve": ("권고안 발송 승인", "투자자·발행사 권고 발송이 확정되었습니다. 이 창은 닫아도 됩니다."),
    "reject": ("권고안 반려", "권고안을 보내지 않습니다. 오탐으로 기록하고 감시는 계속합니다. 이 창은 닫아도 됩니다."),
}


def coin_from_incident_type(incident_type):
    """'stablecoin_depeg_risk_usdc' → 'USDC'. 알 수 없으면 'Depeg'."""
    tail = str(incident_type or "").rsplit("_", 1)[-1]
    if is_depeg(incident_type) and _COIN_RE.match(tail) and tail.lower() != "risk":
        return tail.upper()
    return "Depeg"


def result_subject(decision, incident_type, alert_id):
    """결과 메일 제목 (승인·반려). 만료는 None — 기존 제목을 쓴다."""
    coin = coin_from_incident_type(incident_type)
    short = str(alert_id)[:8]
    if decision == "approve":
        return f"[APPROVED] {coin} advisory - send approved ({short})"
    if decision == "reject":
        return f"[REJECTED] {coin} advisory - not sent ({short})"
    return None
