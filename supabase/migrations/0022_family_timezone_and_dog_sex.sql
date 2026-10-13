-- ----------------------------------------------------------------------------
-- 0022_family_timezone_and_dog_sex.sql
--
-- BATCH 1 (data model foundation) — Part 1 of 3: authoritative family
-- timezone + dog sex. Purely additive (new nullable/defaulted columns on
-- existing tables); no existing column, function, RLS policy, or table is
-- modified or dropped. Upgrade-safe when applied on top of the expected
-- 0001-0021 baseline this repository ships with. `add column if not
-- exists` guards against re-running THIS migration a second time — it does
-- not verify or reconcile an already-existing `timezone`/`sex` column of a
-- different shape (type, default, or constraint) than what's defined below;
-- if either column already exists from some other source, inspect it before
-- applying this file.
--
-- ----------------------------------------------------------------------------
-- families.timezone — Master Specification §6/§15 ("Timezone data model:
-- family timezone vs. per-user display"). Decision (approved): each family
-- has ONE authoritative IANA timezone; walk scheduling and reminder-time
-- calculations always use it. A possible future UI may additionally show a
-- traveling member's own local time, but that display layer must never
-- change this authoritative value.
--
-- Default: 'Asia/Jerusalem'. This is a COMPATIBILITY/BACKFILL default for
-- EXISTING families only — not a reference to any specific family's id or
-- name, and not a permanent assumption about where every family lives. It
-- exists solely because this app has been Hebrew-only with no timezone
-- concept anywhere in the UI until now, so every family that already
-- exists has always effectively been operating on Israel local time;
-- backfilling every existing family to this default the moment the column
-- appears preserves their current, unchanged scheduling behavior, and
-- nothing in this migration reads or special-cases any particular family
-- row to do so.
--
-- IMPORTANT — DOES NOT EXTEND TO FUTURE FAMILIES: this default must NOT be
-- read as "every family is in Israel." Family creation/onboarding (later
-- batch work, not part of this migration) must explicitly determine each
-- NEW family's real timezone at creation time — e.g. from the device's own
-- locale/timezone at the moment the family is created, or an explicit
-- picker — rather than silently inheriting this column's default. This
-- default only exists to give pre-existing rows a value; it is not product
-- guidance about where future users are. An admin can also move an
-- individual family to a different timezone later with a plain UPDATE once
-- a UI for it exists (not part of this migration).
--
-- is_valid_timezone() validates against Postgres's own pg_timezone_names
-- view (every real IANA zone Postgres itself recognizes) rather than a
-- hand-maintained list, so a typo/garbage value is rejected at write time
-- and any legitimate zone name is accepted without this schema needing to
-- track the IANA database itself.
-- ----------------------------------------------------------------------------

create or replace function is_valid_timezone(p_tz text)
returns boolean as $$
  select exists (select 1 from pg_timezone_names where name = p_tz);
$$ language sql stable;

comment on function is_valid_timezone(text) is
  'Validates an IANA timezone name against Postgres''s own pg_timezone_names view. Used by families.timezone''s check constraint (see 0022_family_timezone_and_dog_sex.sql).';

alter table families
  add column if not exists timezone text not null default 'Asia/Jerusalem'
  check (is_valid_timezone(timezone));

comment on column families.timezone is
  'Authoritative IANA timezone for this family''s walk scheduling and reminder calculations (Master Specification §6/§15). Default is a compatibility/backfill value for pre-existing families only — see this migration''s header; future family creation must determine this explicitly rather than relying on the default. A future per-user display layer may show a different local time without ever changing this value.';

-- ----------------------------------------------------------------------------
-- dogs.sex — Master Specification §7 ("Dog Profile & Personality"): used by
-- the future Message Template Engine to produce grammatically correct
-- Hebrew reminder wording (זכר/נקבה) instead of hard-coded text. Nullable:
-- every existing dog has no recorded sex today, and guessing one would risk
-- silently misgendering the dog in every future notification — safer to
-- backfill as NULL and let a family admin set it explicitly once the
-- corresponding UI exists (later batch). App code that reads this field
-- must handle NULL with neutral phrasing rather than assuming a value.
-- ----------------------------------------------------------------------------

alter table dogs
  add column if not exists sex text check (sex in ('male', 'female'));

comment on column dogs.sex is
  'Dog''s sex, used for grammatically correct (זכר/נקבה) reminder wording (Master Specification §7). NULL for a dog whose sex hasn''t been recorded yet — app code must handle NULL with neutral phrasing until a family admin sets it explicitly.';
