"""
11_Log_to_GoogleSheets
Google Sheets 로깅
"""

import gspread
from google.oauth2.service_account import Credentials
from models import WorkflowState
from config import Config
import logging

logger = logging.getLogger(__name__)


class GoogleSheetsLogger:
    """Google Sheets 로거"""
    
    def __init__(self):
        self.client = None
        self.sheet = None
        
        if not Config.DEMO_MODE:
            try:
                creds = Credentials.from_service_account_file(
                    Config.GOOGLE_SHEETS_CREDENTIALS_PATH,
                    scopes=['https://www.googleapis.com/auth/spreadsheets']
                )
                self.client = gspread.authorize(creds)
                self.sheet = self.client.open_by_key(Config.GOOGLE_SHEET_ID).sheet1
            except Exception as e:
                logger.warning(f"⚠️ Google Sheets init failed: {e}")
    
    def log_incident(self, state: WorkflowState) -> bool:
        """사건 로그 기록"""
        
        payload = state.final_payload
        
        row_data = [
            payload.timestamp,
            payload.alert_id,
            payload.risk_level,
            payload.risk_score,
            payload.incident_type,
            payload.summary,
            payload.missing_data_count,
            payload.confidence
        ]
        
        if Config.DEMO_MODE or not self.sheet:
            logger.info("📝 [DEMO MODE] Would log to Google Sheets:")
            logger.info(f"   {row_data}")
            return True
        
        try:
            self.sheet.append_row(row_data)
            logger.info(f"✅ Logged to Google Sheets: {payload.alert_id}")
            return True
        except Exception as e:
            logger.error(f"❌ Google Sheets logging failed: {e}")
            return False
