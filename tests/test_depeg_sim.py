"""장면 3 — 모의 위기 파일 채점·경보 본문·보호 로직 테스트 (네트워크 없이)."""
import csv
import io
import json
import os
import sys
import importlib.util

import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "api", "_depeg"))

from sim_core import RowError, build_alert, first_send_index, score_rows, validate_rows  # noqa: E402


def template_rows():
    with open(os.path.join(ROOT, "public", "depeg", "sim-template.csv"), encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_template_spikes_once_and_sends_at_peak_hour():
    rows, cols = validate_rows(template_rows())
    scores = score_rows(rows)
    calm = [s["score"] for s in scores[:36]]
    assert max(calm) < 20  # 평온 구간
    i = first_send_index(scores)
    assert i == 39 and scores[i]["score"] >= 85  # 2026-11-26T15:00Z 급증 (39시간째)
    assert scores[37]["score"] < 70  # 2시간 전에는 아직 기준선 아래 → '갑자기'
    assert "news_risk_flag" in cols


def test_build_alert_is_high_and_labelled():
    rows, _ = validate_rows(template_rows())
    built = build_alert(rows, 39, "my_crisis.csv")
    a = built["alert"]
    assert a["severity"] == "high"
    assert a["incident_type"] == "stablecoin_depeg_risk_usdc"
    assert a["description"].startswith("[DEMO SIMULATION · my_crisis.csv · 2026-11-26T15:00:00Z]")
    assert a["alert_id"] == built["event"]["event_id"]
    with pytest.raises(RowError):
        build_alert(rows, 0, "x")  # 평온한 행으로는 보낼 수 없다


@pytest.mark.parametrize("bad,msg", [
    ([{"t": "2026-11-25 00:00", "price_usd": 1}], "t"),
    ([{"t": "2026-11-25T00:00:00Z", "price_usd": "abc"}], "price_usd"),
    ([{"t": "2026-11-25T00:00:00Z", "price_usd": 1, "pool_imbalance_ratio": 1.5}], "pool_imbalance_ratio"),
    ([{"t": "2026-11-25T01:00:00Z", "price_usd": 1}, {"t": "2026-11-25T00:00:00Z", "price_usd": 1}], "늘어나야"),
    ([{"t": "2026-11-25T00:00:00Z", "price_usd": 1, "news_risk_flag": 0.5}], "news_risk_flag"),
])
def test_validation_errors_name_row_and_column(bad, msg):
    with pytest.raises(RowError) as e:
        validate_rows(bad)
    assert msg in str(e.value)


def test_missing_columns_are_not_invented():
    rows, cols = validate_rows([{"t": "2026-11-25T00:00:00Z", "price_usd": 0.95}])
    assert "redemption_volume_usd" not in rows[0] and "news_risk_flag" not in rows[0]
    assert rows[0]["reserve_cash_ratio"] == 0.1377  # 공시 기본값만 채운다


# ---- 엔드포인트 보호 ----

def load_handler():
    spec = importlib.util.spec_from_file_location("sim", os.path.join(ROOT, "api", "depeg-sim.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class FakeReq:
    def __init__(self, mod, body, headers):
        raw = json.dumps(body).encode()
        self.h = mod.handler.__new__(mod.handler)
        self.h.headers = {"content-length": str(len(raw)), **headers}
        self.h.rfile = io.BytesIO(raw)
        self.h.wfile = io.BytesIO()
        self.status = None
        self.h.send_response = lambda s: setattr(self, "status", s)
        self.h.send_header = lambda *a: None
        self.h.end_headers = lambda: None

    def json(self):
        return json.loads(self.h.wfile.getvalue())


def test_alert_requires_matching_demo_key(monkeypatch):
    m = load_handler()
    sent = []
    monkeypatch.setattr(m, "send_to_threatwatch", lambda a: sent.append(a) or (202, "{}"))
    for k in ("TW_API_URL", "TW_API_KEY", "TW_HMAC_SECRET"):
        monkeypatch.setenv(k, "x")
    body = {"action": "alert", "rows": template_rows(), "index": 39, "label": "t.csv"}

    monkeypatch.delenv("DEPEG_DEMO_KEY", raising=False)
    r = FakeReq(m, body, {}); r.h.do_POST()
    assert r.status == 503 and not sent

    monkeypatch.setenv("DEPEG_DEMO_KEY", "right")
    r = FakeReq(m, body, {"x-demo-key": "wrong"}); r.h.do_POST()
    assert r.status == 401 and not sent

    r = FakeReq(m, body, {"x-demo-key": "right"}); r.h.do_POST()
    assert r.status == 202 and len(sent) == 1 and sent[0]["severity"] == "high"
    assert r.json()["alert_id"] == sent[0]["alert_id"]


def test_score_action_sends_nothing(monkeypatch):
    m = load_handler()
    monkeypatch.setattr(m, "send_to_threatwatch", lambda a: pytest.fail("score must not send"))
    r = FakeReq(m, {"action": "score", "rows": template_rows()}, {}); r.h.do_POST()
    assert r.status == 200 and r.json()["send_index"] == 39


def test_signature_matches_threatwatch_rule(monkeypatch):
    m = load_handler()
    monkeypatch.setattr(m.time, "time", lambda: 1700000000)
    monkeypatch.setattr(m.secrets, "token_hex", lambda n: "ab" * n)
    h = m.sign_headers("test-secret", "k")
    import hashlib, hmac
    expected = hmac.new(b"test-secret", f"1700000000.{'ab' * 16}".encode(), hashlib.sha256).hexdigest()
    assert h["x-tw-signature"] == expected and h["x-tw-timestamp"] == "1700000000"


def test_rehearsal_file_crosses_lines_at_known_hours():
    """리허설용 24시간 파일 (public/depeg/sim-rehearsal.csv) — 시각마다 무엇이 일어나는지 고정한다.
    06Z 뉴스 신호 → 12Z 경보 기준 70 → 13Z 사람 승인 기준 85(여기서 1건 발송) → 14Z 최저점 → 회복."""
    with open(os.path.join(ROOT, "public", "depeg", "sim-rehearsal.csv"), encoding="utf-8") as f:
        rows, cols = validate_rows(list(csv.DictReader(f)))
    scores = score_rows(rows)
    assert len(rows) == 24 and "news_risk_flag" in cols
    assert max(s["score"] for s in scores[:6]) < 10  # 평상시
    assert scores[6]["score"] - scores[5]["score"] >= 10 and scores[6]["bps"] > -5  # 뉴스가 가격보다 먼저
    first70 = next(i for i, s in enumerate(scores) if s["score"] >= 70)
    assert first70 == 12
    assert first_send_index(scores) == 13 and scores[13]["t"] == "2026-11-25T13:00:00Z"
    assert min(range(24), key=lambda i: scores[i]["bps"]) == 14
    assert scores[-1]["score"] < 10  # 회복
    built = build_alert(rows, 13, "sim-rehearsal.csv")
    assert built["alert"]["severity"] == "high"
    assert built["alert"]["description"].startswith("[DEMO SIMULATION · sim-rehearsal.csv · 2026-11-25T13:00:00Z]")
