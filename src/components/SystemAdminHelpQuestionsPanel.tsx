import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { HELP_CATEGORIES } from '../lib/helpCenter';
import {
  EXTRA_HELP_CATEGORY_ID,
  EXTRA_HELP_CATEGORY_TITLE,
  listAdminHelpArticles,
  listAdminHelpQuestions,
  publishHelpArticle,
  setHelpArticlePublished,
  setHelpQuestionStatus,
  type AdminHelpArticle,
  type AdminHelpQuestion,
} from '../lib/helpCenterRemote';

const CATEGORY_OPTIONS = [
  ...HELP_CATEGORIES.map((c) => ({ id: c.id, title: c.title })),
  { id: EXTRA_HELP_CATEGORY_ID, title: EXTRA_HELP_CATEGORY_TITLE },
];

const KIND_LABEL: Record<AdminHelpQuestion['kind'], string> = {
  search_miss: '🔍 חיפוש בלי תוצאה',
  question: '📨 שאלה שנשלחה',
  not_helpful: '👎 תשובה שלא עזרה',
};

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /42501|permission|forbidden|unauthorized/i.test(message)
    ? 'הגישה נדחתה. נדרשת התחברות מאומתת כמנהל מערכת.'
    : 'הפעולה לא הצליחה. בדקו את החיבור ונסו שוב.';
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface Draft {
  sourceId: string | null;
  question: string;
  answer: string;
  categoryId: string;
  keywords: string;
}

/**
 * "❓ שאלות פתוחות": what families looked for and did not find in Help &
 * Support, most-asked first. Writing an answer here and publishing it makes
 * it appear in every family's Help & Support at once (no deploy).
 */
