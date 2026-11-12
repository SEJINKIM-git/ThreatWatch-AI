"""실시간 분석 함수의 계산 부분 테스트 (네트워크 없이)."""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api", "_depeg"))

from live_core import analyze, completed_candles  # noqa: E402
import news_rubric  # noqa: E402

NOW = datetime(2026, 11, 11, 7, 20, tzinfo=timezone.utc)

# 기준표는 엔진 v2 복사본이라 보관처 목록을 인자로 받는다. 아래 사례는 모두 실시간 화면 기준이므로
# 실시간 분석(live_core)과 똑같이 그 시각에 공개돼 있던 목록을 넘긴다. 기대값은 v0.2 때와 같다.
LIVE_PARTIES = news_rubric.counterparties_at("2026-11-11T00:00:00Z")["names"]


def classify(title):
    return news_rubric.classify(title, LIVE_PARTIES)


def news_flag(articles):
    return news_rubric.news_flag(articles, LIVE_PARTIES)


def test_rubric_is_engine_v2_copy():
    assert news_rubric.RUBRIC_VERSION == "v2"
    with open(news_rubric.__file__, encoding="utf-8") as f:
        assert f.readline().startswith("# AUTO-COPIED from depeg-early-warning/src/intelligence/news_rubric.py")


def test_live_uses_counterparties_at_now():
    out = analyze([candle(6, 1.0)], [{"title": "Cross River Bank collapses as FDIC takes control"}], NOW)
    news = out["inputs"]["news"]
    assert news["flag"] == 1 and news["rubric"] == "v2"
    assert news["counterparties"]["report"] == "2026-09" and news["counterparties"]["banks_from"] == "2023-03"


def candle(hour, close):
    ts = int(datetime(2026, 11, 11, hour, tzinfo=timezone.utc).timestamp())
    return {"timestamp": str(ts), "close": str(close)}


def test_rubric_tiers():
    assert classify("USDC loses peg after Circle reveals $3.3B stuck at SVB")["tier"] == "A"
    # 실시간 목록은 현재(2026) 보관처 기준 — 2023년 은행(SVB 등)은 엔진 저장소의 시점별 목록이 맡는다
    assert classify("Cross River Bank collapses as FDIC takes control")["tier"] == "B"
    assert classify("Silicon Valley Bank collapses as FDIC takes control") is None
    assert classify("Circle's USDC moves to EBA supervision under MiCA")["tier"] == "C"
    assert classify("Bitcoin rallies past record high") is None
    # 은행 이름만 있고 위기 표현이 없으면 해당 없음
    assert classify("BNY Mellon reports quarterly earnings") is None


def test_news_flag_only_for_a_or_b():
    flag, matched = news_flag([{"title": "Circle's USDC moves to EBA supervision under MiCA"}])
    assert flag == 0 and matched[0]["tier"] == "C"
    flag, _ = news_flag([{"title": "Customers Bank halts withdrawals amid bank run"}])
    assert flag == 1


def test_incomplete_candle_is_dropped_and_time_is_close_time():
    rows = completed_candles([candle(5, 1.0), candle(6, 0.9999), candle(7, 0.9998)], NOW)
    # 07:00 캔들은 08:00에 끝나므로 07:20 기준으로는 제외
    assert [r["t"] for r in rows] == ["2026-11-11T06:00:00Z", "2026-11-11T07:00:00Z"]


def test_calm_day_scores_low_and_sends_nothing():
    out = analyze([candle(5, 1.0001), candle(6, 0.9999)], [{"title": "Bitcoin rallies"}], NOW)
    assert out["verdict"] == "ok"
    assert out["event"]["risk_score"] < 10
    assert all(r["now"] in ("dashboard_only", "none") for r in out["recipients"])
    assert out["engine"] != "unknown"


