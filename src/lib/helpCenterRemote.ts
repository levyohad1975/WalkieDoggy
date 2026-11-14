/**
 * Server side of Help & Support (migration 20261102120000_help_center_learning).
 *
 * Families: read published answers and report what they could not find.
 * Reporting is best-effort feedback and never surfaces an error to the user.
 * System Admin: list open questions, publish answers, dismiss or reopen.
 * Every admin RPC is re-authorized on the server (is_verified_system_admin).
 */
import { supabase, SupabaseNotConfiguredError } from './supabase';
import type { HelpCategory } from './helpCenter';

export type HelpQuestionKind = 'search_miss' | 'question' | 'not_helpful';
export type HelpQuestionStatus = 'open' | 'answered' | 'dismissed';

export interface PublishedHelpArticle {
  id: string;
  category_id: string;
  question: string;
  answer: string;
  keywords: string[];
}

export interface AdminHelpQuestion {
  id: string;
  kind: HelpQuestionKind;
  sample_text: string;
  article_ref: string | null;
  ask_count: number;
  status: HelpQuestionStatus;
  first_asked_at: string;
  last_asked_at: string;
}

export interface AdminHelpArticle extends PublishedHelpArticle {
  published: boolean;
  created_at: string;
}

function client() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

export async function fetchPublishedHelpArticles(): Promise<PublishedHelpArticle[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('help_articles')
    .select('id, category_id, question, answer, keywords')
    .eq('published', true)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as PublishedHelpArticle[];
}

export async function recordHelpQuestion(kind: HelpQuestionKind, text: string, articleRef?: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('record_help_question', {
      p_kind: kind,
      p_text: text.slice(0, 300),
      p_article_ref: articleRef ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}

/** Server answers join their category; unknown or missing categories go to "שאלות נוספות". */
export const EXTRA_HELP_CATEGORY_ID = 'more';
export const EXTRA_HELP_CATEGORY_TITLE = '📝 שאלות נוספות';

export function mergeHelpArticles(base: HelpCategory[], articles: PublishedHelpArticle[]): HelpCategory[] {
  if (articles.length === 0) return base;
  const merged = base.map((category) => ({ ...category, items: [...category.items] }));
  const byId = new Map(merged.map((category) => [category.id, category]));
  for (const article of articles) {
    const item = { id: `remote-${article.id}`, question: article.question, answer: article.answer, keywords: article.keywords ?? [] };
    let target = byId.get(article.category_id);
    if (!target) {
      target = byId.get(EXTRA_HELP_CATEGORY_ID);
      if (!target) {
        target = { id: EXTRA_HELP_CATEGORY_ID, title: EXTRA_HELP_CATEGORY_TITLE, items: [] };
        merged.push(target);
        byId.set(target.id, target);
      }
    }
    target.items.push(item);
  }
  return merged;
}

export async function listAdminHelpQuestions(status: HelpQuestionStatus = 'open'): Promise<AdminHelpQuestion[]> {
  const { data, error } = await client().rpc('system_admin_list_help_questions', { p_status: status });
  if (error) throw error;
  return (data ?? []) as AdminHelpQuestion[];
}

export async function publishHelpArticle(args: {
  question: string;
  answer: string;
  categoryId: string;
  keywords: string[];
  sourceQuestionId: string | null;
}): Promise<string> {
  const { data, error } = await client().rpc('system_admin_publish_help_article', {
    p_question: args.question,
    p_answer: args.answer,
    p_category_id: args.categoryId,
    p_keywords: args.keywords,
    p_source_question_id: args.sourceQuestionId,
  });
  if (error) throw error;
  return data as string;
}

export async function setHelpQuestionStatus(id: string, status: HelpQuestionStatus): Promise<void> {
  const { error } = await client().rpc('system_admin_set_help_question_status', { p_id: id, p_status: status });
  if (error) throw error;
}

export async function listAdminHelpArticles(): Promise<AdminHelpArticle[]> {
  const { data, error } = await client().rpc('system_admin_list_help_articles');
  if (error) throw error;
  return (data ?? []) as AdminHelpArticle[];
}

export async function setHelpArticlePublished(id: string, published: boolean): Promise<void> {
  const { error } = await client().rpc('system_admin_set_help_article_published', { p_id: id, p_published: published });
  if (error) throw error;
}
