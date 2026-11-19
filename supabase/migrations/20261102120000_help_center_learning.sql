-- Help & Support that learns from what families ask (no AI, no external service).
--
-- 1. help_questions: one aggregated row per distinct question text. Families
--    add to it through record_help_question() when a search finds nothing,
--    when they send a question, or when they mark an answer "לא עזר".
--    Rows hold the text and counters only: no user, profile or family id.
-- 2. help_articles: answers the System Admin writes and publishes. Every
--    signed-in user can read published ones; only the System Admin RPCs
--    below can write.
-- 3. help_question_rate: per-session counters used only to cap submissions
--    (30 per hour). Never readable by clients, pruned on write.

create table if not exists public.help_questions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('search_miss','question','not_helpful')),
  normalized_text text not null check (char_length(normalized_text) between 1 and 300),
  sample_text text not null check (char_length(sample_text) between 1 and 300),
  article_ref text check (article_ref is null or char_length(article_ref) <= 80),
  ask_count integer not null default 1 check (ask_count >= 1),
  status text not null default 'open' check (status in ('open','answered','dismissed')),
  first_asked_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (kind, normalized_text)
);
create index if not exists help_questions_open_idx
  on public.help_questions(status, ask_count desc, last_asked_at desc);
alter table public.help_questions enable row level security;
revoke all on public.help_questions from public, anon, authenticated;

create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  category_id text not null default 'more' check (char_length(category_id) between 1 and 40),
  question text not null check (char_length(question) between 3 and 200),
  answer text not null check (char_length(answer) between 3 and 2000),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 20),
  published boolean not null default true,
  source_question_id uuid references public.help_questions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.help_articles enable row level security;
revoke all on public.help_articles from public, anon, authenticated;
grant select on public.help_articles to authenticated;
drop policy if exists help_articles_read_published on public.help_articles;
create policy help_articles_read_published on public.help_articles
  for select to authenticated using (published);

create table if not exists public.help_question_rate (
  auth_user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists help_question_rate_user_time_idx
  on public.help_question_rate(auth_user_id, created_at desc);
alter table public.help_question_rate enable row level security;
revoke all on public.help_question_rate from public, anon, authenticated;

-- Any signed-in session (families use anonymous Auth sessions too).
create or replace function public.record_help_question(p_kind text, p_text text, p_article_ref text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_sample text := left(btrim(regexp_replace(coalesce(p_text,''), '\s+', ' ', 'g')), 300);
  v_norm text;
begin
  if auth.uid() is null then
    raise exception 'sign-in required' using errcode='42501';
  end if;
  if p_kind is null or p_kind not in ('search_miss','question','not_helpful') then
    raise exception 'invalid kind' using errcode='22023';
  end if;
  v_norm := lower(btrim(regexp_replace(regexp_replace(v_sample, '[׳''`״"]', '', 'g'), '\s+', ' ', 'g')));
  if char_length(v_norm) < 2 then
    return;
  end if;

  delete from public.help_question_rate where created_at < now() - interval '1 day';
  if (select count(*) from public.help_question_rate r
      where r.auth_user_id = auth.uid() and r.created_at > now() - interval '1 hour') >= 30 then
    return; -- silently capped; this is feedback, not a user-facing action
  end if;
  insert into public.help_question_rate(auth_user_id) values (auth.uid());

  insert into public.help_questions as q(kind, normalized_text, sample_text, article_ref)
  values (p_kind, v_norm, v_sample, case when p_kind = 'not_helpful' then left(p_article_ref, 80) end)
  on conflict (kind, normalized_text) do update
    set ask_count = q.ask_count + 1,
        last_asked_at = now(),
        -- Asked again after it was answered means the answer was not found
        -- or did not help, so it reopens. Dismissed stays dismissed.
        status = case when q.status = 'dismissed' then 'dismissed' else 'open' end,
        resolved_at = case when q.status = 'dismissed' then q.resolved_at else null end;
end $$;
revoke all on function public.record_help_question(text,text,text) from public, anon;
grant execute on function public.record_help_question(text,text,text) to authenticated;

create or replace function public.help_assert_system_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_verified_system_admin() then
    raise exception 'verified system admin required' using errcode='42501';
  end if;
end $$;
revoke all on function public.help_assert_system_admin() from public, anon, authenticated;

create or replace function public.system_admin_list_help_questions(p_status text default 'open')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.help_assert_system_admin();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ask_count desc, x.last_asked_at desc), '[]'::jsonb) into result
  from (
    select q.id, q.kind, q.sample_text, q.article_ref, q.ask_count, q.status, q.first_asked_at, q.last_asked_at
    from public.help_questions q
    where q.status = coalesce(p_status, 'open')
    order by q.ask_count desc, q.last_asked_at desc
    limit 200
  ) x;
  return result;
end $$;
revoke all on function public.system_admin_list_help_questions(text) from public, anon;
grant execute on function public.system_admin_list_help_questions(text) to authenticated;

create or replace function public.system_admin_publish_help_article(
  p_question text, p_answer text, p_category_id text default 'more',
  p_keywords text[] default '{}', p_source_question_id uuid default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.help_assert_system_admin();
  insert into public.help_articles(category_id, question, answer, keywords, source_question_id)
  values (coalesce(nullif(btrim(p_category_id), ''), 'more'), btrim(p_question), btrim(p_answer),
          coalesce(p_keywords, '{}'), p_source_question_id)
  returning id into v_id;
  if p_source_question_id is not null then
    update public.help_questions set status = 'answered', resolved_at = now() where id = p_source_question_id;
  end if;
  return v_id;
end $$;
revoke all on function public.system_admin_publish_help_article(text,text,text,text[],uuid) from public, anon;
grant execute on function public.system_admin_publish_help_article(text,text,text,text[],uuid) to authenticated;

create or replace function public.system_admin_set_help_question_status(p_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.help_assert_system_admin();
  if p_status is null or p_status not in ('open','answered','dismissed') then
    raise exception 'invalid status' using errcode='22023';
  end if;
  update public.help_questions
    set status = p_status, resolved_at = case when p_status = 'open' then null else now() end
    where id = p_id;
end $$;
revoke all on function public.system_admin_set_help_question_status(uuid,text) from public, anon;
grant execute on function public.system_admin_set_help_question_status(uuid,text) to authenticated;

create or replace function public.system_admin_list_help_articles()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.help_assert_system_admin();
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into result
  from (select id, category_id, question, answer, keywords, published, created_at from public.help_articles) a;
  return result;
end $$;
revoke all on function public.system_admin_list_help_articles() from public, anon;
grant execute on function public.system_admin_list_help_articles() to authenticated;

create or replace function public.system_admin_set_help_article_published(p_id uuid, p_published boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.help_assert_system_admin();
  update public.help_articles set published = coalesce(p_published, false), updated_at = now() where id = p_id;
end $$;
revoke all on function public.system_admin_set_help_article_published(uuid,boolean) from public, anon;
grant execute on function public.system_admin_set_help_article_published(uuid,boolean) to authenticated;

comment on table public.help_questions is 'Aggregated Help & Support questions with no answer yet (text and counters only; no user, profile or family identifiers).';
comment on table public.help_articles is 'Help & Support answers published by the System Admin; published rows are readable by every signed-in session.';
comment on table public.help_question_rate is 'Per-session submission timestamps used only to cap record_help_question; pruned after a day.';