def test_news_flag_adds_ten_points():
    calm = analyze([candle(6, 1.0)], [], NOW)["event"]["risk_score"]
    news = analyze([candle(6, 1.0)], [{"title": "USDC depeg fears as redemptions paused"}], NOW)
    assert round(news["event"]["risk_score"] - calm, 1) == 10.0
    assert news["inputs"]["news"]["flag"] == 1


def test_google_news_rss_parsing():
    from news_feeds import parse_google_news_rss
    xml = """<?xml version="1.0"?><rss><channel>
    <item><title>USDC redemptions paused for EEA holders - CoinDesk</title>
    <link>https://news.google.com/rss/articles/abc</link>
    <pubDate>Wed, 11 Nov 2026 05:12:00 GMT</pubDate>
    <source url="https://www.coindesk.com">CoinDesk</source></item>
    </channel></rss>"""
    [a] = parse_google_news_rss(xml)
    assert a["title"] == "USDC redemptions paused for EEA holders"
    assert a["domain"] == "CoinDesk"
    assert a["seen"] == "20261111T051200Z"
    assert classify(a["title"])["tier"] == "A"


def test_real_headlines_from_2026_11_11():
    """2026-11-11 Google News 실제 제목 — 사업 뉴스는 무시, 규제 일정은 관찰, 위기 신호는 없음."""
    assert classify("Goldman, Citi Among Banks in $270 Million Stablecoin Backing") is None
    assert classify("PNC Launches USDC Payments Pilot With Coinbase") is None
    c = classify("Crypto News Today: Waller's Rate-Hike Warning, MARA's $1.1B Bitcoin Sale and USDC's EU Deadline")
    assert c["tier"] == "C"


# ---- 독립 검토(2026-11-11)에서 나온 오탐·미탐 사례 ----

def test_review_false_positives_are_not_alarms():
    def tier(t):
        c = classify(t)
        return c and c["tier"]
    # 해킹 자금 동결은 흔한 준법 뉴스 → 관찰
    assert tier("Circle freezes $2M in USDC linked to Bybit exploit") == "C"
    # 다른 코인의 폭락
    assert tier("Bitcoin price collapse sends traders into USDC") is None
    # 일반 단어 circle
    assert tier("Trump's inner circle faces collapse after vote") is None
    # 이자율 1% 미만
    assert tier("USDC lending yields fall below 1%") is None
    # 부정·소문
    assert tier("USDC holds peg despite rumors of depeg") == "C"
    # 지난 사건 회고, 2023년 보관처
    assert tier("Two years after SVB collapse, regional banks recover") is None
    # 흔한 BlackRock 뉴스, 지명 Cross River, FDIC 단독
    assert tier("BlackRock bitcoin ETF fails to attract inflows") is None
    assert tier("Cross River State bridge collapse kills three") is None
    assert tier("BNY Mellon reports FDIC assessment charge") is None


def test_review_misses_are_caught():
    assert classify("USD Coin slips to 0.98 as traders rush to exit")["tier"] == "A"
    assert classify("Circle halts USDC minting after banking partner issue")["tier"] == "A"
    assert classify("BNY Mellon hit by bank run fears, withdrawals halted")["tier"] == "B"


def test_news_outage_is_unknown_not_safe():
    out = analyze([candle(6, 1.0)], [], NOW, news_error="news feed unavailable: timeout")
    assert out["inputs"]["news"]["flag"] is None
    metrics = [f["metric"] for f in out["event"]["top_factors"]]
    assert "news_risk_flag" not in metrics
    ok = analyze([candle(6, 1.0)], [], NOW)
    assert out["event"]["confidence"] < ok["event"]["confidence"]


def test_old_articles_and_stale_price():
    old = {"title": "USDC depeg fears as redemptions paused", "seen": "20261109T000000Z"}
    out = analyze([candle(6, 1.0)], [old], NOW)
    assert out["inputs"]["news"]["flag"] == 0
    stale = analyze([candle(2, 1.0)], [], NOW)
    assert stale["inputs"]["price_stale"] is True
    assert analyze([candle(6, 1.0)], [], NOW)["inputs"]["price_stale"] is False
