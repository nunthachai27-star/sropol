#!/usr/bin/env bash
# Release A security probes. Usage: ./scripts/verify-release-a.sh <base-url>
# Passes when destructive/PHI surfaces are closed on the target deployment.
set -uo pipefail
BASE_URL="${1:?usage: verify-release-a.sh <base-url>}"
FAIL=0

code() { curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BASE_URL$2" -H 'Content-Type: application/json' ${3:+-d "$3"}; }

check_not_2xx() {
  local desc="$1" actual="$2"
  if [[ "$actual" =~ ^2 ]]; then echo "FAIL  $desc — got $actual (must not be 2xx)"; FAIL=1
  else echo "PASS  $desc ($actual)"; fi
}
check_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then echo "PASS  $desc ($actual)"
  else echo "FAIL  $desc — expected $expected got $actual"; FAIL=1; fi
}

check_not_2xx "simulate/clear unauthenticated"            "$(code POST /api/dev/simulate/clear)"
check_not_2xx "simulate/reset-onboarding unauthenticated" "$(code POST /api/dev/simulate/reset-onboarding)"
check_not_2xx "simulate/start unauthenticated"            "$(code POST /api/dev/simulate/start '{}')"
check_eq      "referrals/check without key -> 401"  "401" "$(code POST /api/referrals/check '{"cid":"1100500090006"}')"
check_eq      "health alive -> 200"                 "200" "$(code GET /api/health)"

# The check endpoint must never return PHI fields even on errors:
BODY=$(curl -s -X POST "$BASE_URL/api/referrals/check" -H 'Content-Type: application/json' -d '{"cid":"1100500090006"}')
if echo "$BODY" | grep -qE '"(ancRiskLevel|gravida|careStage|laborStatus|an)"'; then
  echo "FAIL  referrals/check response leaks PHI fields: $BODY"; FAIL=1
else
  echo "PASS  referrals/check response contains no PHI fields"
fi

exit $FAIL
