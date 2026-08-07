#!/usr/bin/env bash
# WHO ANC containment smoke probes. Usage: ./scripts/verify-anc-containment.sh <base-url>
# Read-only against a live deployment: proves the changed surfaces are up,
# auth-closed, and PHI-clean. Deep behavior is covered by the 1971-test suite.
set -uo pipefail
BASE_URL="${1:?usage: verify-anc-containment.sh <base-url>}"
FAIL=0

code() { curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BASE_URL$2" -H 'Content-Type: application/json' ${3:+-d "$3"}; }

check_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then echo "PASS  $desc ($actual)"
  else echo "FAIL  $desc — expected $expected got $actual"; FAIL=1; fi
}
check_in() {
  local desc="$1" actual="$2"; shift 2
  for e in "$@"; do
    if [[ "$actual" == "$e" ]]; then echo "PASS  $desc ($actual)"; return; fi
  done
  echo "FAIL  $desc — got $actual (wanted one of: $*)"; FAIL=1
}

# Liveness + readiness (infrastructure readiness only, per spec §10.2)
check_eq "health alive -> 200"  "200" "$(code GET /api/health)"
check_eq "health ready -> 200"  "200" "$(code GET /api/health/ready)"

# Changed ingestion surfaces stay auth-closed to anonymous callers
check_in "browser-push unauthenticated (session-gated)" "$(code POST /api/sync/browser-push '{}')" 401 403 307
check_eq "patient-data webhook without API key -> 401" "401" "$(code POST /api/webhooks/patient-data '{"type":"anc_data","hospitalCode":"00000","patients":[]}')"

# Journey detail API (now carries ancAssessment) must not be readable anonymously
JID="00000000-0000-4000-8000-000000000000"
check_in "journey detail unauthenticated" "$(code GET /api/journeys/$JID)" 401 403 307

# Anonymous error bodies from changed routes carry no PHI / clinical fields
BODY=$(curl -s -X POST "$BASE_URL/api/webhooks/patient-data" -H 'Content-Type: application/json' -d '{"type":"anc_data","hospitalCode":"00000","patients":[]}')
if echo "$BODY" | grep -qE '"(name|hn|cid|ancRiskLevel|visits)"\s*:'; then
  echo "FAIL  patient-data 401 body leaks fields: $BODY"; FAIL=1
else
  echo "PASS  patient-data 401 body contains no PHI/clinical fields"
fi

# Journey detail page route exists (renders login redirect or page shell, never 5xx)
PAGE_CODE=$(code GET "/pregnancies/$JID")
if [[ "$PAGE_CODE" =~ ^5 ]]; then echo "FAIL  journey detail page returned $PAGE_CODE"; FAIL=1
else echo "PASS  journey detail page non-5xx ($PAGE_CODE)"; fi

exit $FAIL
