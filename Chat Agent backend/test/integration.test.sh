#!/usr/bin/env bash
# =============================================================================
# Integration Test Script — Chat Agent API
# API: https://2p595psdt1.execute-api.us-west-2.amazonaws.com/dev
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
API_URL="https://2p595psdt1.execute-api.us-west-2.amazonaws.com/dev"
COGNITO_USER_POOL="us-west-2_wtRPN8aXd"
COGNITO_CLIENT_ID="361fvmvoc1siist24u5oojf7bo"
TEST_USER="daviwa2@vsp.com"
TEST_PASSWORD="ChatAgent2026!"
REGION="us-west-2"
AWS_PROFILE="eyentelligence"
CA_BUNDLE="/tmp/combined-ca.pem"

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ---------------------------------------------------------------------------
# Tracking
# ---------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
FAILED_TESTS=()

# ---------------------------------------------------------------------------
# Helper: build a curl command with the CA bundle if the file exists
# ---------------------------------------------------------------------------
curl_cmd() {
    if [ -f "$CA_BUNDLE" ]; then
        curl --cacert "$CA_BUNDLE" "$@"
    else
        curl "$@"
    fi
}

# ---------------------------------------------------------------------------
# Helper: assert an HTTP response
#   $1 — test name
#   $2 — expected HTTP status code(s), pipe-separated  e.g. "200|201"
#   $3 — actual HTTP status code
#   $4 — (optional) grep pattern that must appear in the response body
#   $5 — (optional) response body
# ---------------------------------------------------------------------------
assert_status() {
    local test_name="$1"
    local expected_pattern="$2"
    local actual="$3"
    local body_pattern="${4:-}"
    local body="${5:-}"

    local status_ok=false
    local body_ok=true

    # Check status code
    if echo "$actual" | grep -qE "^(${expected_pattern})$"; then
        status_ok=true
    fi

    # Check body pattern if supplied
    if [ -n "$body_pattern" ] && [ -n "$body" ]; then
        if ! echo "$body" | grep -q "$body_pattern"; then
            body_ok=false
        fi
    fi

    if $status_ok && $body_ok; then
        echo -e "  ${GREEN}PASS${RESET} [HTTP ${actual}] ${test_name}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        if ! $status_ok; then
            echo -e "  ${RED}FAIL${RESET} [HTTP ${actual}] ${test_name} — expected HTTP ${expected_pattern}"
        else
            echo -e "  ${RED}FAIL${RESET} [HTTP ${actual}] ${test_name} — response body did not match pattern '${body_pattern}'"
        fi
        FAIL_COUNT=$((FAIL_COUNT + 1))
        FAILED_TESTS+=("$test_name")
    fi
}

# ---------------------------------------------------------------------------
# Helper: assert that a response header contains a value
# ---------------------------------------------------------------------------
assert_header() {
    local test_name="$1"
    local header_name="$2"
    local headers="$3"
    local http_status="$4"

    if echo "$headers" | grep -qi "$header_name"; then
        echo -e "  ${GREEN}PASS${RESET} [HTTP ${http_status}] ${test_name}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "  ${RED}FAIL${RESET} [HTTP ${http_status}] ${test_name} — header '${header_name}' not found"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        FAILED_TESTS+=("$test_name")
    fi
}

# ---------------------------------------------------------------------------
# 0. Pre-flight: check dependencies
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${CYAN}=== Chat Agent API — Integration Tests ===${RESET}"
echo -e "Date   : $(date)"
echo -e "API    : ${API_URL}"
echo -e "Region : ${REGION}"
echo ""

if ! command -v curl &>/dev/null; then
    echo -e "${RED}ERROR: curl is not installed.${RESET}"
    exit 1
fi

if ! command -v aws &>/dev/null; then
    echo -e "${RED}ERROR: aws CLI is not installed.${RESET}"
    exit 1
fi

if [ -f "$CA_BUNDLE" ]; then
    echo -e "CA bundle : ${CA_BUNDLE} (found)"
else
    echo -e "${YELLOW}WARNING: CA bundle not found at ${CA_BUNDLE} — proceeding without it.${RESET}"
fi

# Detect jq availability (used for cleaner JSON parsing when present)
if command -v jq &>/dev/null; then
    HAS_JQ=true
    echo -e "jq        : available"
else
    HAS_JQ=false
    echo -e "${YELLOW}jq        : not found — falling back to grep/sed/awk${RESET}"
fi

echo ""

# ---------------------------------------------------------------------------
# 1. Authenticate with Cognito — USER_PASSWORD_AUTH
# ---------------------------------------------------------------------------
echo -e "${BOLD}--- Step 1: Cognito Authentication ---${RESET}"

AUTH_JSON=$(aws cognito-idp initiate-auth \
    --auth-flow USER_PASSWORD_AUTH \
    --auth-parameters "USERNAME=${TEST_USER},PASSWORD=${TEST_PASSWORD}" \
    --client-id "${COGNITO_CLIENT_ID}" \
    --region "${REGION}" \
    --profile "${AWS_PROFILE}" \
    --output json 2>&1)

