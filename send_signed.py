#!/usr/bin/env python3
"""
서명된 요청 전송 도구

사용법:
    export API_URL=... API_KEY=... HMAC_SECRET=...
    python send_signed.py '{"incident_type":"ransomware","severity":"critical"}'

    # 재전송 테스트 (같은 논스를 두 번 사용)
    python send_signed.py --replay '{"incident_type":"test","severity":"low"}'

    # 시계 오차 테스트
    python send_signed.py --skew 600 '{"incident_type":"test","severity":"low"}'
"""

import argparse
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.request


def build_headers(secret: str, api_key: str, skew: int = 0, nonce: str = None) -> dict:
    """서명 헤더를 만듭니다."""
    timestamp = str(int(time.time()) + skew)
    nonce = nonce or secrets.token_hex(16)

    signature = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{nonce}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "x-tw-timestamp": timestamp,
        "x-tw-nonce": nonce,
        "x-tw-signature": signature,
    }


def send(url: str, body: str, headers: dict) -> tuple:
    req = urllib.request.Request(
        url, data=body.encode("utf-8"), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("body", help="JSON 요청 본문")
    parser.add_argument("--replay", action="store_true", help="같은 논스로 두 번 전송")
    parser.add_argument("--skew", type=int, default=0, help="타임스탬프 오차(초)")
    parser.add_argument("--no-sign", action="store_true", help="서명 헤더 없이 전송")
    args = parser.parse_args()

    url = os.environ.get("API_URL")
    api_key = os.environ.get("API_KEY", "")
    secret = os.environ.get("HMAC_SECRET")

    if not url:
        sys.exit("API_URL not set")
    if not secret and not args.no_sign:
        sys.exit("HMAC_SECRET not set")

    # 본문 유효성을 미리 확인합니다.
    json.loads(args.body)

    if args.no_sign:
        headers = {"Content-Type": "application/json", "x-api-key": api_key}
        status, text = send(url, args.body, headers)
        print(f"[unsigned] {status}  {text[:200]}")
        return

    nonce = secrets.token_hex(16)
    headers = build_headers(secret, api_key, args.skew, nonce)

    status, text = send(url, args.body, headers)
    label = f"skew={args.skew}" if args.skew else "signed"
    print(f"[{label}] {status}  {text[:200]}")

    if args.replay:
        # 동일한 헤더를 그대로 재사용합니다. 논스가 이미 소비되었으므로
        # 두 번째 요청은 거부되어야 합니다.
        status, text = send(url, args.body, headers)
        print(f"[replay] {status}  {text[:200]}")


if __name__ == "__main__":
    main()
