"""GET /api/depeg-live — 오늘 기준 실시간 디페그 분석 (읽기 전용, 아무것도 발송하지 않음)

1) Bitstamp 공개 API에서 USDC/USD 최근 1시간 캔들
2) 최근 24시간 관련 기사 제목 — Google News RSS 우선, 실패하면 GDELT
   (GDELT는 Vercel 서버에서 TLS 접속이 자주 시간 초과돼 예비로만 쓴다)
3) 최신 Circle 공시 값
→ 기준표로 뉴스 분류 → 엔진(risk_score.py 복사본)으로 점수 → 수신자 미리보기

비밀값을 쓰지 않는다. 경보를 실제로 보내는 일은 이 함수가 하지 않는다.
결과는 10분 동안 CDN에 캐시한다 (외부 API 호출 횟수 제한 대응).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_depeg"))

from live_core import analyze  # noqa: E402
from news_feeds import parse_google_news_rss  # noqa: E402

UA = {"User-Agent": "threatwatch-depeg-dashboard/1.0"}
BITSTAMP = "https://www.bitstamp.net/api/v2/ohlc/usdcusd/?step=3600&limit=26"
NEWS_QUERY = (
    '(USDC OR "USD Coin" OR "Circle Internet" OR stablecoin OR "Circle Reserve Fund" '
    'OR "BNY Mellon") when:1d'
)
GOOGLE_NEWS = (
    "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="
    + urllib.parse.quote(NEWS_QUERY)
)
GDELT_QUERY = (
    '(USDC OR "USD Coin" OR "Circle Internet" OR stablecoin OR "Circle Reserve Fund" '
    'OR "BNY Mellon") sourcelang:english'
)
GDELT = (
    "https://api.gdeltproject.org/api/v2/doc/doc?mode=ArtList&format=json&sort=DateDesc"
    "&maxrecords=150&timespan=24h&query=" + urllib.parse.quote(GDELT_QUERY)
)


def _get_text(url: str, timeout: float) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def _get_json(url: str, timeout: float = 8.0):
    return json.loads(_get_text(url, timeout))


def fetch_prices() -> list[dict]:
    return _get_json(BITSTAMP)["data"]["ohlc"]


def fetch_google_news() -> list[dict]:
    return parse_google_news_rss(_get_text(GOOGLE_NEWS, timeout=6.0))


def fetch_gdelt() -> list[dict]:
    data = _get_json(GDELT, timeout=5.0)
    out = []
    for a in data.get("articles", []):
        out.append({
            "title": a.get("title", "").strip(),
            "url": a.get("url", ""),
            "domain": a.get("domain", ""),
            "seen": a.get("seendate", ""),
        })
    return out


def fetch_articles() -> tuple[list[dict], str]:
    """(기사 목록, 출처 이름). 첫 출처가 실패하면 다음 출처를 쓴다."""
    errors = []
    for name, fn in (("Google News RSS", fetch_google_news), ("GDELT DOC 2.0", fetch_gdelt)):
        try:
            return fn(), name
        except Exception as e:  # noqa: BLE001 — 다음 출처로 넘어간다
            errors.append(f"{name}: {e}")
    raise RuntimeError(" / ".join(errors))


class handler(BaseHTTPRequestHandler):  # noqa: N801 — Vercel 규약
    def do_GET(self):  # noqa: N802
        now = datetime.now(timezone.utc)
        try:
            ohlc = fetch_prices()
        except Exception as e:  # 가격이 없으면 점수를 낼 수 없다
            return self._send(502, {"error": f"price feed unavailable: {e}"}, cache=False)

        news_error, source = None, "none"
        try:
            articles, source = fetch_articles()
        except Exception as e:
            # 뉴스가 막혀도 가격·공시로는 점수를 낸다. 화면에 '뉴스 확인 불가'로 표시한다.
            articles, news_error = [], f"news feed unavailable: {e}"

        try:
            result = analyze(ohlc, articles, now, news_error=news_error, news_source=source)
        except Exception as e:
            return self._send(500, {"error": str(e)}, cache=False)
        return self._send(200, result, cache=news_error is None)

    def _send(self, status: int, body: dict, cache: bool):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header(
            "Cache-Control",
            "public, s-maxage=600, stale-while-revalidate=300" if cache else "no-store",
        )
        self.end_headers()
        self.wfile.write(data)