AUTH_EXIT=$?

if [ $AUTH_EXIT -ne 0 ]; then
    echo -e "${RED}FAIL${RESET} Cognito authentication failed (exit code ${AUTH_EXIT}):"
    echo "$AUTH_JSON"
    exit 1
fi

# Extract ID token — prefer jq, fall back to grep/sed
if $HAS_JQ; then
    ID_TOKEN=$(echo "$AUTH_JSON" | jq -r '.AuthenticationResult.IdToken // empty')
else
    # Portable extraction without jq
    ID_TOKEN=$(echo "$AUTH_JSON" \
        | grep -o '"IdToken"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | sed 's/.*"IdToken"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')
fi

if [ -z "$ID_TOKEN" ]; then
    echo -e "${RED}FAIL${RESET} Could not extract IdToken from Cognito response."
    echo "Raw response: $AUTH_JSON"
    exit 1
fi

echo -e "  ${GREEN}PASS${RESET} Authentication succeeded — token obtained (length: ${#ID_TOKEN})"
echo ""

AUTH_HEADER="Authorization: Bearer ${ID_TOKEN}"

# ---------------------------------------------------------------------------
# 2. CORS Preflight — OPTIONS /assistants
# ---------------------------------------------------------------------------
echo -e "${BOLD}--- Test 1: CORS Preflight (OPTIONS /assistants) ---${RESET}"

CORS_RESPONSE=$(curl_cmd -s -o /dev/null -w "%{http_code}" \
    -X OPTIONS \
    -H "Origin: https://example.com" \
    -H "Access-Control-Request-Method: GET" \
    -H "Access-Control-Request-Headers: Authorization,Content-Type" \
    "${API_URL}/assistants")

# Also capture headers separately to verify the CORS header is present
CORS_HEADERS=$(curl_cmd -s -I \
    -X OPTIONS \
    -H "Origin: https://example.com" \
    -H "Access-Control-Request-Method: GET" \
    -H "Access-Control-Request-Headers: Authorization,Content-Type" \
    "${API_URL}/assistants" 2>&1)

assert_status "OPTIONS /assistants returns 200" "200" "$CORS_RESPONSE"
assert_header "OPTIONS /assistants has Access-Control-Allow-Origin header" \
    "access-control-allow-origin" "$CORS_HEADERS" "$CORS_RESPONSE"
echo ""

# ---------------------------------------------------------------------------
# 3. GET /assistants
# ---------------------------------------------------------------------------
echo -e "${BOLD}--- Test 2: GET /assistants ---${RESET}"

GET_LIST_BODY=$(curl_cmd -s \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    "${API_URL}/assistants")

GET_LIST_STATUS=$(curl_cmd -s -o /dev/null -w "%{http_code}" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    "${API_URL}/assistants")

assert_status "GET /assistants returns 200" "200" "$GET_LIST_STATUS" '\[' "$GET_LIST_BODY"
echo ""

# ---------------------------------------------------------------------------
# 4. POST /assistants — create a test assistant
# ---------------------------------------------------------------------------
echo -e "${BOLD}--- Test 3: POST /assistants ---${RESET}"

CREATE_PAYLOAD='{"name":"Test Assistant","description":"Created by integration test","model":"gpt-4o"}'

TMPFILE=$(mktemp)
CREATE_STATUS=$(curl_cmd -s -o "$TMPFILE" -w "%{http_code}" \
    -X POST \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "$CREATE_PAYLOAD" \
    "${API_URL}/assistants")
CREATE_BODY=$(cat "$TMPFILE")
rm -f "$TMPFILE"

assert_status "POST /assistants returns 201" "201" "$CREATE_STATUS"

# Extract the new assistant ID
if $HAS_JQ; then
    ASSISTANT_ID=$(echo "$CREATE_BODY" | jq -r '.id // .assistantId // empty')
else
    # Try common id field names
    ASSISTANT_ID=$(echo "$CREATE_BODY" \
        | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | head -1 \
        | sed 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')

    if [ -z "$ASSISTANT_ID" ]; then
        ASSISTANT_ID=$(echo "$CREATE_BODY" \
            | grep -o '"assistantId"[[:space:]]*:[[:space:]]*"[^"]*"' \
            | head -1 \
            | sed 's/.*"assistantId"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')
    fi
fi

if [ -z "$ASSISTANT_ID" ]; then
    echo -e "  ${YELLOW}WARNING${RESET} Could not extract assistant ID from create response."
    echo "  Create body: $CREATE_BODY"
else
    echo -e "  Assistant ID: ${ASSISTANT_ID}"
fi
echo ""

# ---------------------------------------------------------------------------
# 5. GET /assistants/:id
# ---------------------------------------------------------------------------
echo -e "${BOLD}--- Test 4: GET /assistants/:id ---${RESET}"

if [ -z "$ASSISTANT_ID" ]; then
    echo -e "  ${YELLOW}SKIP${RESET} No assistant ID — skipping GET /assistants/:id"
else
    GET_ONE_BODY=$(curl_cmd -s \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        "${API_URL}/assistants/${ASSISTANT_ID}")

    GET_ONE_STATUS=$(curl_cmd -s -o /dev/null -w "%{http_code}" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        "${API_URL}/assistants/${ASSISTANT_ID}")

    assert_status "GET /assistants/${ASSISTANT_ID} returns 200" "200" "$GET_ONE_STATUS" \
        "Test Assistant" "$GET_ONE_BODY"
fi
echo ""

# ---------------------------------------------------------------------------
# 6. PUT /assistants/:id — update the assistant
# ---------------------------------------------------------------------------
echo -e "${BOLD}--- Test 5: PUT /assistants/:id ---${RESET}"

if [ -z "$ASSISTANT_ID" ]; then
    echo -e "  ${YELLOW}SKIP${RESET} No assistant ID — skipping PUT /assistants/:id"
else
    UPDATE_PAYLOAD='{"name":"Test Assistant Updated","description":"Updated by integration test"}'

    TMPFILE2=$(mktemp)
    UPDATE_STATUS=$(curl_cmd -s -o "$TMPFILE2" -w "%{http_code}" \
        -X PUT \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "$UPDATE_PAYLOAD" \
        "${API_URL}/assistants/${ASSISTANT_ID}")
    UPDATE_BODY=$(cat "$TMPFILE2")
    rm -f "$TMPFILE2"

    assert_status "PUT /assistants/${ASSISTANT_ID} returns 200" "200" "$UPDATE_STATUS" \
        "Test Assistant Updated" "$UPDATE_BODY"
fi
echo ""

# ---------------------------------------------------------------------------
# 7. GET /tenants/me
# ---------------------------------------------------------------------------
echo -e "${BOLD}--- Test 6: GET /tenants/me ---${RESET}"

TENANT_BODY=$(curl_cmd -s \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    "${API_URL}/tenants/me")

TENANT_STATUS=$(curl_cmd -s -o /dev/null -w "%{http_code}" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    "${API_URL}/tenants/me")

assert_status "GET /tenants/me returns 200" "200" "$TENANT_STATUS"
echo ""

# ---------------------------------------------------------------------------
# 8. GET /hierarchy/definition
# ---------------------------------------------------------------------------
echo -e "${BOLD}--- Test 7: GET /hierarchy/definition ---${RESET}"

HIER_DEF_BODY=$(curl_cmd -s \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    "${API_URL}/hierarchy/definition")

HIER_DEF_STATUS=$(curl_cmd -s -o /dev/null -w "%{http_code}" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    "${API_URL}/hierarchy/definition")

assert_status "GET /hierarchy/definition returns 200" "200" "$HIER_DEF_STATUS"
echo ""

# ---------------------------------------------------------------------------
# 9. GET /hierarchy/tree
# ---------------------------------------------------------------------------
echo -e "${BOLD}--- Test 8: GET /hierarchy/tree ---${RESET}"

HIER_TREE_BODY=$(curl_cmd -s \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    "${API_URL}/hierarchy/tree")

HIER_TREE_STATUS=$(curl_cmd -s -o /dev/null -w "%{http_code}" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    "${API_URL}/hierarchy/tree")

assert_status "GET /hierarchy/tree returns 200" "200" "$HIER_TREE_STATUS"
echo ""

# ---------------------------------------------------------------------------
# 10. DELETE /assistants/:id
# ---------------------------------------------------------------------------
echo -e "${BOLD}--- Test 9: DELETE /assistants/:id ---${RESET}"

if [ -z "$ASSISTANT_ID" ]; then
    echo -e "  ${YELLOW}SKIP${RESET} No assistant ID — skipping DELETE /assistants/:id"
else
    DELETE_STATUS=$(curl_cmd -s -o /dev/null -w "%{http_code}" \
        -X DELETE \
        -H "$AUTH_HEADER" \
        "${API_URL}/assistants/${ASSISTANT_ID}")

    assert_status "DELETE /assistants/${ASSISTANT_ID} returns 204" "204" "$DELETE_STATUS"

    # Verify deletion: GET should now return 404
    VERIFY_STATUS=$(curl_cmd -s -o /dev/null -w "%{http_code}" \
        -H "$AUTH_HEADER" \
        "${API_URL}/assistants/${ASSISTANT_ID}")

    assert_status "GET /assistants/${ASSISTANT_ID} returns 404 after deletion" "404" "$VERIFY_STATUS"
fi
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
TOTAL=$((PASS_COUNT + FAIL_COUNT))

echo -e "${BOLD}${CYAN}=== Test Summary ===${RESET}"
echo -e "  Total : ${TOTAL}"
echo -e "  ${GREEN}Pass  : ${PASS_COUNT}${RESET}"
if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "  ${RED}Fail  : ${FAIL_COUNT}${RESET}"
    echo ""
    echo -e "${RED}Failed tests:${RESET}"
    for t in "${FAILED_TESTS[@]}"; do
        echo -e "  - $t"
    done
    echo ""
    exit 1
else
    echo -e "  ${GREEN}Fail  : 0${RESET}"
    echo ""
    echo -e "${GREEN}All tests passed.${RESET}"
    echo ""
    exit 0
fi
