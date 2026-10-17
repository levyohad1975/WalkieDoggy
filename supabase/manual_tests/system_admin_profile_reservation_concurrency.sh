#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the disposable PostgreSQL rehearsal database}"

readonly ADMIN='10000000-0000-4000-8000-000000000001'
readonly DEVICE_PIN='10000000-0000-4000-8000-000000000002'
readonly DEVICE_INVITE='10000000-0000-4000-8000-000000000004'
readonly ORIGINAL_FAMILY='00000000-0000-4000-8000-000000000001'
readonly QA_FAMILY='00000000-0000-4000-8000-000000000002'
readonly OTHER_FAMILY='00000000-0000-4000-8000-000000000003'
readonly PROFILE='20000000-0000-4000-8000-000000000001'
readonly OTHER_PROFILE='20000000-0000-4000-8000-000000000003'
readonly TEMP_DIR="$(mktemp -d)"
HOLDER_PID=''

cleanup() {
  if [[ -n "$HOLDER_PID" ]] && kill -0 "$HOLDER_PID" 2>/dev/null; then
    kill "$HOLDER_PID" 2>/dev/null || true
    wait "$HOLDER_PID" 2>/dev/null || true
  fi
  rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT

assert_scalar() {
  local sql="$1"
  local expected="$2"
  local actual
  actual="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "$sql")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'Expected [%s], received [%s] for SQL: %s\n' "$expected" "$actual" "$sql" >&2
    exit 1
  fi
}

expect_rpc_rejection() {
  local app_name="$1"
  local rpc="$2"
  local auth_id="$3"
  local output_file="$4"
  if PGAPPNAME="$app_name" psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
      -c 'begin' \
      -c 'set local role authenticated' \
      -c "set local request.jwt.claim.sub = '${auth_id}'" \
      -c "select public.${rpc}('${PROFILE}'::uuid)" \
      -c 'commit' >"$output_file" 2>&1; then
    printf '%s unexpectedly succeeded\n' "$rpc" >&2
    return 1
  fi
  if ! grep -Fq 'profile is reserved during System Admin QA' "$output_file"; then
    printf '%s failed for an unexpected reason:\n' "$rpc" >&2
    cat "$output_file" >&2
    return 1
  fi
}

# Transaction rollback must undo both the switch-side state and trigger-created
# reservation, leaving the original family/profile/session untouched.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c 'begin' \
  -c "set local request.jwt.claim.sub = '${ADMIN}'" \
  -c "set local app.is_system_admin = 'true'" \
  -c "insert into public.family_membership_snapshots(auth_user_id,family_id,role,claimed_user_id) values ('${ADMIN}','${ORIGINAL_FAMILY}','admin','${PROFILE}')" \
  -c "update public.family_auth_members set family_id='${QA_FAMILY}' where auth_user_id='${ADMIN}'" \
  -c "update public.users set auth_user_id=null where id='${PROFILE}'" \
  -c "delete from public.profile_auth_sessions where auth_user_id='${ADMIN}'" \
  -c 'rollback'
assert_scalar "select count(*) from public.family_profile_reservations" '0'
assert_scalar "select count(*) from public.family_membership_snapshots" '0'
assert_scalar "select count(*) from public.profile_auth_sessions where auth_user_id='${ADMIN}' and family_id='${ORIGINAL_FAMILY}' and user_id='${PROFILE}'" '1'
assert_scalar "select count(*) from public.users where id='${PROFILE}' and family_id='${ORIGINAL_FAMILY}' and auth_user_id='${ADMIN}'" '1'
echo 'ROLLBACK PASSED: original family/profile/session restored and no reservation remained.'

# This transaction creates the reservation, then deliberately remains open.
# Two independent authenticated sessions must block on the same profile row;
# after commit they must wake and reject against the now-visible reservation.
PGAPPNAME='profile-reservation-owner' psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c 'begin' \
  -c "set local request.jwt.claim.sub = '${ADMIN}'" \
  -c "set local app.is_system_admin = 'true'" \
  -c "insert into public.family_membership_snapshots(auth_user_id,family_id,role,claimed_user_id) values ('${ADMIN}','${ORIGINAL_FAMILY}','admin','${PROFILE}')" \
  -c 'select pg_sleep(15)' \
  -c 'commit' >"$TEMP_DIR/holder.log" 2>&1 &
HOLDER_PID=$!

holder_ready=0
for _ in $(seq 1 200); do
  waiting="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
    "select count(*) from pg_stat_activity where application_name='profile-reservation-owner' and state='active' and wait_event='PgSleep'")"
  if [[ "$waiting" == '1' ]]; then holder_ready=1; break; fi
  sleep 0.05
done
if [[ "$holder_ready" != '1' ]]; then
  cat "$TEMP_DIR/holder.log" >&2
  echo 'Could not observe the reservation transaction holding its row lock.' >&2
  exit 1
