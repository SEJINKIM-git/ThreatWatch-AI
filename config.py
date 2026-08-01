"""
설정 관리
"""

import os
from dotenv import load_dotenv

load_dotenv()

# AWS 리전 (SSM 클라이언트 생성에 필요하므로 모듈 최상단에서 먼저 해석)
_AWS_REGION = os.getenv('AWS_REGION', 'ap-northeast-2')

# SSM 파라미터 캐시 (같은 파라미터 반복 조회 방지)
_ssm_cache = {}
_ssm_client = None


def _get_ssm_parameter(name: str) -> str:
    """SSM Parameter Store 조회. 실패하면 빈 문자열 반환 (로컬 개발 환경 지원)"""
    global _ssm_client

    if name in _ssm_cache:
        return _ssm_cache[name]

    value = ''
    try:
        if _ssm_client is None:
            import boto3
            from botocore.config import Config as BotoConfig
            _ssm_client = boto3.client(
                'ssm',
                region_name=_AWS_REGION,
                config=BotoConfig(connect_timeout=2, retries={'max_attempts': 1}),
            )
        value = _ssm_client.get_parameter(Name=name, WithDecryption=True)['Parameter']['Value']
    except Exception:
        value = ''

    _ssm_cache[name] = value
    return value


def _resolve(env_key: str, ssm_name: str = None, default: str = '') -> str:
    """.env → SSM Parameter Store → 기본값 순으로 설정 해석"""
    value = os.getenv(env_key)
    if value:
        return value

    if ssm_name:
        value = _get_ssm_parameter(ssm_name)
        if value:
            return value

    return default


class Config:
    """애플리케이션 설정"""

    # AWS
    AWS_REGION = _AWS_REGION
    S3_AUDIT_BUCKET = os.getenv('S3_AUDIT_BUCKET', '')

    # Anthropic
    ANTHROPIC_API_KEY = _resolve('ANTHROPIC_API_KEY', '/threatwatch/anthropic-api-key')

    # Gmail
    GMAIL_USER = _resolve('GMAIL_USER', '/threatwatch/gmail-user')
    GMAIL_APP_PASSWORD = _resolve('GMAIL_APP_PASSWORD', '/threatwatch/gmail-app-password')
    ALERT_RECIPIENT = os.getenv('ALERT_RECIPIENT', 'security@company.com')

    # Google Sheets
    GOOGLE_SHEETS_CREDENTIALS_PATH = os.getenv('GOOGLE_SHEETS_CREDENTIALS_PATH', './credentials.json')
    GOOGLE_SHEET_ID = os.getenv('GOOGLE_SHEET_ID', '')

    # Workflow
    MAX_RETRIES = int(os.getenv('MAX_RETRIES', 3))
    DEMO_MODE = os.getenv('DEMO_MODE', 'true').lower() == 'true'

    @classmethod
    def validate(cls):
        """필수 설정 검증"""
        if not cls.ANTHROPIC_API_KEY and not cls.DEMO_MODE:
            raise ValueError("ANTHROPIC_API_KEY is required")
        return True
