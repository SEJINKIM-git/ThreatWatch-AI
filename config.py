"""
설정 관리
"""

import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    """애플리케이션 설정"""
    
    # Anthropic
    ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY', '')
    
    # Gmail
    GMAIL_USER = os.getenv('GMAIL_USER', '')
    GMAIL_APP_PASSWORD = os.getenv('GMAIL_APP_PASSWORD', '')
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
