-- ============================================================================
-- idan_claim_diagnostic.sql
--
-- Not a pass/fail test — a diagnostic script to run against the LIVE project
-- (SQL Editor / psql as the postgres/service role) to actually establish
-- Idan's root cause, which could not be proven from static code review alone
-- (see the round-2 final report's "Idan investigation" section for why).
--
-- Replace 'Idan' below with the exact name (or hardcode the user id if
-- known) before running. Run this WHILE Idan's device is in the broken
-- state — i.e. before asking them to sign out — since queries 4-5 depend on
-- the picture as of right now.
-- ============================================================================

-- 1. Idan's own row(s). Multiple rows (e.g. a soft-removed duplicate created
--    by an earlier "re-add the same person" flow) would explain everything
--    downstream: claim_family_profile() and the request RPCs both target/
--    match by `users.id`/`auth_user_id`, so a duplicate name is invisible in
--    the picker but very visible here.
select id, family_id, name, auth_user_id, removed_at, created_at
from users
where name ilike '%Idan%' -- or: where id = '<idan-user-id>'
order by created_at;

-- 2. If step 1 shows more than one row, is Idan's CURRENT auth_user_id
--    (the one whoami()/current_profile_id() would resolve, once you know
--    which anon identity his device currently holds — see step 4) sitting
--    on the row you'd expect (removed_at is null), or on a removed one?
--    (Filled in manually once step 4 gives you the auth_user_id to search.)

-- 3. This family's device memberships — does Idan's device's auth_user_id
--    appear here at all, and does it point at the SAME family_id as his
--    users row from step 1? A mismatch here is a `current_family_id()` /
--    `users.family_id` divergence — exactly what would make the request
--    RPCs' inline `... and family_id = current_family_id()` fail to match
--    even though `auth_user_id = auth.uid()` alone would have matched.
select fam.auth_user_id, fam.family_id, fam.role, u.id as claimed_user_id, u.name, u.removed_at
from family_auth_members fam
left join users u on u.auth_user_id = fam.auth_user_id and u.family_id = fam.family_id
where fam.family_id = (select family_id from users where name ilike '%Idan%' limit 1);

-- 4. auth.users housekeeping — does Idan's device's anon identity look
--    freshly minted relative to when he originally set up this device? A
--    `created_at` far more recent than you'd expect (e.g. "today" when he
--    set the profile up weeks ago) is the fingerprint of a SILENT session
--    replacement — signInAnonymously() minting a brand-new anon user
--    because the previous one's refresh token was no longer valid (see
--    ensureAnonymousSession() / the missing AppState-wired
--    startAutoRefresh() noted in round 1's report). You'll need Idan's
--    current auth_user_id for this — pull it live from his device (e.g. a
--    temporary debug screen calling supabase.auth.getSession(), or the
--    result of him calling whoami() while signed in, however it currently
--    resolves) rather than from `users.auth_user_id`, since that column is
--    exactly what's in question.
select id, created_at, last_sign_in_at, is_anonymous
from auth.users
where id = '<idans-devices-current-auth-uid>';

-- 5. Cross-check: does that SAME auth_user_id appear anywhere in
--    `users.auth_user_id` at all (any family)? If it does NOT appear
--    anywhere, his device's current identity has never successfully claimed
--    ANY profile — meaning either claim_family_profile() has never
--    succeeded for this identity (check your client logs / try a claim
--    again and watch for a thrown error you may have missed), or something
--    is clearing auth_user_id back to null after a successful claim (no
--    trigger in this codebase does that — see 0005's audit_user_profile_change(),
--    which is AFTER UPDATE and cannot rewrite the row — but this checks for
--    it directly rather than assuming).
select id, family_id, name, removed_at
from users
where auth_user_id = '<idans-devices-current-auth-uid>';

-- ============================================================================
-- How to read the result:
--   - Step 1 shows 2+ rows for "Idan" (one active, one removed/duplicate)
--     -> the picker/claim is targeting the WRONG row, or a stale local
--        currentUserId points at a since-removed row. Fix: merge/remove the
--        duplicate; no code change needed.
--   - Step 3 shows a family_id mismatch between family_auth_members and
--     Idan's users row -> this device's family membership and Idan's actual
--     profile have drifted apart (e.g. this device was repointed at a
--     different family at some point). Fix: needs product decision on how
--     to safely re-point one or the other; not something to silently
--     "correct" server-side without knowing which one is right.
--   - Step 4 shows a suspiciously recent auth.users.created_at -> confirms
--     the "silent session replacement" mechanism from round 1's report. The
--     whoami()-based stale-claim recovery (restoreSession()/revalidateClaim())
--     plus this round's post-claim whoami() verification in signIn() are
--     the actual fix for this case — sign-in will now correctly REJECT
--     rather than silently accept a claim that doesn't resolve, and the
--     next reasonable step for Idan is a real re-claim (which will now
--     either succeed cleanly or surface an honest error).
--   - Step 5 comes back empty -> the claim genuinely never succeeded for
--     this identity; re-examine whatever surfaced from the client when he
--     last tried (a swallowed error, a network failure mid-request, etc.)
--     rather than assuming success.
-- ============================================================================
