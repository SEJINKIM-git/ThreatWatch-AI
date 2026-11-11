"""
테스트 공통 설정

config.py는 import 시점에 .env → SSM 순으로 시크릿을 해석합니다.
더미 값을 먼저 넣어 테스트가 SSM 네트워크 조회(타임아웃 2초씩)를
기다리지 않게 합니다.
"""

import os
import sys

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("GMAIL_USER", "test")
os.environ.setdefault("GMAIL_APP_PASSWORD", "test")

# 저장소 루트를 import 경로에 추가합니다 (modules/, lambda_handler 등).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
