# AUTO-COPIED from depeg-early-warning/src/intelligence/news_rubric.py @8ef6cac
# 직접 고치지 말 것 — 엔진 저장소에서 고친 뒤 scripts/sync_depeg_engine.sh 로 다시 복사
"""뉴스 기준표 v2 — 기사 제목을 정해진 규칙으로만 분류한다 (AI 판단 없음).

같은 제목 + 같은 보관처 목록에는 항상 같은 결과가 나와야 과거 데이터로 검증(백테스트)할 수 있다.
AI는 이 분류를 바꾸지 않고, 나중에 사람이 읽을 설명 문장만 쓴다.

v2 = v1의 시점별 보관처 목록(REPORTS, counterparties_at)
   + 대시보드 v0.2의 오탐 방지 규칙
   + docs/news_leadtime_2023.md 4장의 놓친 표현·해소 표현.
v2.1 = v2 + 실시간 오탐 1건(BNY Mellon 동명 펀드의 공매도 잔고 기사)에서 나온 두 가지:
   c1 주가 급락(b5)은 shares/stock 이 앞에 있고 short interest 가 없을 때만,
   c2 보관처 별칭이 동명 펀드·ETF나 다른 티커를 가리키면 보관처로 보지 않음.
바꾼 항목은 코드보다 먼저 docs/news_rubric_v2_changes.md 에 사전 등록했다(a1~a6, b1~b8, c1~c2).
그 목록 밖의 패턴은 넣지 않는다 — 같은 데이터로 계속 고치면 리드타임이 부풀려진다.

등급
  A  발행사·코인 자체의 위기   (USDC/Circle + 페그 이탈·상환 중단 등)           → 신호 켜짐
  B  준비금을 맡은 곳의 위기   (그 시점 보관처 + 은행 위기 표현,
                                또는 발행사 + 보관처 + 준비금 노출 표현)          → 신호 켜짐
  C  관찰만                     (USDC/Circle + 규제·보안 사건, 또는 부정·소문·회고·해소로 하향) → 신호 꺼짐

이 파일은 표준 라이브러리만 쓴다 (ThreatWatch-AI 대시보드로 그대로 복사된다).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

RUBRIC_VERSION = "v2.1"

CI = re.IGNORECASE


def _rx(patterns: list[str], flags: int = CI) -> list[re.Pattern]:
    return [re.compile(p, flags) for p in patterns]


# a1 발행사·코인. "Circle"은 대소문자 구분 + USDC/스테이블코인 맥락이 같은 제목에 있을 때만.
ISSUER_STRONG = _rx([r"\bUSDC\b", r"\bUSD Coin\b", r"\bCircle Internet\b", r"\bCRCL\b"])
CIRCLE_WORD = re.compile(r"\bCircle\b")  # 대소문자 구분
STABLE_CONTEXT = _rx([r"stablecoin", r"\bUSDC\b", r"\bcrypto"])

# a2 + b3 + b4  발행사·코인 자체의 위기
ISSUER_DISTRESS = _rx([
    r"\bde-?peg(ged|s|ging)?\b", r"\b(lost|loses?|losing) (its |the )?(dollar )?peg\b",
    r"\bbreaks? (its |the )?(dollar )?peg\b",                                       # b4
    r"\bbelow \$1(\.00)?(?![\d.%])",
    r"\bUSD(C| Coin)\b[^.;:]{0,25}\b(at|to|trades? at|falls? to|slips? to|drops? to|sinks? to)\s*\$?0\.(9\d|[0-8]\d)\b",
    r"\bredemptions? (are |were |is )?(halted|paused|suspended|delayed|frozen)\b",
    r"\b(halts?|pauses?|suspends?) (USDC )?(redemptions?|minting|withdrawals?)\b",
    r"\b(conversions?|redemptions?) (are |were |is )?(paused|suspended|halted)\b",   # b3
    r"\b(paus|suspend|halt)\w* [^.;:]{0,30}\b(conversions?|redemptions?)\b",        # b3 (반대 어순)
    r"\bbank run\b", r"\binsolven(t|cy)\b", r"\breserve (shortfall|gap|hole)\b",
    r"\b(USDC|stablecoin) (collapse|crash)\b",
])

# a5 + b1 + b2 + b6  보관처(은행·펀드)의 위기 (b5 주가 급락은 v2.1부터 아래 SHARE_PLUNGE 로 따로 본다)
BANK_DISTRESS = _rx([
    r"\bbank run\b", r"\breceivership\b", r"\bFDIC (takes|took|seiz\w*|takeover|steps in)\b",
    r"\binsolven(t|cy)\b", r"\bcollapse[sd]?\b", r"\bbank failure\b", r"\bfail(s|ed)\b",
    r"\bshut(s)? down\b", r"\bseiz(ed|es|ure)\b", r"\bwithdrawals? (halted|frozen|paused|suspended)\b",
    r"\bcapital (raise|shortfall)\b", r"\bemergency (sale|funding|loan)\b", r"\bliquidity crisis\b",
    r"\bwind(s|ing)? down\b", r"\bliquidat\w*",                                     # b1
    r"\bshutter\w*", r"\bclosed by (\w+ ){0,2}regulators?\b",                         # b2
    r"\b(takes?|took|taking) possession\b",                                          # b2
    r"\b(move|pull|withdraw)\w* (\w+ ){0,2}(money|funds|deposits|cash) (out of|from)\b",  # b6
])

# c1 (b5 개정)  주가 급락: shares/stock 이 급락 표현보다 앞에 있을 때만 (사이 40자 이내)
SHARE_PLUNGE = _rx([
    r"\b(shares?|stock)\b[^.;:]{0,40}?\b(plung|fall|fell|drop)\w* (more than |over |about |nearly )?\d+(\.\d+)?%",
])
# c1  공매도 잔고 기사에는 급락 규칙을 적용하지 않는다 (잔고 감소는 위기가 아님)
SHORT_INTEREST = _rx([r"\bshort (interest|positions?)\b"])

# b7  발행사 + 보관처가 함께 나올 때, 준비금이 그곳에 있다는 표현
EXPOSURE = _rx([
    r"\breserves? (are |were |is )?(held )?(with|at)\b",
    r"\bheld (\w+ ){0,2}reserves? (at|with)\b",
    r"\bexposure (to|at)\b",
])

# a4 + b8  위기 단어가 있어도 A/B로 올리지 않는 표현 (부정, 소문, 회고, 해소)
DOWNGRADE = _rx([
    r"\b(holds?|keeps?|maintains?|regains?|restores?|back to|returns? to) (its |the )?(dollar )?peg\b",
    r"\brumou?rs?\b", r"\bdenies\b", r"\bdenied\b", r"\bfears? (ease|eased|easing|overblown)\b",
    r"\b(years?|months?) after\b", r"\banniversary\b", r"\blessons? from\b",
    r"\bde-?peg (closes|closed|ends|ended|is over)\b", r"\brisk (removed|eliminated)\b",   # b8
    r"\b(regains?|regained|restores?|restored)\b[^.;:]{0,20}\bpeg\b",                     # b8
    r"\bback (to|toward|towards) \$?1\b",                                                   # b8
])

# a3  관찰: 규제·감독, 보안 사건(해킹 자금 동결 등)
WATCH_ONLY = _rx([
    r"\bMiCA\b", r"\bEBA\b", r"\bGENIUS Act\b", r"\bSEC\b", r"\bregulat\w*", r"\bsupervis\w*",
    r"\blicen[cs]e\w*", r"\bcharter\b", r"\bEU\b", r"\bEEA\b", r"\bdeadline\b", r"\bcomplian\w*",
    r"\bexploit\w*", r"\bhack\w*", r"\bfreez\w*", r"\bfroze(n)?\b", r"\bblacklist\w*",
])

# a6  보고서에 인쇄된 기관 이름 → 기사 제목에서 찾을 표현.
# 여기에 없는 이름이 들어오면 이름 그대로(대소문자 무시, 단어 경계) 찾는다.
# 빈 목록은 "이름만으로는 매칭하지 않음"이다.
COUNTERPARTY_ALIASES: dict[str, list[str]] = {
    "Bank of New York Mellon": [r"\bBNY Mellon\b", r"\bBank of New York Mellon\b", r"\bBNY\b(?= (bank|custod))"],
    "Citizens Trust Bank": [r"\bCitizens Trust\b"],
    "Cross River Bank": [r"\bCross River Bank\b"],
    "Customers Bank": [r"\bCustomers Bank(corp)?\b"],
    "New York Community Bank": [r"\bNew York Community Bank\b", r"\bNYCB\b", r"\bFlagstar\b"],
    "Signature Bank": [r"\bSignature Bank\b"],
    "Silicon Valley Bank": [r"\bSilicon Valley Bank\b", r"\bSVB\b"],
    "Silvergate Bank": [r"\bSilvergate\b"],
    "Circle Reserve Fund": [r"\bCircle Reserve Fund\b", r"\bUSDXX\b"],
    "BlackRock": [],  # 흔한 BlackRock 뉴스가 B로 켜지지 않게. 펀드는 Circle Reserve Fund·USDXX로 잡는다
}

# c2  별칭이 맞아도 이 표현이 있으면 그 기관으로 보지 않는다 (같은 이름의 펀드·ETF, 다른 회사 티커)
#     BNY 자신의 티커(BK)는 제외하지 않는다 — "BNY Mellon (NYSE:BK) shares plunge"는 진짜 위기 기사다.
COUNTERPARTY_EXCLUDE: dict[str, list[str]] = {
    "Bank of New York Mellon": [
        r"\bBNY( Mellon)?\b[^.;:]{0,60}?\b(Funds?|ETFs?)\b",
        r"\((NYSE|NASDAQ|NYSEAMERICAN|NYSE American|AMEX)\s*:\s*(?!BK\))[A-Z.]{1,6}\)",
    ],
}

_FUND = "Circle Reserve Fund"
_BANKS_2022_2023 = (
    "Bank of New York Mellon", "Citizens Trust Bank", "Customers Bank",
    "New York Community Bank", "Signature Bank", "Silicon Valley Bank", "Silvergate Bank",
)
_BANKS_2023_03_31 = ("Bank of New York Mellon", "Cross River Bank", "Customers Bank")

# 보고서별 보관처 — docs/offchain_attestation_anatomy.md 0절(발행일)과 각 PDF의 현금 예치 은행 각주를
# 눈으로 옮긴 표. public_from 은 손 해부 3-3절 규칙(발행일 당일의 마지막 초)이다.
#   banks        : 그 보고서에 이름이 인쇄된 현금 예치 은행 (가장 늦은 기준일 기준)
#   others       : 보고서에 이름이 나온 펀드·운용사
#   banks_named  : False면 보고서가 은행 이름을 밝히지 않음 → 이름이 나온 가장 최근 목록을 이어 쓴다
REPORTS: tuple[dict[str, Any], ...] = (
    {"report": "2022-11", "public_from": "2022-12-22T23:59:59Z", "banks_named": True,
     "banks": _BANKS_2022_2023, "others": (_FUND, "BlackRock")},  # 각주 10
    {"report": "2022-12", "public_from": "2023-01-25T23:59:59Z", "banks_named": True,
     "banks": _BANKS_2022_2023, "others": (_FUND, "BlackRock")},  # 각주 10
    {"report": "2023-01", "public_from": "2023-03-02T23:59:59Z", "banks_named": True,
     "banks": _BANKS_2022_2023, "others": (_FUND,)},  # 각주 2 — 디페그 주간의 최신 보고서
    {"report": "2023-02", "public_from": "2023-03-30T23:59:59Z", "banks_named": True,
     "banks": _BANKS_2022_2023, "others": (_FUND,)},  # 각주 2
    {"report": "2023-03", "public_from": "2023-04-28T23:59:59Z", "banks_named": True,
     "banks": _BANKS_2023_03_31, "others": (_FUND,)},  # 각주 2, 03-31 기준 (03-06은 7곳)
    {"report": "2026-07", "public_from": "2026-08-27T23:59:59Z", "banks_named": False,
     "banks": (), "others": (_FUND,)},  # "regulated financial institutions"로만 표기
    {"report": "2026-08", "public_from": "2026-09-29T23:59:59Z", "banks_named": False,
     "banks": (), "others": (_FUND,)},
    {"report": "2026-09", "public_from": "2026-10-26T23:59:59Z", "banks_named": False,
     "banks": (), "others": (_FUND,)},
)


def counterparties_at(
    observed_at: str, reports: Sequence[Mapping[str, Any]] = REPORTS
) -> dict[str, Any]:
    """시각 t(초 단위 UTC Z 문자열)에 공개돼 있던 최신 보고서의 보관처 목록. 순수 함수.

    반환: {"report", "names", "banks_from"}. 공개된 보고서가 없으면 report=None, names=[].
    보고서가 은행 이름을 밝히지 않으면(2026년 양식) 이름이 나온 가장 최근 보고서의 은행 목록을
    이어 쓰고, 어느 보고서에서 왔는지 banks_from 에 남긴다.
    """
    public = sorted(
        (r for r in reports if r["public_from"] <= observed_at),
        key=lambda r: r["public_from"],
    )
    if not public:
        return {"report": None, "names": [], "banks_from": None}
    latest = public[-1]
    named = [r for r in public if r["banks_named"]]
    bank_source = latest if latest["banks_named"] else (named[-1] if named else None)
    banks = list(bank_source["banks"]) if bank_source else []
    return {
        "report": latest["report"],
        "names": banks + list(latest["others"]),
        "banks_from": bank_source["report"] if bank_source else None,
    }


def _first(patterns: Iterable[re.Pattern], text: str) -> str | None:
    for p in patterns:
        m = p.search(text)
        if m:
            return m.group(0)
    return None


def _issuer(title: str) -> str | None:
    hit = _first(ISSUER_STRONG, title)
    if hit:
        return hit
    if CIRCLE_WORD.search(title) and _first(STABLE_CONTEXT, title):
        return "Circle"
    return None


def counterparty_patterns(counterparties: Iterable[str]) -> list[re.Pattern]:
    """기관 이름 목록을 제목 검색용 표현 목록으로 바꾼다."""
    patterns: list[re.Pattern] = []
    for name in counterparties:
        aliases = COUNTERPARTY_ALIASES.get(name)
        if aliases is None:
            aliases = [rf"\b{re.escape(name)}\b"]
        patterns.extend(_rx(aliases))
    return patterns


def _party(title: str, counterparties: Iterable[str]) -> str | None:
    """제목에 나온 보관처 이름(처음 맞은 것). c2 제외 표현이 있는 기관은 건너뛴다."""
    for name in counterparties:
        hit = _first(counterparty_patterns([name]), title)
        if hit and not _first(_rx(COUNTERPARTY_EXCLUDE.get(name, [])), title):
            return hit
    return None


def _bank_distress(title: str) -> str | None:
    d = _first(BANK_DISTRESS, title)
    if d:
        return d
    if not _first(SHORT_INTEREST, title):  # c1
        return _first(SHARE_PLUNGE, title)
    return None


def _graded(tier: str, who: str, why: str, softened: str | None) -> dict[str, Any]:
    if softened:
        return {"tier": "C", "who": who, "why": f"{why} / {softened}"}
    return {"tier": tier, "who": who, "why": why}


def classify(title: str, counterparties: Iterable[str]) -> dict[str, Any] | None:
    """기사 제목 하나를 분류한다. 해당 없음이면 None.

    counterparties: 그 시점에 공개돼 있던 보관처 이름 목록 (counterparties_at(t)["names"]).
    순서: 발행사 위기(A) → 보관처 위기(B) → 발행사+보관처+노출(B) → 발행사 관찰(C).
    부정·소문·회고·해소 표현이 같이 있으면 A·B는 C로 내린다.
    """
    issuer = _issuer(title)
    party = _party(title, counterparties)
    softened = _first(DOWNGRADE, title)

    if issuer:
        d = _first(ISSUER_DISTRESS, title)
        if d:
            return _graded("A", issuer, d, softened)
    if party:
        d = _bank_distress(title)
        if d:
            return _graded("B", party, d, softened)
        if issuer:
            e = _first(EXPOSURE, title)
            if e:
                return _graded("B", party, f"{issuer} + {e}", softened)
    if issuer:
        w = _first(WATCH_ONLY, title)
        if w:
            return {"tier": "C", "who": issuer, "why": w}
    return None


def news_flag(
    articles: Iterable[Mapping[str, Any]], counterparties: Iterable[str]
) -> tuple[int, list[dict[str, Any]]]:
    """기사 목록 → (news_risk_flag 0/1, 분류된 기사 목록). 순수 함수."""
    names = list(counterparties)
    matched = []
    for a in articles:
        c = classify(a.get("title", ""), names)
        if c:
            matched.append({**a, **c})
    order = {"A": 0, "B": 1, "C": 2}
    matched.sort(key=lambda m: m.get("seen", ""), reverse=True)  # 최신 먼저
    matched.sort(key=lambda m: order[m["tier"]])  # 그다음 등급 순 (안정 정렬)
    flag = 1 if any(m["tier"] in ("A", "B") for m in matched) else 0
    return flag, matched
