"""
디페그 권고안 (가격 변동 + 투자자·발행사 권고)

승인 메일(approval_request), 결과 화면(approval_callback), 결과 메일(approval_finalize)이
같은 규칙과 문구를 쓰도록 한곳에 둔다. 세 Lambda 의 배포 zip 에 이 파일이 함께 들어간다
(terraform/hitl.tf 의 archive_file).

전부 순수 함수다. 네트워크·환경변수·시계를 건드리지 않는다.
메일·화면에 나가는 문구는 모두 영어다.
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

GRADE_WATCH = "Watch"
GRADE_WARN = "Warning"
GRADE_SEVERE = "Severe"

_BASE = {
    GRADE_WATCH: (
        [
            "Monitor the price and official announcements.",
            "Be cautious with large new purchases.",
        ],
        [
            "Review market conditions.",
            "Prepare a public statement.",
        ],
    ),
    GRADE_WARN: (
        [
            "Consider pausing new purchases and use as collateral.",
            "Confirm your redemption route.",
        ],
        [
            "Prepare to disclose the current state of reserves.",
            "Check redemption processing capacity.",
        ],
    ),
    GRADE_SEVERE: (
        [
            "Pause new purchases and use as collateral or payment, and review the size of your holdings.",
            "Redeem 1:1 only through the issuer's official channels, and be wary of off-market offers to buy at a discount.",
            "Check exchange and DeFi notices for changes to deposits, withdrawals and liquidation thresholds.",
        ],
        [
            "Within 1 hour, disclose the reserve composition and the deposits held at each bank.",
            "Increase redemption processing capacity and, if there are delays, publish expected processing times.",
            "Confirm liquidity provision plans with major exchanges and market makers.",
        ],
    ),
}

EXTRA_ISSUER_NEWS = "Disclose the exposure to the custodian bank and whether alternative banks are in place."
EXTRA_ISSUER_REDEMPTION = "Publish the size of the redemption queue and the processing order."
EXTRA_INVESTOR_POOL = "Check the execution price before making large swaps in liquidity pools."

REDEMPTION_THRESHOLD_USD = 5e8
POOL_THRESHOLD = 0.5

DISCLAIMER = "Note: this is risk-management guidance produced by predefined rules. It is not investment advice."


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


def _usd_text(amount):
    if amount >= 1e9:
        return f"${amount / 1e9:,.2f}".rstrip("0").rstrip(".") + " billion"
    if amount >= 1e6:
        return f"${amount / 1e6:,.1f}".removesuffix(".0") + " million"
    return f"${amount:,.0f}"


def _at_display(at):
    match = _AT_RE.match(at or "")
    return f"{match.group(1)} {match.group(2)} UTC" if match else ""


def _score_note(score):
    if score >= SCORE_APPROVAL:
        return f"above alert {SCORE_ALERT} and human approval {SCORE_APPROVAL}"
    if score >= SCORE_ALERT:
        return f"above alert {SCORE_ALERT}; human approval threshold {SCORE_APPROVAL}"
    return f"alert threshold {SCORE_ALERT}; human approval threshold {SCORE_APPROVAL}"


def timeout_text(seconds):
    """승인 대기 시간 표시. 3600 → '60 minutes'."""
    minutes = max(1, int(seconds) // 60)
    return f"{minutes} minute" + ("" if minutes == 1 else "s")


def request_subject(market, alert_id):
    """승인 요청 메일 제목. SNS 제약상 ASCII·100자 미만."""
    pct = market["dev_bps"] / 100
    return f"[APPROVAL] {market['coin']} {pct:+.1f}% depeg - advisory decision ({str(alert_id)[:8]})"


def request_lines(market, alert_id, approve_url, reject_url, timeout_sec):
    """승인 요청 메일 본문 줄."""
    demo = market.get("demo") == 1
    dev_bps = market["dev_bps"]
    dev_pct = dev_bps / 100
    level = grade(dev_bps) or "Monitoring (below 50bps)"
    investor, issuer = recommendations(market)

    title = "Stablecoin depeg early warning — advisory decision required"
    lines = [
        f"[DEMO · SIMULATED CRISIS] {title}" if demo else title,
        "",
        "== Price move ==",
        f"  Coin           {market['coin']} (target {market['peg']:.4f} USD)",
    ]

    when = _at_display(market.get("at"))
    lines.append(f"  Current price  {market['price']:.4f} USD" + (f"  ({when})" if when else ""))
    lines.append(f"  Deviation      {dev_bps:+d}bps ({dev_pct:+.2f}%)  -> Grade: {level}")
    if "ref24h" in market and "chg24h_pct" in market:
        lines.append(
            f"  24h change     {market['ref24h']:.4f} -> {market['price']:.4f} ({market['chg24h_pct']:+.2f}%)"
        )
    if "score" in market:
        lines.append(f"  Risk score     {market['score']:.1f} / 100  ({_score_note(market['score'])})")

    reasons = []
    if market.get("redemption_usd", 0) > 0:
        reasons.append(f"  - Heavy redemptions   {_usd_text(market['redemption_usd'])} per hour")
    if "pool" in market:
        reasons.append(f"  - Pool imbalance      {market['pool']:.2f}")
    if market.get("news") == 1:
        reasons.append("  - News                Crisis coverage of the issuer or its custodian bank detected")
    if reasons:
        lines += ["", "== Why this was flagged =="] + reasons

    lines += ["", "== Advisory for investors =="]
    lines += [f"  {n}. {text}" for n, text in enumerate(investor, 1)]
    lines += ["", "== Advisory for the issuer =="]
    lines += [f"  {n}. {text}" for n, text in enumerate(issuer, 1)]

    approve = "[APPROVE] Send the advisory above to investors and the issuer."
    if demo:
        approve += " (Demo: only the decision to send is recorded.)"

    lines += [
        "",
        DISCLAIMER,
        "",
        "==== Decision ====",
        approve,
        f"  {approve_url}",
        "",
        "[REJECT] Do not send the advisory. Record it as a false alarm or data error; monitoring continues.",
        f"  {reject_url}",
        "",
        f"This request expires in {timeout_text(timeout_sec)}. "
        "If there is no response, the advisory is not sent and the lab lead is notified.",
        f"Alert ID: {alert_id}",
    ]
    return lines


# ---- 결정 뒤 화면·결과 메일 ----

RESULT_TEXT = {
    "approve": "Advisory approved — sending to investors and the issuer is confirmed.",
    "reject": "Advisory rejected — not sent; recorded as a false alarm, monitoring continues.",
    "expired": "Expired with no response — advisory not sent; the lab lead has been notified.",
}

# 승인 링크를 누른 뒤 브라우저에 보이는 (제목, 설명). 고정 문구만 쓴다 — 입력값을 HTML 에 넣지 않는다.
PAGE_TEXT = {
    "approve": (
        "Advisory approved",
        "Sending the advisory to investors and the issuer is confirmed. You can close this window.",
    ),
    "reject": (
        "Advisory rejected",
        "The advisory will not be sent. It is recorded as a false alarm and monitoring continues. "
        "You can close this window.",
    ),
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
