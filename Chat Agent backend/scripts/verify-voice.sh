#!/usr/bin/env bash
# Quick verification of the deployed voice + SMS surface.
#
# Usage:
#   BASE_URL=https://<api-id>.execute-api.us-west-2.amazonaws.com/dev \
#   SERVICE_TOKEN=<the VoiceGatewayServiceToken you deployed with> \
#   TWILIO_AUTH_TOKEN=<the same auth token in SSM /chat-agent/{tenant}/twilio/auth-token> \
#   ./scripts/verify-voice.sh
#
# Exits non-zero on any failed check.

set -u
PASS=0
FAIL=0

require() {
  local name=$1
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name not set" >&2
    exit 2
  fi
}

require BASE_URL
require SERVICE_TOKEN

BASE_URL="${BASE_URL%/}"  # strip trailing slash

check() {
  local label=$1 actual=$2 expected=$3
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS  $label  (got $actual)"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $label  (got $actual, expected $expected)"
    FAIL=$((FAIL + 1))
  fi
}

check_contains() {
  local label=$1 haystack=$2 needle=$3
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "PASS  $label  (response contains '$needle')"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $label  (response missing '$needle')"
    echo "      Response: ${haystack:0:200}"
    FAIL=$((FAIL + 1))
  fi
}

http_status() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

http_body() {
  curl -s "$@"
}

echo "=== Voice bridge service-token endpoints ==="

# 1. /voice/tool-schemas without auth → 401
code=$(http_status -X GET "$BASE_URL/voice/tool-schemas")
check "tool-schemas without bearer" "$code" "401"

# 2. /voice/tool-schemas with wrong bearer → 401
code=$(http_status -X GET -H "Authorization: Bearer wrong-token-xxxxx" "$BASE_URL/voice/tool-schemas")
check "tool-schemas with wrong bearer" "$code" "401"

# 3. /voice/tool-schemas with correct bearer → 200 + tools array
body=$(http_body -X GET -H "Authorization: Bearer $SERVICE_TOKEN" "$BASE_URL/voice/tool-schemas")
check_contains "tool-schemas with valid bearer returns tools" "$body" "\"tools\""
check_contains "tool-schemas includes searchPatients" "$body" "searchPatients"
check_contains "tool-schemas includes transferToHuman" "$body" "transferToHuman"

# 4. /voice/tool-execute denied tool → 403 with TOOL_NOT_ALLOWED
code=$(http_status -X POST -H "Authorization: Bearer $SERVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"tool":"createPatient","input":{},"context":{"tenantId":"verify-test"}}' \
  "$BASE_URL/voice/tool-execute")
check "tool-execute denylist (createPatient → 403)" "$code" "403"

# 5. /voice/tool-execute missing tool field → 400
code=$(http_status -X POST -H "Authorization: Bearer $SERVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"context":{"tenantId":"verify-test"}}' \
  "$BASE_URL/voice/tool-execute")
check "tool-execute missing tool name → 400" "$code" "400"

echo
echo "=== Twilio webhook signature validation ==="

# 6. /voice/sms-inbound without signature → 403
code=$(http_status -X POST -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=%2B15551234567&To=%2B15806336937&Body=hi&MessageSid=SMtest" \
  "$BASE_URL/voice/sms-inbound")
check "sms-inbound without signature" "$code" "403"

# 7. /voice/sms-inbound with bogus signature → 403
code=$(http_status -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "X-Twilio-Signature: bogusbogusbogusbogus123==" \
  -d "From=%2B15551234567&To=%2B15806336937&Body=hi&MessageSid=SMtest" \
  "$BASE_URL/voice/sms-inbound")
check "sms-inbound with bogus signature" "$code" "403"

# 8. /voice/sms-inbound WITH a valid Twilio signature — only runs if TWILIO_AUTH_TOKEN is set
if [[ -n "${TWILIO_AUTH_TOKEN:-}" ]]; then
  # Build the signature exactly like Twilio does:
  #   URL + concat(sortedKey+value for each body param)
  # Body keys must be sorted asc, values un-URL-encoded.
  URL="$BASE_URL/voice/sms-inbound"
  # Body params in the wire (URL-encoded):
  BODY_WIRE="Body=Can+I+book+Tuesday%3F&From=%2B15551234567&MessageSid=SMverify1&To=%2B15806336937"
  # Sorted-key + un-encoded-value concatenation for the signature input:
  SIG_INPUT="${URL}BodyCan I book Tuesday?From+15551234567MessageSidSMverify1To+15806336937"

  # HMAC-SHA1, base64-encoded — match Twilio's reference implementation
  SIGNATURE=$(printf '%s' "$SIG_INPUT" | openssl dgst -sha1 -hmac "$TWILIO_AUTH_TOKEN" -binary | base64)

  resp=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -H "X-Twilio-Signature: $SIGNATURE" \
    --data "$BODY_WIRE" \
    "$URL")
  code=$(printf '%s' "$resp" | tail -n1)
  body=$(printf '%s' "$resp" | sed '$d')

  check "sms-inbound with VALID signature" "$code" "200"
  check_contains "sms-inbound TwiML response" "$body" "<Response>"
else
  echo "SKIP  sms-inbound with valid signature  (set TWILIO_AUTH_TOKEN to enable)"
fi

echo
echo "=== Summary: $PASS passed, $FAIL failed ==="
exit $FAIL
