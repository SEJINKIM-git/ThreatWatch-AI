"""뉴스 기준표 v0 — 기사 제목을 정해진 규칙으로만 분류한다 (AI 판단 없음).

같은 기사에는 항상 같은 결과가 나와야 과거 데이터로 검증(백테스트)할 수 있다.
AI는 이 분류를 바꾸지 않고, 나중에 사람이 읽을 설명 문장만 쓴다.

v0 은 대시보드 실시간 화면용 임시 위치다. 정식 버전은
depeg-early-warning/src/intelligence/ 에 만들고, 이 파일은 그 복사본으로 교체한다.

등급
  A  발행사·코인 자체의 위기   (USDC/Circle + 위기 표현)            → 신호 켜짐
  B  준비금을 맡은 곳의 위기   (보관 은행·펀드 + 금융 위기 표현)     → 신호 켜짐
  C  관찰만                     (USDC/Circle + 규제·감독 표현)       → 신호 꺼짐, 목록에만 표시
"""

from __future__ import annotations

import re
from typing import Any

# 발행사·코인
ISSUER = [r"USDC", r"USD Coin", r"Circle Internet", r"\bCircle\b"]

# 준비금을 맡은 곳. 최신 Circle 공시의 은행·운용사 목록으로 갱신할 것.
# 2023년 1월 공시(2023-01-25 발행)의 현금 예치 은행에는 SVB, Signature, Silvergate가 있었다.
COUNTERPARTIES = [
    r"BNY Mellon", r"Bank of New York Mellon", r"BlackRock", r"Circle Reserve Fund",
    r"Silicon Valley Bank", r"\bSVB\b", r"Signature Bank", r"Silvergate",
    r"Cross River", r"Customers Bank",
]

ISSUER_DISTRESS = [
    r"de-?peg", r"lost (its|the) peg", r"loses? peg", r"below \$?1\b", r"\$0\.9\d",
    r"redemptions? (halted|paused|suspended|delayed)", r"halts? redemptions?",
    r"bank run", r"insolven", r"collapse", r"frozen", r"exploit", r"hack(ed)?\b",
    r"reserve (shortfall|gap|exposure)", r"stuck at", r"trapped",
]

BANK_DISTRESS = [
    r"bank run", r"receivership", r"\bFDIC\b", r"insolven", r"collapse", r"fail(s|ed|ure)\b",
    r"shut(s)? down", r"seiz(e|ed|ure)", r"withdrawals? (halted|frozen|paused)",
    r"capital (raise|shortfall)", r"emergency (sale|funding)", r"liquidity crisis",
]

WATCH_ONLY = [
    r"\bMiCA\b", r"\bEBA\b", r"GENIUS Act", r"\bSEC\b", r"regulat", r"supervis",
    r"licen[cs]e", r"charter",
]


def _hits(patterns: list[str], text: str) -> list[str]:
    out = []
    for p in patterns:
        m = re.search(p, text, flags=re.IGNORECASE)
        if m:
            out.append(m.group(0))
    return out


def classify(title: str) -> dict[str, Any] | None:
    """기사 제목 하나를 분류한다. 해당 없음이면 None."""
    issuer = _hits(ISSUER, title)
    party = _hits(COUNTERPARTIES, title)

    if issuer:
        d = _hits(ISSUER_DISTRESS, title)
        if d:
            return {"tier": "A", "who": issuer[0], "why": d[0]}
    if party:
        d = _hits(BANK_DISTRESS, title)
        if d:
            return {"tier": "B", "who": party[0], "why": d[0]}
    if issuer:
        w = _hits(WATCH_ONLY, title)
        if w:
            return {"tier": "C", "who": issuer[0], "why": w[0]}
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
