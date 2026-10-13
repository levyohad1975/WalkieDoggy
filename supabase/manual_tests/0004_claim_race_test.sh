#!/usr/bin/env bash
# ============================================================================
# 0004_claim_race_test.sh
#
# Automates the concurrent claim_family_profile() race simulation described
# in 0004_profile_edit_acl.sql ("Concurrent / stale-read race simulation").
# Fires two claims for the SAME unclaimed profile from two different
# simulated devices (a002, a003) at nearly the same instant, against the
# TEST-ONLY claim_family_profile_test_race() function (which inserts a
# pg_sleep between its internal SELECT and its UPDATE to force a wide,
# reliably-hit race window). Exactly one of the two calls must succeed; the
# other must print the 'profile already claimed by another device' error —
# never both succeeding, and never a silent no-op "success".
#
# This is what actually verifies the fix: the guarantee comes from the
# guarded UPDATE's own row-count check (GET DIAGNOSTICS ROW_COUNT), not from
# the earlier SELECT-based ownership check, which by itself cannot see a
# concurrent claim that hasn't committed yet.
#
# Usage:
#   DATABASE_URL=postgres://... UNCLAIMED_USER_ID=<uuid> ./0004_claim_race_test.sh
#
# Prerequisites:
#   1. Run the setup block from 0004_profile_edit_acl.sql (families/users/
#      family_auth_members inserts) against a disposable/staging database,
#      but COMMIT it instead of the file's usual `rollback;` — this script
#      needs the unclaimed test user to still exist across two separate
#      connections, which a `begin ... rollback` transaction in one session
#      can't provide.
#   2. Also run the claim_family_profile_test_race() definition from the
#      "Concurrent / stale-read race simulation" section of that same file
#      against that database.
#   3. Set UNCLAIMED_USER_ID to that setup's unclaimed_user_id (query it:
#      `select id from users where name = 'לא נתבע';`).
# ============================================================================
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to the disposable/staging database to test against}"
: "${UNCLAIMED_USER_ID:?set UNCLAIMED_USER_ID to an active, unclaimed users.id (see prerequisites above)}"

DEVICE_A="00000000-0000-0000-0000-00000000a002"
DEVICE_B="00000000-0000-0000-0000-00000000a003"
CLAIM_SQL="select claim_family_profile_test_race('${UNCLAIMED_USER_ID}'::uuid, 0.5);"

run_as() {
  local auth_uid="$1"
  local out_file="$2"
  {
    psql "$DATABASE_URL" -v ON_ERROR_STOP=0 \
      -c "set role authenticated;" \
      -c "set request.jwt.claims = '{\"sub\": \"${auth_uid}\"}';" \
      -c "$CLAIM_SQL"
  } > "$out_file" 2>&1
}

echo "Firing two concurrent claims for user ${UNCLAIMED_USER_ID} (device a002 vs device a003)..."

OUT_A="$(mktemp)"
OUT_B="$(mktemp)"

run_as "$DEVICE_A" "$OUT_A" &
PID_A=$!
run_as "$DEVICE_B" "$OUT_B" &
PID_B=$!

wait "$PID_A" || true
wait "$PID_B" || true

echo
echo "--- result: device a002 ---"
cat "$OUT_A"
echo
echo "--- result: device a003 ---"
cat "$OUT_B"
echo
echo "Expect: exactly ONE of the two above succeeded (no error), and the"
echo "other shows 'profile already claimed by another device'. If both"
echo "succeeded, or both were silently accepted, the race is NOT fixed."

rm -f "$OUT_A" "$OUT_B"
