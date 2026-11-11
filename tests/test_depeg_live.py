"""실시간 분석 함수의 계산 부분 테스트 (네트워크 없이)."""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api", "_depeg"))

from live_core import analyze, completed_candles  # noqa: E402
from news_rubric import classify, news_flag  # noqa: E402

NOW = datetime(2026, 11, 11, 7, 20, tzinfo=timezone.utc)


def candle(hour, close):
    ts = int(datetime(2026, 11, 11, hour, tzinfo=timezone.utc).timestamp())
    return {"timestamp": str(ts), "close": str(close)}


def test_rubric_tiers():
    assert classify("USDC loses peg after Circle reveals $3.3B stuck at SVB")["tier"] == "A"
    assert classify("Silicon Valley Bank collapses as FDIC takes control")["tier"] == "B"
    assert classify("Circle's USDC moves to EBA supervision under MiCA")["tier"] == "C"
    assert classify("Bitcoin rallies past record high") is None
    # 은행 이름만 있고 위기 표현이 없으면 해당 없음
    assert classify("BNY Mellon reports quarterly earnings") is None


def test_news_flag_only_for_a_or_b():
    flag, matched = news_flag([{"title": "Circle's USDC moves to EBA supervision under MiCA"}])
    assert flag == 0 and matched[0]["tier"] == "C"
    flag, _ = news_flag([{"title": "Silvergate halts withdrawals frozen amid bank run"}])
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
