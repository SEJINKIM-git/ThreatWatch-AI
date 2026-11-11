"""POST /api/depeg-sim — 장면 3: 모의 위기 파일 채점과 (시연 키가 맞을 때만) 실제 경보 전송

요청 본문 (JSON)
  {"action": "score", "rows": [...]}                      → 행별 점수 (누구나 가능, 아무것도 보내지 않음)
  {"action": "alert", "rows": [...], "index": N, "label": "파일명"}
      + 헤더 x-demo-key: <DEPEG_DEMO_KEY>                 → N번째 행으로 ThreatWatch에 실제 경보 1건 전송

보호
  - 실제 전송은 Vercel 환경 변수 DEPEG_DEMO_KEY 와 같은 키를 가진 요청만 가능하다 (공개 페이지 남용 방지)
  - 점수와 경보 본문은 서버가 엔진·어댑터로 다시 계산한다. 브라우저가 보낸 점수는 믿지 않는다
  - 서명 비밀값(TW_HMAC_SECRET 등)은 서버에만 있다. 서명 규칙은 ThreatWatch send_signed.py 와 같다
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_depeg"))

from sim_core import (  # noqa: E402
    THRESHOLD_ALERT, THRESHOLD_SEND, RowError, build_alert, first_send_index,
    score_rows, validate_rows,
)

MAX_BODY = 400_000


def sign_headers(secret: str, api_key: str) -> dict[str, str]:
    """ThreatWatch send_signed.build_headers 와 같은 규칙: HMAC-SHA256(secret, "<ts>.<nonce>")."""
    ts = str(int(time.time()))
    nonce = secrets.token_hex(16)
    sig = hmac.new(secret.encode(), f"{ts}.{nonce}".encode(), hashlib.sha256).hexdigest()
    return {
        "Content-Type": "application/json", "x-api-key": api_key,
        "x-tw-timestamp": ts, "x-tw-nonce": nonce, "x-tw-signature": sig,
    }


def send_to_threatwatch(alert: dict) -> tuple[int, str]:
    url = os.environ["TW_API_URL"].rstrip("/") + "/alerts"
    req = urllib.request.Request(
        url, data=json.dumps(alert).encode(), method="POST",
        headers=sign_headers(os.environ["TW_HMAC_SECRET"], os.environ["TW_API_KEY"]),
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode("utf-8", "replace")[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]


class handler(BaseHTTPRequestHandler):  # noqa: N801 — Vercel 규약
    def do_GET(self):  # noqa: N802
        # 화면이 "실제 발송 가능 여부"를 미리 알 수 있게 한다 (키 값은 절대 내보내지 않음)
        configured = all(os.environ.get(k) for k in ("DEPEG_DEMO_KEY", "TW_API_URL", "TW_API_KEY", "TW_HMAC_SECRET"))
        self._send(200, {"send_configured": configured, "threshold_send": THRESHOLD_SEND,
                         "threshold_alert": THRESHOLD_ALERT})

    def do_POST(self):  # noqa: N802
        try:
            n = int(self.headers.get("content-length") or 0)
            if n <= 0 or n > MAX_BODY:
                return self._send(413 if n > MAX_BODY else 400, {"error": "요청 본문 크기가 맞지 않습니다"})
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            rows, columns = validate_rows(body.get("rows"))
        except RowError as e:
            return self._send(400, {"error": str(e)})
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "JSON 형식이 아닙니다"})

        action = body.get("action")
        if action == "score":
            scores = score_rows(rows)
            return self._send(200, {
                "scores": scores, "columns": columns,
                "send_index": first_send_index(scores),
                "threshold_send": THRESHOLD_SEND, "threshold_alert": THRESHOLD_ALERT,
            })

        if action == "alert":
            expected = os.environ.get("DEPEG_DEMO_KEY", "")
            given = self.headers.get("x-demo-key", "")
            if not expected:
                return self._send(503, {"error": "시연 키(DEPEG_DEMO_KEY)가 이 배포에 설정되지 않았습니다"})
            if not hmac.compare_digest(expected.encode(), given.encode()):
                return self._send(401, {"error": "시연 키가 맞지 않습니다"})
            if not all(os.environ.get(k) for k in ("TW_API_URL", "TW_API_KEY", "TW_HMAC_SECRET")):
                return self._send(503, {"error": "ThreatWatch 연결 정보가 이 배포에 없습니다"})
            try:
                built = build_alert(rows, int(body.get("index", -1)), str(body.get("label", "")))
            except (RowError, ValueError) as e:
                return self._send(400, {"error": str(e)})
            status, text = send_to_threatwatch(built["alert"])
            if status >= 300:
                return self._send(502, {"error": f"ThreatWatch가 경보를 거부했습니다 (HTTP {status})", "detail": text})
            return self._send(202, {
                "alert_id": built["alert"]["alert_id"], "severity": built["alert"]["severity"],
                "score": built["event"]["risk_score"], "accepted": True,
            })

        return self._send(400, {"error": "action 은 score 또는 alert 이어야 합니다"})

    def _send(self, status: int, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)
