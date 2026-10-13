-- ============================================================================
-- 0028_family_invite_detail_preview.sql
--
-- Batch 4, item D — "Existing Family Join UX". After a VALID, server-
-- verified invite token, the join screen should be able to show the dog's
-- real photo and the family's real member list (with real photos where
-- available) — not just the bare family/target-member text
-- inspect_family_invite() (0008/0009) already returns.
--
-- DELIBERATELY A NEW FUNCTION, NOT A REPLACEMENT OF inspect_family_invite():
--   - Postgres cannot CREATE OR REPLACE a function into a different
--     RETURNS TABLE shape (it requires DROP + CREATE), and this batch's own
--     migration rules say "inspect the latest actual definition before
--     replacing any function" and avoid unnecessary risk to an
--     already-approved, security-reviewed RPC (0008's header comment lists
--     nine correction rounds it went through).
--   - inspect_family_invite() remains byte-for-byte untouched and keeps
--     serving every existing caller exactly as before.
--
-- SECURITY REASONING (why this is safe to add, and why it does NOT relax
-- the "do not broaden disclosure based only on a short family code"
-- constraint from the brief):
--   - The constraint in the brief is about find_family_by_invite_code()
--     (the 6-character CODE lookup, 0002) — that function is UNTOUCHED by
--     this migration and still returns only {id, name, dog_name}, nothing
--     else, for anyone who merely guesses/types a short code.
--   - A family invite TOKEN (this function's input) is a different kind of
--     secret entirely: 256 bits of server-generated randomness (0008),
--     single-use, bound to one specific target member, and already proven
--     (by the fact that inspect_family_invite() itself already discloses
--     the family name and the target member's name/avatar) to be treated
--     as a legitimate pre-redemption disclosure boundary. Showing the dog's
--     photo and the OTHER members' names/avatars/photos to someone who
--     already holds that exact token is a difference of degree, not of
--     kind — and only for a token that is still genuinely 'pending' and
--     unexpired (see the `case when v_status = 'pending'` guards below): a
--     revoked/redeemed/expired token gets exactly the same minimal
--     family_name/target_name/status/expires_at it got before, nothing
--     richer.
--   - Still never returns family_id, token_hash, or the raw token — same as
--     inspect_family_invite(). Still does not consume/lock the invite.
--   - No new grant statements: mirrors inspect_family_invite()/
--     find_family_by_invite_code()'s own existing convention of relying on
--     the default PUBLIC EXECUTE grant (neither of those functions has an
--     explicit revoke/grant either — see 0002/0008/0009).
-- ============================================================================

create or replace function inspect_family_invite_detail(p_token text)
returns table (
  family_name text,
  target_name text,
  target_avatar text,
  status text,
  expires_at timestamptz,
  dog_name text,
  dog_photo_url text,
  members jsonb
) as $$
declare
  v_token_hash text;
  v_family_id uuid;
  v_status text;
begin
  if p_token is null or length(p_token) = 0 then
    raise exception 'invite not found';
  end if;

  -- Same extensions.digest() qualification as 0009's fix to
  -- inspect_family_invite() — this project's pgcrypto extension lives in
  -- the `extensions` schema, not `public`.
  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select fi.family_id,
         case when fi.status = 'pending' and fi.expires_at <= now() then 'expired' else fi.status end
    into v_family_id, v_status
  from family_invites fi
  where fi.token_hash = v_token_hash;

  if v_family_id is null then
    raise exception 'invite not found';
  end if;

  return query
  select
    f.name,
    u.name,
    u.avatar,
    v_status,
    fi.expires_at,
    -- Richer fields ONLY for a still-genuinely-pending, unexpired invite —
    -- see the header comment above. A revoked/redeemed/expired token gets
    -- null here, matching the minimal-disclosure shape it always had.
    case when v_status = 'pending' then d.name else null end,
    case when v_status = 'pending' then d.photo_url else null end,
    case when v_status = 'pending' then (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('name', mu.name, 'avatar', mu.avatar, 'photoUrl', mu.photo_url)
          order by mu.created_at
        ),
        '[]'::jsonb
      )
      from users mu
      where mu.family_id = fi.family_id and mu.removed_at is null
    ) else null end
  from family_invites fi
  join families f on f.id = fi.family_id
  join users u on u.id = fi.target_user_id
  left join dogs d on d.family_id = fi.family_id
  where fi.token_hash = v_token_hash;
end;
$$ language plpgsql stable security definer set search_path = public;

comment on function inspect_family_invite_detail(text) is
  'Batch 4 (item D) — inspect_family_invite() plus dog photo + member list, disclosed only for a still-pending/unexpired invite token. Never returns family_id/token_hash/raw token. See this migration''s header for the full security reasoning.';
