import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { HELP_CATEGORIES, HelpCategory, HelpItem, normalizeHelpText, searchHelp } from '../lib/helpCenter';
import { fetchPublishedHelpArticles, mergeHelpArticles, recordHelpQuestion } from '../lib/helpCenterRemote';

/** A search with no result is reported after the user stops typing for this long. */
const SEARCH_MISS_REPORT_DELAY_MS = 2000;

interface HelpCenterModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * "עזרה ותמיכה": searchable FAQ plus a way to write to support. Text only,
 * no external service. It learns without AI: searches that find nothing,
 * questions sent from here and "לא עזר" votes reach the System Admin console
 * (help_questions), and the answers published there (help_articles) are
 * merged in below. Built-in answers always show, even offline. The support address comes from
 * EXPO_PUBLIC_SUPPORT_EMAIL (PRD §16: configuration, not code); without it
 * the contact card is simply not shown.
 */
export function HelpCenterModal({ visible, onClose }: HelpCenterModalProps) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [categories, setCategories] = useState<HelpCategory[]>(HELP_CATEGORIES);
  const [feedback, setFeedback] = useState<Record<string, 'yes' | 'no'>>({});
  const [sentQuestion, setSentQuestion] = useState<string | null>(null);
  const reportedMisses = useRef(new Set<string>());
  const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setOpenId(null);
      setFeedback({});
      setSentQuestion(null);
      reportedMisses.current.clear();
      return undefined;
    }
    let active = true;
    fetchPublishedHelpArticles()
      .then((articles) => { if (active) setCategories(mergeHelpArticles(HELP_CATEGORIES, articles)); })
      .catch(() => { /* offline or not configured: the built-in answers still show */ });
    return () => { active = false; };
  }, [visible]);

  const results = useMemo(() => searchHelp(query, categories), [query, categories]);
  const searching = query.trim().length > 0;
  const normalizedQuery = normalizeHelpText(query);
  const noResults = searching && results.length === 0;

  // Report a finished search that found nothing, once per text per visit.
  useEffect(() => {
    if (!visible || !noResults || normalizedQuery.length < 3 || reportedMisses.current.has(normalizedQuery)) return undefined;
    const timer = setTimeout(() => {
      reportedMisses.current.add(normalizedQuery);
      void recordHelpQuestion('search_miss', query.trim());
    }, SEARCH_MISS_REPORT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, noResults, normalizedQuery, query]);

  const sendQuestion = () => {
    const text = query.trim();
    if (text.length < 3) return;
    reportedMisses.current.add(normalizedQuery);
    setSentQuestion(normalizedQuery);
    void recordHelpQuestion('question', text);
  };

  const voteNotHelpful = (item: HelpItem) => {
    setFeedback((prev) => ({ ...prev, [item.id]: 'no' }));
    void recordHelpQuestion('not_helpful', item.question, item.id);
  };

  const contactSupport = async () => {
    if (!supportEmail) return;
    const subject = encodeURIComponent('Walkie Doggy Link — פנייה לתמיכה');
    try {
      await Linking.openURL(`mailto:${supportEmail}?subject=${subject}`);
    } catch {
      Alert.alert('לא הצלחנו לפתוח את האימייל', `אפשר לכתוב לנו ישירות לכתובת ${supportEmail}.`);
    }
  };

  const renderItem = (item: HelpItem, categoryTitle?: string) => {
    const open = openId === item.id;
    return (
      <View key={item.id} style={styles.item}>
        <Pressable
          style={styles.questionRow}
          onPress={() => setOpenId(open ? null : item.id)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={item.question}
          testID={`help-item-${item.id}`}
        >
          <RtlText style={styles.question}>{item.question}</RtlText>
          <RtlText style={styles.toggle}>{open ? '−' : '+'}</RtlText>
        </Pressable>
        {open ? (
          <View style={styles.answerBox}>
            {categoryTitle ? <RtlText style={styles.resultCategory}>{categoryTitle}</RtlText> : null}
            <RtlText style={styles.answer}>{item.answer}</RtlText>
            {feedback[item.id] ? (
              <RtlText style={styles.feedbackThanks}>
                {feedback[item.id] === 'yes' ? 'תודה!' : 'תודה, נשפר את התשובה.'}
              </RtlText>
            ) : (
              <View style={styles.feedbackRow}>
                <RtlText style={styles.feedbackPrompt}>עזר לכם?</RtlText>
                <Pressable
                  style={styles.feedbackButton}
                  onPress={() => setFeedback((prev) => ({ ...prev, [item.id]: 'yes' }))}
                  accessibilityRole="button"
                  accessibilityLabel="התשובה עזרה"
                >
                  <RtlText style={styles.feedbackButtonText}>👍 כן</RtlText>
                </Pressable>
                <Pressable
                  style={styles.feedbackButton}
                  onPress={() => voteNotHelpful(item)}
                  accessibilityRole="button"
                  accessibilityLabel="התשובה לא עזרה"
                  testID={`help-not-helpful-${item.id}`}
                >
                  <RtlText style={styles.feedbackButtonText}>👎 לא</RtlText>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת עזרה ותמיכה" />
        <View style={styles.sheet}>
          <RtlText style={styles.title} accessibilityRole="header">💬 עזרה ותמיכה</RtlText>

          <TextInput
            value={query}
            onChangeText={(text) => { setQuery(text); setOpenId(null); }}
            placeholder="חיפוש: התראות, החלפה, GPS…"
            placeholderTextColor={colors.textSecondary}
            style={styles.search}
            textAlign="right"
            returnKeyType="search"
            accessibilityLabel="חיפוש בשאלות הנפוצות"
            testID="help-search"
          />

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            {searching ? (
              results.length > 0 ? (
                <View style={styles.card}>{results.map(({ item, categoryTitle }) => renderItem(item, categoryTitle))}</View>
              ) : (
                <View style={styles.emptyBox}>
                  <RtlText style={styles.empty}>לא מצאנו תשובה לחיפוש הזה. אפשר לנסות מילה אחרת, או לשלוח לנו את השאלה ונוסיף לה תשובה.</RtlText>
                  {sentQuestion === normalizedQuery ? (
                    <RtlText style={styles.feedbackThanks}>השאלה נשלחה, תודה! התשובה תופיע כאן בקרוב.</RtlText>
                  ) : (
                    <Button
                      label="📨 שלחו לנו את השאלה"
                      variant="secondary"
                      onPress={sendQuestion}
                      disabled={query.trim().length < 3}
                    />
                  )}
                </View>
              )
            ) : (
              categories.map((category) => (
                <View key={category.id} style={styles.category}>
                  <RtlText style={styles.categoryTitle}>{category.title}</RtlText>
                  <View style={styles.card}>{category.items.map((item) => renderItem(item))}</View>
                </View>
              ))
            )}

            {supportEmail ? (
              <View style={styles.contact}>
                <RtlText style={styles.contactTitle}>לא מצאתם תשובה?</RtlText>
                <RtlText style={styles.contactText}>כתבו לנו ונחזור אליכם. כדאי לצרף צילום מסך.</RtlText>
                <Button label="✉️ כתבו לנו" variant="secondary" onPress={() => void contactSupport()} />
              </View>
            ) : null}
          </ScrollView>

          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: spacing.lg, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  search: {
    ...typography.body,
    fontWeight: '500',
    color: colors.textPrimary,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  category: { marginBottom: spacing.md },
  categoryTitle: { ...typography.sectionTitle, fontSize: 15, color: colors.textPrimary, textAlign: 'right', marginBottom: spacing.xs },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: 'hidden' },
  item: { borderBottomWidth: 1, borderBottomColor: colors.border },
  questionRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 48 },
  question: { ...typography.body, fontSize: 15, flex: 1, color: colors.textPrimary, textAlign: 'right' },
  toggle: { fontSize: 20, fontWeight: '700', color: colors.primaryDark, width: 20, textAlign: 'center' },
  answerBox: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
  resultCategory: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  answer: { ...typography.meta, fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'right' },
  emptyBox: { paddingVertical: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  empty: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },
  feedbackRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  feedbackPrompt: { ...typography.meta, color: colors.textSecondary },
  feedbackButton: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  feedbackButtonText: { ...typography.meta, color: colors.textPrimary },
  feedbackThanks: { ...typography.meta, color: colors.success, textAlign: 'right', marginTop: spacing.xs },
  contact: { backgroundColor: colors.primarySoft, borderRadius: radii.md, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  contactTitle: { ...typography.cardTitle, color: colors.primaryDark, textAlign: 'right' },
  contactText: { ...typography.meta, color: colors.textSecondary, textAlign: 'right', marginBottom: spacing.xs },
  closeButton: { marginTop: spacing.sm },
});