fi

expect_rpc_rejection 'profile-reservation-pin-race' 'rehearsal_pin_claim' "$DEVICE_PIN" "$TEMP_DIR/pin.log" &
PIN_PID=$!
expect_rpc_rejection 'profile-reservation-invitation-race' 'rehearsal_invitation_claim' "$DEVICE_INVITE" "$TEMP_DIR/invitation.log" &
INVITE_PID=$!

blocked=0
for _ in $(seq 1 100); do
  waiters="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
    "select count(*) from pg_stat_activity where application_name in ('profile-reservation-pin-race','profile-reservation-invitation-race') and wait_event_type='Lock'")"
  if [[ "$waiters" == '2' ]]; then blocked=1; break; fi
  sleep 0.05
done
if [[ "$blocked" != '1' ]]; then
  echo 'Expected both independent claim transactions to block on the reserved profile row.' >&2
  exit 1
fi
echo 'ROW LOCK PASSED: both PIN and invitation claim transactions blocked behind the reservation transaction.'

set +e
wait "$PIN_PID"; pin_status=$?
wait "$INVITE_PID"; invitation_status=$?
wait "$HOLDER_PID"; holder_status=$?
set -e
HOLDER_PID=''
if [[ "$pin_status" -ne 0 || "$invitation_status" -ne 0 || "$holder_status" -ne 0 ]]; then
  echo 'Unexpected process result while completing the concurrent claim race.' >&2
  cat "$TEMP_DIR/pin.log" "$TEMP_DIR/invitation.log" "$TEMP_DIR/holder.log" >&2
  exit 1
fi
echo 'CONCURRENT CLAIMS PASSED: competing PIN and invitation claims were both rejected after the owner transaction committed.'

assert_scalar "select count(*) from public.profile_auth_sessions where user_id='${PROFILE}'" '1'
assert_scalar "select count(*) from public.family_profile_reservations where auth_user_id='${ADMIN}' and profile_id='${PROFILE}' and family_id='${ORIGINAL_FAMILY}'" '1'

# Reapply while the reservation is active. Existing fence state must remain
# byte-for-byte equivalent and continue to satisfy the read-only checks.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261017160000_reserve_profiles_during_system_admin_qa.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/manual_tests/system_admin_profile_reservation_readonly.sql

# Simulate the committed QA switch, verify an incomplete restore cannot release
# the fence, then restore the original family/profile/session and release it.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c "set request.jwt.claim.sub = '${ADMIN}'" \
  -c "update public.family_auth_members set family_id='${QA_FAMILY}' where auth_user_id='${ADMIN}'" \
  -c "update public.users set auth_user_id=null where id='${PROFILE}'" \
  -c "delete from public.profile_auth_sessions where auth_user_id='${ADMIN}'"
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
    -c "set request.jwt.claim.sub = '${ADMIN}'" \
    -c "delete from public.family_membership_snapshots where auth_user_id='${ADMIN}'" >"$TEMP_DIR/incomplete-restore.log" 2>&1; then
  echo 'Incomplete restore unexpectedly released its reservation.' >&2
  exit 1
fi
grep -Fq 'original profile restoration is incomplete; reservation retained' "$TEMP_DIR/incomplete-restore.log"
assert_scalar "select count(*) from public.family_profile_reservations where auth_user_id='${ADMIN}'" '1'
echo 'RESTORE FENCE PASSED: incomplete restoration was rejected and reservation retained.'

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c "set request.jwt.claim.sub = '${ADMIN}'" \
  -c "update public.family_auth_members set family_id='${ORIGINAL_FAMILY}' where auth_user_id='${ADMIN}'" \
  -c "update public.users set auth_user_id='${ADMIN}' where id='${PROFILE}'" \
  -c "insert into public.profile_auth_sessions(auth_user_id,family_id,user_id) values ('${ADMIN}','${ORIGINAL_FAMILY}','${PROFILE}')" \
  -c "delete from public.family_membership_snapshots where auth_user_id='${ADMIN}'"
assert_scalar "select count(*) from public.family_profile_reservations" '0'
assert_scalar "select count(*) from public.users where id='${PROFILE}' and family_id='${ORIGINAL_FAMILY}' and auth_user_id='${ADMIN}'" '1'
assert_scalar "select count(*) from public.profile_auth_sessions where auth_user_id='${ADMIN}' and family_id='${ORIGINAL_FAMILY}' and user_id='${PROFILE}'" '1'
assert_scalar "select count(*) from public.users where id='${OTHER_PROFILE}' and family_id='${OTHER_FAMILY}' and auth_user_id is null" '1'
echo 'RESTORATION PASSED: original identity restored, reservation released, unrelated family unchanged.'
