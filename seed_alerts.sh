#!/usr/bin/env bash
#
# Athena 쿼리용 샘플 데이터 주입
# API Gateway를 통해 실제 경로로 알림을 보냅니다.
#
# 사용법:
#   source .env.aws
#   export HMAC_SECRET=...   # 공유 서명 시크릿 (README의 Environment Setup 참고)
#   ./seed_alerts.sh

set -euo pipefail

: "${API_URL:?API_URL not set - run 'source .env.aws' first}"
: "${KEY_ID:?KEY_ID not set}"
: "${HMAC_SECRET:?HMAC_SECRET not set - export the shared signing secret (see README, Environment Setup)}"

API_KEY=$(aws apigateway get-api-key --api-key "$KEY_ID" --include-value --query value --output text)



send() {
  local body="$1"
  local id
  id=$(printf '%s' "$body" | sed -n 's/.*"alert_id":"\([^"]*\)".*/\1/p')

  # 알림마다 새 논스를 생성합니다. 재사용하면 authorizer가 거부합니다.
  local ts=$(date +%s)
  local nonce=$(openssl rand -hex 16)
  local sig=$(printf '%s.%s' "$ts" "$nonce" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -hex | sed 's/.*= //')

  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL" \
    -H "x-api-key: $API_KEY" \
    -H "Content-Type: application/json" \
    -H "x-tw-timestamp: $ts" \
    -H "x-tw-nonce: $nonce" \
    -H "x-tw-signature: $sig" \
    -d "$body")

  printf '%-28s %s\n' "$id" "$code"
  sleep 3
}

: "${HMAC_SECRET:?HMAC_SECRET not set - aws ssm get-parameter --name /threatwatch/hmac-secret --with-decryption}"

echo "alert_id                     http"
echo "-------------------------------------"

# --- 고위험 계열 ---
send '{"alert_id":"A-2026-0001","incident_type":"ransomware","severity":"critical","asset_criticality":"high","pii_flag":true,"user_role":"Privileged","indicators":["file_encryption_burst","shadow_copy_deletion","backup_service_stopped"],"description":"Mass file encryption detected on finance file server with backup tampering."}'

send '{"alert_id":"A-2026-0002","incident_type":"data_exfiltration","severity":"critical","asset_criticality":"high","pii_flag":true,"user_role":"Privileged","indicators":["large_outbound_transfer","after_hours_access","new_external_destination"],"description":"12GB outbound transfer to unrecognized host outside business hours."}'

send '{"alert_id":"A-2026-0003","incident_type":"credential_stuffing","severity":"high","asset_criticality":"high","pii_flag":true,"user_role":"Privileged","indicators":["multiple_failed_logins_spike","impossible_travel","mfa_fatigue_pattern"],"description":"Admin account targeted from two continents within eight minutes."}'

# --- 중위험 계열 ---
send '{"alert_id":"A-2026-0004","incident_type":"privilege_escalation","severity":"high","asset_criticality":"medium","pii_flag":false,"user_role":"Standard","indicators":["sudo_abuse","new_admin_account"],"description":"Standard user granted itself administrative role on build server."}'

send '{"alert_id":"A-2026-0005","incident_type":"suspicious_login","severity":"medium","asset_criticality":"medium","pii_flag":false,"user_role":"Standard","indicators":["unusual_geolocation"],"description":"Login from a country the user has not accessed before, but MFA succeeded."}'

send '{"alert_id":"A-2026-0006","incident_type":"malware_detection","severity":"medium","asset_criticality":"medium","pii_flag":false,"user_role":"Standard","indicators":["quarantined_by_edr","known_signature"],"description":"EDR quarantined a known adware sample from a browser download."}'

# --- 저위험 계열 ---
send '{"alert_id":"A-2026-0007","incident_type":"policy_violation","severity":"low","asset_criticality":"low","pii_flag":false,"user_role":"Standard","indicators":["unapproved_software_install"],"description":"User installed an unapproved but benign productivity tool."}'

send '{"alert_id":"A-2026-0008","incident_type":"port_scan","severity":"low","asset_criticality":"low","pii_flag":false,"user_role":"Standard","indicators":["internal_scan_detected"],"description":"Scheduled vulnerability scanner triggered IDS on internal subnet."}'

# --- 결측 데이터가 있는 케이스 (precheck 동작 확인용) ---
send '{"alert_id":"A-2026-0009","incident_type":"unauthorized_access","severity":"high","indicators":["access_denied_repeated"],"description":"Repeated access attempts to restricted share; asset context unavailable."}'

send '{"alert_id":"A-2026-0010","incident_type":"phishing_click","severity":"medium","asset_criticality":"medium","pii_flag":true,"user_role":"Standard","indicators":["credential_page_visited","email_reported_late"],"description":"User submitted credentials to a phishing page before reporting."}'

echo
echo "완료. 20~30초 후 결과를 확인하세요:"
echo "  aws dynamodb scan --table-name \$TABLE_NAME --select COUNT --query Count"
