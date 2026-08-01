"""
10_Send_Alert_Email
이메일 알림 발송
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from models import WorkflowState
from config import Config
import logging

logger = logging.getLogger(__name__)


class EmailNotifier:
    """이메일 발송"""
    
    @staticmethod
    def send_alert(state: WorkflowState) -> bool:
        """알림 이메일 발송"""
        subject = EmailNotifier._create_subject(state)
        
        if Config.DEMO_MODE:
            logger.info("📧 [DEMO MODE] Email would be sent")
            logger.info(f"   To: {Config.ALERT_RECIPIENT}")
            logger.info(f"   Subject: {subject}")
            return True
        
        try:
            payload = state.final_payload
            
            # 이메일 구성
            msg = MIMEMultipart('alternative')
            msg['From'] = Config.GMAIL_USER
            msg['To'] = Config.ALERT_RECIPIENT
            msg['Subject'] = subject
            
            # HTML 본문
            html_body = EmailNotifier._create_html_body(state)
            msg.attach(MIMEText(html_body, 'html'))
            
            # 발송
            with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                server.login(Config.GMAIL_USER, Config.GMAIL_APP_PASSWORD)
                server.send_message(msg)
            
            logger.info(f"✅ Email sent to {Config.ALERT_RECIPIENT}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Email send failed: {e}")
            return False

    @staticmethod
    def _create_subject(state: WorkflowState) -> str:
        """이메일 제목 생성"""
        payload = state.final_payload
        precheck = state.precheck_result

        if precheck and precheck.decision == "ESCALATE":
            return f"⚠️ Data Request - Missing Context for {payload.alert_id}"

        return f"🚨 [{payload.risk_level}] Security Alert - {payload.alert_id}"
    
    @staticmethod
    def _create_html_body(state: WorkflowState) -> str:
        """HTML 이메일 본문 생성"""
        payload = state.final_payload
        precheck = state.precheck_result
        is_missing_data_escalation = precheck and precheck.decision == "ESCALATE"
        missing_fields = []
        if precheck:
            missing_fields = precheck.missing_critical + precheck.missing_important
        missing_fields_html = "".join(f"<li>{field}</li>" for field in missing_fields) or "<li>No missing fields reported</li>"
        
        risk_color = {
            "P1": "#dc3545",
            "P2": "#fd7e14",
            "P3": "#ffc107"
        }.get(payload.risk_level, "#6c757d")

        header_title = "⚠️ Additional Data Required" if is_missing_data_escalation else "🚨 Security Incident Alert"
        summary_title = "Request Summary" if is_missing_data_escalation else "Summary"
        summary_text = (
            "ThreatWatch AI reached the maximum retry limit, but the incident still lacks required context. "
            "Please provide the missing logs or fields below before automated classification continues."
            if is_missing_data_escalation
            else payload.summary
        )
        action_items = (
            f"""
                        <li>Provide additional logs or evidence for the missing fields</li>
                        <li>Confirm whether the source telemetry is malformed or delayed</li>
                        <li>Route the enriched case back into ThreatWatch AI for reassessment</li>
                        <li>Missing fields: <ul>{missing_fields_html}</ul></li>
            """
            if is_missing_data_escalation
            else """
                        <li>Review incident details in SOC dashboard</li>
                        <li>Verify and contain affected systems</li>
                        <li>Initiate incident response protocol</li>
                        <li>Update status within 30 minutes</li>
            """
        )
        
        return f"""
        <html>
        <body style="font-family: Arial, sans-serif;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px;">
                <h1>{header_title}</h1>
            </div>
            
            <div style="padding: 20px; background-color: #f8f9fa;">
                <div style="background-color: {risk_color}; color: white; padding: 15px; text-align: center; border-radius: 5px;">
                    <h2>{payload.risk_level} - PRIORITY</h2>
                    <h1>{payload.risk_score}/100</h1>
                </div>
                
                <table style="width: 100%; margin-top: 20px;">
                    <tr>
                        <td style="font-weight: bold; padding: 10px;">Alert ID:</td>
                        <td style="padding: 10px;">{payload.alert_id}</td>
                    </tr>
                    <tr>
                        <td style="font-weight: bold; padding: 10px;">Timestamp:</td>
                        <td style="padding: 10px;">{payload.timestamp}</td>
                    </tr>
                    <tr>
                        <td style="font-weight: bold; padding: 10px;">Incident Type:</td>
                        <td style="padding: 10px;">{payload.incident_type}</td>
                    </tr>
                    <tr>
                        <td style="font-weight: bold; padding: 10px;">Confidence:</td>
                        <td style="padding: 10px;">{int(payload.confidence * 100)}%</td>
                    </tr>
                </table>
                
                <div style="margin-top: 20px; padding: 15px; background-color: white; border-left: 4px solid #17a2b8;">
                    <h3>{summary_title}</h3>
                    <p>{summary_text}</p>
                </div>
                
                <div style="margin-top: 20px; padding: 15px; background-color: #fff3cd; border-left: 4px solid #ffc107;">
                    <h3>Recommended Actions</h3>
                    <ul>
{action_items}
                    </ul>
                </div>
            </div>
            
            <div style="background-color: #343a40; color: #adb5bd; padding: 15px; text-align: center;">
                <p>ThreatWatch AI - Automated Security Operations</p>
            </div>
        </body>
        </html>
        """
