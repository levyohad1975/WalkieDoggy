-- Optional member sex for Hebrew gender-aware copy and member-aware illustrations.
-- Existing profiles remain NULL until edited; clients must use neutral copy for NULL.
alter table public.users
  add column if not exists sex text
  check (sex is null or sex in ('male', 'female'));

comment on column public.users.sex is
  'Optional member sex used for Hebrew grammatical gender and member-aware illustrations. NULL means unspecified.';
