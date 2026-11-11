"""GET /api/depeg-live — 오늘 기준 실시간 디페그 분석 (읽기 전용, 아무것도 발송하지 않음)

1) Bitstamp 공개 API에서 USDC/USD 최근 1시간 캔들
2) 최근 24시간 관련 기사 제목 — Google News RSS 우선, 실패하면 GDELT
   (GDELT는 Vercel 서버에서 TLS 접속이 자주 시간 초과돼 예비로만 쓴다)
3) 최신 Circle 공시 값
→ 기준표로 뉴스 분류 → 엔진(risk_score.py 복사본)으로 점수 → 수신자 미리보기

비밀값을 쓰지 않는다. 경보를 실제로 보내는 일은 이 함수가 하지 않는다.
결과는 CDN에 최대 10분 캐시한다 (외부 API 호출 횟수 제한 대응).
시간 예산: 함수 전체 17초 안에 끝낸다 (vercel.json maxDuration 20초).
"""

from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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


BUDGET_S = 17.0


def fetch_prices(timeout: float = 5.0) -> list[dict]:
    return _get_json(BITSTAMP, timeout=timeout)["data"]["ohlc"]


def fetch_google_news(timeout: float = 6.0) -> list[dict]:
    return parse_google_news_rss(_get_text(GOOGLE_NEWS, timeout=timeout))


def fetch_gdelt(timeout: float = 5.0) -> list[dict]:
    data = _get_json(GDELT, timeout=timeout)
    out = []
    for a in data.get("articles", []):
        out.append({
            "title": a.get("title", "").strip(),
            "url": a.get("url", ""),
            "domain": a.get("domain", ""),
            "seen": a.get("seendate", ""),
        })
    return out


def fetch_articles(timeout: float) -> tuple[list[dict], str]:
    """(기사 목록, 출처 이름). 두 출처를 동시에 부르고 Google News를 우선한다.
    timeout 은 남은 시간 예산 — 소켓 단위 타임아웃이 아니라 전체 대기 상한으로 쓴다."""
    sources = (("Google News RSS", fetch_google_news), ("GDELT DOC 2.0", fetch_gdelt))
    results, errors = {}, []
    pool = ThreadPoolExecutor(max_workers=2)
    futures = {pool.submit(fn, timeout): name for name, fn in sources}
    try:
        for fut in as_completed(futures, timeout=timeout):
            name = futures[fut]
            try:
                results[name] = fut.result()
            except Exception as e:  # noqa: BLE001 — 다른 출처를 쓴다
                errors.append(f"{name}: {e}")
            if "Google News RSS" in results:
                break
    except TimeoutError:
        errors.append(f"timed out after {timeout:.0f}s")
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    for name, _ in sources:
        if name in results:
            return results[name], name
    raise RuntimeError(" / ".join(errors) or "no news source answered")


class handler(BaseHTTPRequestHandler):  # noqa: N801 — Vercel 규약
    def do_GET(self):  # noqa: N802
        started = time.monotonic()
        now = datetime.now(timezone.utc)
        try:
            ohlc = fetch_prices()
        except Exception as e:  # 가격이 없으면 점수를 낼 수 없다
            return self._send(502, {"error": f"price feed unavailable: {e}"}, cache=False)

        news_error, source = None, "unavailable"
        try:
            remaining = max(1.0, BUDGET_S - (time.monotonic() - started))
            articles, source = fetch_articles(min(8.0, remaining))
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
            "public, s-maxage=540, stale-while-revalidate=60" if cache else "no-store",
        )
        self.end_headers()
        self.wfile.write(data)
