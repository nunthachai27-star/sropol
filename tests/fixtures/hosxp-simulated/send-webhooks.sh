#!/usr/bin/env bash
# HOSxP Simulator — Send webhook test payloads to KK-LRMS
# Usage: ./send-webhooks.sh [base_url] [api_key_hospital_10679] [api_key_hospital_10737]
#
# Real API keys must be issued by the KK-LRMS admin (สสจ.ขอนแก่น).
# Replace the placeholders below or pass them as arguments.

BASE_URL="${1:-https://kk-lrms.bmscloud.in.th}"
API_KEY_10679="${2:-kklrms_TEST_API_KEY_PLACEHOLDER}"
API_KEY_11304="${3:-kklrms_TEST_API_KEY_PLACEHOLDER_11304}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/send-webhooks.log"

log() {
  local msg="[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

send_webhook() {
  local label="$1"
  local payload_file="$2"
  local api_key="$3"
  local extra_args="${4:-}"

  log "=== $label ==="
  log "File: $payload_file"
  log "URL:  POST $BASE_URL/api/webhooks/patient-data"

  local response
  response=$(curl -sS -w "\n__HTTP_STATUS__%{http_code}" \
    -X POST "$BASE_URL/api/webhooks/patient-data" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $api_key" \
    --data "@$payload_file" \
    $extra_args)

  local http_status
  http_status=$(echo "$response" | tail -1 | sed 's/__HTTP_STATUS__//')
  local body
  body=$(echo "$response" | sed '$d' | sed 's/__HTTP_STATUS__.*//')

  log "HTTP Status: $http_status"
  log "Response: $body"
  log ""

  if [[ "$http_status" -ge 200 && "$http_status" -lt 300 ]]; then
    log "SUCCESS: $label"
  else
    log "FAILED: $label — HTTP $http_status"
  fi
  log "---"
}

referral_check() {
  local label="$1"
  local cid="$2"
  local api_key="${3:-$API_KEY_10679}"

  log "=== Referral Check: $label ==="
  log "URL:  POST $BASE_URL/api/referrals/check"
  log "CID:  $cid"

  local response
  response=$(curl -sS -w "\n__HTTP_STATUS__%{http_code}" \
    -X POST "$BASE_URL/api/referrals/check" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $api_key" \
    -d "{\"cid\": \"$cid\"}")

  local http_status
  http_status=$(echo "$response" | tail -1 | sed 's/__HTTP_STATUS__//')
  local body
  body=$(echo "$response" | sed '$d' | sed 's/__HTTP_STATUS__.*//')

  log "HTTP Status: $http_status"
  log "Response: $body"
  log ""
  log "---"
}

# Clear previous log
> "$LOG_FILE"
log "HOSxP Simulator — Webhook Test Run"
log "Base URL: $BASE_URL"
log "============================================"

# Step 1: ANC patients
send_webhook "ANC Patients (type: anc_data)" \
  "$SCRIPT_DIR/anc-patients.json" \
  "$API_KEY_10679"

# Step 2: Labor patients
send_webhook "Labor Patients (default type)" \
  "$SCRIPT_DIR/labor-patients.json" \
  "$API_KEY_10679"

# Step 3: Referral create (sent by รพ.ต้นทาง 10679)
send_webhook "Referral Create (type: referral)" \
  "$SCRIPT_DIR/referral-create.json" \
  "$API_KEY_10679"

# Step 4: Referral update/accept (sent by รพ.ปลายทาง 11304)
send_webhook "Referral Update/Accept (type: referral_update)" \
  "$SCRIPT_DIR/referral-update.json" \
  "$API_KEY_11304"

log "============================================"
log "Referral Eligibility Checks"
log "============================================"

# Step 5: Check referral eligibility for each CID in referral-check.json
referral_check "Patient with ANC data (1770401294201)" "1770401294201"
referral_check "Patient with labor data (0999991049501)" "0999991049501"
referral_check "Unknown patient (0000000000000)" "0000000000000"

log "============================================"
log "All done. Full log: $LOG_FILE"
