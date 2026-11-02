import fs from 'fs';
import path from 'path';
import { HELP_CATEGORIES, searchHelp } from '../helpCenter';
import { EXTRA_HELP_CATEGORY_ID, mergeHelpArticles } from '../helpCenterRemote';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('mergeHelpArticles', () => {
  it('adds published answers to their category, or to "שאלות נוספות", without touching the built-in list', () => {
    const merged = mergeHelpArticles(HELP_CATEGORIES, [
      { id: 'a1', category_id: 'walks', question: 'אפשר לטייל עם שני כלבים יחד?', answer: 'כן, בוחרים את שני הכלבים בתחילת הטיול.', keywords: ['זוג'] },
      { id: 'a2', category_id: 'no-such-category', question: 'איך מוחקים את המשפחה?', answer: 'פונים אלינו במייל ונטפל בזה.', keywords: [] },
    ]);
    expect(merged.find((c) => c.id === 'walks')?.items.some((i) => i.id === 'remote-a1')).toBe(true);
    expect(merged.find((c) => c.id === EXTRA_HELP_CATEGORY_ID)?.items.map((i) => i.id)).toEqual(['remote-a2']);
    expect(HELP_CATEGORIES.find((c) => c.id === 'walks')?.items.some((i) => i.id === 'remote-a1')).toBe(false);
    expect(searchHelp('זוג', merged).map((r) => r.item.id)).toContain('remote-a1');
  });

  it('returns the built-in list unchanged when nothing is published', () => {
    expect(mergeHelpArticles(HELP_CATEGORIES, [])).toBe(HELP_CATEGORIES);
  });
});

describe('help center learning migration', () => {
  const sql = read('supabase/migrations/20261102120000_help_center_learning.sql');

  it('keeps every table behind RLS with no direct client writes', () => {
    for (const table of ['help_questions', 'help_articles', 'help_question_rate']) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated;`);
    }
    expect(sql).toContain('grant select on public.help_articles to authenticated;');
    expect(sql).toMatch(/create policy help_articles_read_published on public\.help_articles\s+for select to authenticated using \(published\);/);
    expect(sql).not.toMatch(/grant (insert|update|delete)/i);
  });

  it('stores no user, profile or family identifier with a question', () => {
    const table = sql.slice(sql.indexOf('create table if not exists public.help_questions'), sql.indexOf('create index if not exists help_questions_open_idx'));
    expect(table).not.toMatch(/user_id|profile_id|family_id|auth_user_id/);
  });

  it('hardens every SECURITY DEFINER function and re-checks the System Admin server-side', () => {
    const fns = sql.split('create or replace function ').slice(1);
    expect(fns.length).toBe(7);
    for (const fn of fns) {
      const name = fn.slice(0, fn.indexOf('('));
      expect(fn).toContain("security definer set search_path = ''");
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`));
    }
    for (const name of ['system_admin_list_help_questions', 'system_admin_publish_help_article', 'system_admin_set_help_question_status', 'system_admin_list_help_articles', 'system_admin_set_help_article_published']) {
      const body = fns.find((fn) => fn.startsWith(`public.${name}(`)) ?? '';
      expect(body).toContain('perform public.help_assert_system_admin();');
    }
    expect(sql).toContain('revoke all on function public.help_assert_system_admin() from public, anon, authenticated;');
  });

  it('requires a signed-in session and caps submissions', () => {
    const record = sql.slice(sql.indexOf('public.record_help_question('), sql.indexOf('create or replace function public.help_assert_system_admin'));
    expect(record).toContain('if auth.uid() is null then');
    expect(record).toContain(">= 30 then");
    expect(record).toContain("status = case when q.status = 'dismissed' then 'dismissed' else 'open' end");
  });
});

describe('Help & Support reports what it could not answer', () => {
  const modal = read('src/components/HelpCenterModal.tsx');

  it('reports a finished search with no result once, after typing stops', () => {
    expect(modal).toContain('const SEARCH_MISS_REPORT_DELAY_MS = 2000;');
    expect(modal).toContain("void recordHelpQuestion('search_miss', query.trim());");
    expect(modal).toContain('reportedMisses.current.has(normalizedQuery)');
  });

  it('lets the user send the question and vote an answer unhelpful', () => {
    expect(modal).toContain('label="📨 שלחו לנו את השאלה"');
    expect(modal).toContain("void recordHelpQuestion('question', text);");
    expect(modal).toContain("void recordHelpQuestion('not_helpful', item.question, item.id);");
  });

  it('shows published answers alongside the built-in ones, falling back silently', () => {
    expect(modal).toContain('setCategories(mergeHelpArticles(HELP_CATEGORIES, articles))');
    expect(modal).toContain('searchHelp(query, categories)');
  });

  it('is reachable from the System Admin console', () => {
    const admin = read('src/screens/SystemAdminScreen.tsx');
    expect(admin).toContain('❓ שאלות מהעזרה');
    expect(admin).toContain('<SystemAdminHelpQuestionsPanel />');
  });
});