export function SystemAdminHelpQuestionsPanel() {
  const [tab, setTab] = useState<'open' | 'published'>('open');
  const [questions, setQuestions] = useState<AdminHelpQuestion[]>([]);
  const [articles, setArticles] = useState<AdminHelpArticle[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'open') setQuestions(await listAdminHelpQuestions('open'));
      else setArticles(await listAdminHelpArticles());
    } catch (e) {
      setError(friendly(e));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  const startAnswer = (q: AdminHelpQuestion | null) => {
    setNotice(null);
    setDraft({ sourceId: q?.id ?? null, question: q?.sample_text ?? '', answer: '', categoryId: EXTRA_HELP_CATEGORY_ID, keywords: '' });
  };

  const publish = async () => {
    if (!draft) return;
    const question = draft.question.trim();
    const answer = draft.answer.trim();
    if (question.length < 3 || answer.length < 3) {
      setError('צריך למלא גם שאלה וגם תשובה.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await publishHelpArticle({
        question,
        answer,
        categoryId: draft.categoryId,
        keywords: draft.keywords.split(/[,،\n]/).map((k) => k.trim()).filter(Boolean).slice(0, 20),
        sourceQuestionId: draft.sourceId,
      });
      setDraft(null);
      setNotice('התשובה פורסמה ומופיעה עכשיו בעזרה ותמיכה אצל כל המשפחות.');
      await load();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setSaving(false);
    }
  };

  const dismiss = async (q: AdminHelpQuestion) => {
    setError(null);
    try {
      await setHelpQuestionStatus(q.id, 'dismissed');
      setQuestions((prev) => prev.filter((x) => x.id !== q.id));
    } catch (e) {
      setError(friendly(e));
    }
  };

  const togglePublished = async (a: AdminHelpArticle) => {
    setError(null);
    try {
      await setHelpArticlePublished(a.id, !a.published);
      setArticles((prev) => prev.map((x) => (x.id === a.id ? { ...x, published: !a.published } : x)));
    } catch (e) {
      setError(friendly(e));
    }
  };

  if (draft) {
    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <RtlText style={styles.sectionTitle}>✍️ תשובה חדשה</RtlText>
        <RtlText style={styles.label}>השאלה, כפי שתופיע למשפחות</RtlText>
        <TextInput
          value={draft.question}
          onChangeText={(question) => setDraft({ ...draft, question })}
          style={styles.input}
          textAlign="right"
          maxLength={200}
          accessibilityLabel="נוסח השאלה"
        />
        <RtlText style={styles.label}>התשובה</RtlText>
        <TextInput
          value={draft.answer}
          onChangeText={(answer) => setDraft({ ...draft, answer })}
          style={[styles.input, styles.answerInput]}
          textAlign="right"
          multiline
          maxLength={2000}
          accessibilityLabel="נוסח התשובה"
          testID="help-admin-answer"
        />
        <RtlText style={styles.label}>נושא</RtlText>
        <View style={styles.chips}>
          {CATEGORY_OPTIONS.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => setDraft({ ...draft, categoryId: c.id })}
              style={[styles.chip, draft.categoryId === c.id && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: draft.categoryId === c.id }}
            >
              <RtlText style={[styles.chipText, draft.categoryId === c.id && styles.chipTextActive]}>{c.title}</RtlText>
            </Pressable>
          ))}
        </View>
        <RtlText style={styles.label}>מילות חיפוש נוספות (מופרדות בפסיק, לא חובה)</RtlText>
        <TextInput
          value={draft.keywords}
          onChangeText={(keywords) => setDraft({ ...draft, keywords })}
          style={styles.input}
          textAlign="right"
          accessibilityLabel="מילות חיפוש"
        />
        {error ? <RtlText style={styles.error}>{error}</RtlText> : null}
        <Button label={saving ? 'מפרסם…' : '✅ פרסום'} onPress={() => void publish()} disabled={saving} />
        <Button label="ביטול" variant="secondary" onPress={() => { setDraft(null); setError(null); }} disabled={saving} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <RtlText style={styles.sectionTitle}>❓ שאלות מהעזרה</RtlText>
      <RtlText style={styles.hint}>מה משפחות חיפשו בעזרה ולא מצאו, מהנשאל ביותר. תשובה שתפרסמו כאן תופיע מיד אצל כולם.</RtlText>
      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('open')} style={[styles.chip, tab === 'open' && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: tab === 'open' }}>
          <RtlText style={[styles.chipText, tab === 'open' && styles.chipTextActive]}>פתוחות</RtlText>
        </Pressable>
        <Pressable onPress={() => setTab('published')} style={[styles.chip, tab === 'published' && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: tab === 'published' }}>
          <RtlText style={[styles.chipText, tab === 'published' && styles.chipTextActive]}>תשובות שפורסמו</RtlText>
        </Pressable>
      </View>

      {notice ? <RtlText style={styles.notice}>{notice}</RtlText> : null}
      {error ? <RtlText style={styles.error}>{error}</RtlText> : null}
      {loading ? <ActivityIndicator color={colors.primary} accessibilityLabel="טוען…" /> : null}

      {tab === 'open' ? (
        <>
          <Button label="➕ תשובה חדשה בלי שאלה" variant="secondary" onPress={() => startAnswer(null)} compact />
          {!loading && questions.length === 0 ? <RtlText style={styles.hint}>אין שאלות פתוחות כרגע.</RtlText> : null}
          {questions.map((q) => (
            <View key={q.id} style={styles.card}>
              <RtlText style={styles.kind}>{KIND_LABEL[q.kind]}</RtlText>
              <RtlText style={styles.questionText}>{q.sample_text}</RtlText>
              <RtlText style={styles.meta}>
                {`נשאל ${q.ask_count} ${q.ask_count === 1 ? 'פעם' : 'פעמים'} · לאחרונה ${shortDate(q.last_asked_at)}`}
              </RtlText>
              <View style={styles.actions}>
                <Button label="✍️ לענות" onPress={() => startAnswer(q)} compact style={styles.flex} />
                <Button label="התעלם" variant="secondary" onPress={() => void dismiss(q)} compact style={styles.flex} />
              </View>
            </View>
          ))}
        </>
      ) : (
        <>
          {!loading && articles.length === 0 ? <RtlText style={styles.hint}>עוד לא פורסמו תשובות מכאן.</RtlText> : null}
          {articles.map((a) => (
            <View key={a.id} style={[styles.card, !a.published && styles.cardMuted]}>
              <RtlText style={styles.questionText}>{a.question}</RtlText>
              <RtlText style={styles.answerText}>{a.answer}</RtlText>
              <RtlText style={styles.meta}>
                {`${CATEGORY_OPTIONS.find((c) => c.id === a.category_id)?.title ?? EXTRA_HELP_CATEGORY_TITLE} · ${a.published ? 'מוצגת' : 'מוסתרת'}`}
              </RtlText>
              <Button label={a.published ? 'הסתרה' : 'הצגה מחדש'} variant="secondary" onPress={() => void togglePublished(a)} compact />
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 96 },
  flex: { flex: 1 },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'right' },
  hint: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  label: { ...typography.cardTitle, color: colors.textPrimary, textAlign: 'right', marginTop: spacing.xs },
  input: {
    ...typography.body,
    fontWeight: '500',
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  answerInput: { minHeight: 140, textAlignVertical: 'top' },
  tabs: { flexDirection: 'row-reverse', gap: spacing.sm },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.xs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { ...typography.meta, color: colors.textPrimary },
  chipTextActive: { color: colors.primaryDark, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, gap: spacing.xs },
  cardMuted: { opacity: 0.6 },
  kind: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  questionText: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },
  answerText: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  meta: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  actions: { flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.xs },
  notice: { ...typography.meta, color: colors.success, textAlign: 'right' },
  error: { ...typography.meta, color: colors.danger, textAlign: 'right' },
});
