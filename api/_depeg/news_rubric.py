"""뉴스 기준표 v0.2 — 기사 제목을 정해진 규칙으로만 분류한다 (AI 판단 없음).

같은 기사에는 항상 같은 결과가 나와야 과거 데이터로 검증(백테스트)할 수 있다.
AI는 이 분류를 바꾸지 않고, 나중에 사람이 읽을 설명 문장만 쓴다.

v0 은 대시보드 실시간 화면용 임시 위치다. 정식 버전은
depeg-early-warning/src/intelligence/ 에 만들고, 이 파일은 그 복사본으로 교체한다.

등급
  A  발행사·코인 자체의 위기   (USDC/Circle + 페그 이탈·상환 중단 등)   → 신호 켜짐
  B  준비금을 맡은 곳의 위기   (현재 보관처 + 은행 위기 표현)           → 신호 켜짐
  C  관찰만                     (USDC/Circle + 규제·보안 사건·부정 표현)  → 신호 꺼짐

v0.2 변경 (독립 검토 반영)
  - "circle" 일반 단어 오탐 제거: Circle은 대문자 + USDC/스테이블코인 맥락일 때만 발행사로 본다
  - 2023년 보관처(SVB·Signature·Silvergate)는 실시간 목록에서 뺐다 — 2026년 공시 기준이 아님
  - 다른 코인의 "collapse", 해킹 자금 동결 등은 A가 아니라 C(관찰)
  - "holds peg", "rumors", "denies" 같은 부정·소문 표현은 C로 내린다
"""

from __future__ import annotations

import re
from typing import Any

CI = re.IGNORECASE


def _rx(patterns: list[str], flags: int = CI) -> list[re.Pattern]:
    return [re.compile(p, flags) for p in patterns]


# 발행사·코인. "Circle"은 대소문자 구분 + USDC/스테이블코인 맥락이 같은 제목에 있을 때만.
ISSUER_STRONG = _rx([r"\bUSDC\b", r"\bUSD Coin\b", r"\bCircle Internet\b", r"\bCRCL\b"])
CIRCLE_WORD = re.compile(r"\bCircle\b")  # 대소문자 구분
STABLE_CONTEXT = _rx([r"stablecoin", r"\bUSDC\b", r"\bcrypto"])

# 현재(2026) 준비금 보관처. Circle 공시의 은행·운용사 목록이 바뀌면 갱신할 것.
COUNTERPARTIES = _rx([
    r"\bBNY Mellon\b", r"\bBank of New York Mellon\b", r"\bBNY\b(?= (bank|custod))",
    r"\bCircle Reserve Fund\b", r"\bUSDXX\b",
    r"\bCross River Bank\b", r"\bCustomers Bank(corp)?\b",
])

ISSUER_DISTRESS = _rx([
    r"\bde-?peg(ged|s|ging)?\b", r"\b(lost|loses?|losing) (its |the )?(dollar )?peg\b",
    r"\bbreaks? (its |the )?peg\b",
    r"\bbelow \$1(\.00)?(?![\d.%])",
    r"\bUSD(C| Coin)\b[^.;:]{0,25}\b(at|to|trades? at|falls? to|slips? to|drops? to|sinks? to)\s*\$?0\.(9\d|[0-8]\d)\b",
    r"\bredemptions? (are |were |is )?(halted|paused|suspended|delayed|frozen)\b",
    r"\b(halts?|pauses?|suspends?) (USDC )?(redemptions?|minting|withdrawals?)\b",
    r"\bbank run\b", r"\binsolven(t|cy)\b", r"\breserve (shortfall|gap|hole)\b",
    r"\b(USDC|stablecoin) (collapse|crash)\b",
])

BANK_DISTRESS = _rx([
    r"\bbank run\b", r"\breceivership\b", r"\bFDIC (takes|took|seiz\w*|takeover|steps in)\b",
    r"\binsolven(t|cy)\b", r"\bcollapse[sd]?\b", r"\bbank failure\b", r"\bfail(s|ed)\b",
    r"\bshut(s)? down\b", r"\bseiz(ed|es|ure)\b", r"\bwithdrawals? (halted|frozen|paused|suspended)\b",
    r"\bcapital (raise|shortfall)\b", r"\bemergency (sale|funding|loan)\b", r"\bliquidity crisis\b",
])

# 위기 단어가 있어도 A/B로 올리지 않는 표현 (부정, 소문, 회복)
DOWNGRADE = _rx([
    r"\b(holds?|keeps?|maintains?|regains?|restores?|back to|returns? to) (its |the )?(dollar )?peg\b",
    r"\brumou?rs?\b", r"\bdenies\b", r"\bdenied\b", r"\bfears? (ease|eased|easing|overblown)\b",
    r"\b(years?|months?) after\b", r"\banniversary\b", r"\blessons? from\b",
])

# 관찰: 규제·감독, 보안 사건(해킹 자금 동결 등)
WATCH_ONLY = _rx([
    r"\bMiCA\b", r"\bEBA\b", r"\bGENIUS Act\b", r"\bSEC\b", r"\bregulat\w*", r"\bsupervis\w*",
    r"\blicen[cs]e\w*", r"\bcharter\b", r"\bEU\b", r"\bEEA\b", r"\bdeadline\b", r"\bcomplian\w*",
    r"\bexploit\w*", r"\bhack\w*", r"\bfreez\w*", r"\bfroze(n)?\b", r"\bblacklist\w*",
])


def _first(patterns: list[re.Pattern], text: str) -> str | None:
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


def classify(title: str) -> dict[str, Any] | None:
    """기사 제목 하나를 분류한다. 해당 없음이면 None."""
    issuer = _issuer(title)
    party = _first(COUNTERPARTIES, title)
    softened = _first(DOWNGRADE, title)

    if issuer:
        d = _first(ISSUER_DISTRESS, title)
        if d:
            if softened:
                return {"tier": "C", "who": issuer, "why": f"{d} / {softened}"}
            return {"tier": "A", "who": issuer, "why": d}
    if party:
        d = _first(BANK_DISTRESS, title)
        if d:
            if softened:
                return {"tier": "C", "who": party, "why": f"{d} / {softened}"}
            return {"tier": "B", "who": party, "why": d}
    if issuer:
        w = _first(WATCH_ONLY, title)
        if w:
            return {"tier": "C", "who": issuer, "why": w}
    return None


def news_flag(articles: list[dict[str, Any]]) -> tuple[int, list[dict[str, Any]]]:
    """기사 목록 → (news_risk_flag 0/1, 분류된 기사 목록). 순수 함수."""
    matched = []
    for a in articles:
        c = classify(a.get("title", ""))
        if c:
            matched.append({**a, **c})
    order = {"A": 0, "B": 1, "C": 2}
    matched.sort(key=lambda m: m.get("seen", ""), reverse=True)  # 최신 먼저
    matched.sort(key=lambda m: order[m["tier"]])  # 그다음 등급 순 (안정 정렬)
    flag = 1 if any(m["tier"] in ("A", "B") for m in matched) else 0
    return flag, matched
