import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { HELP_CATEGORIES, HelpCategory, HelpItem, normalizeHelpText, searchHelp } from '../lib/helpCenter';
import { fetchPublishedHelpArticles, mergeHelpArticles, recordHelpQuestion } from '../lib/helpCenterRemote';
import {
  SUPPORT_TOPICS,
  listMySupportTickets,
  markMySupportRepliesSeen,
  submitSupportTicket,
  supportStatusLabel,
  supportTopicLabel,
  type MySupportTicket,
  type SupportTopic,
} from '../lib/support';

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
 * merged in below. Built-in answers always show, even offline.
 *
 * "כתבו לנו" (owner request 2026-11-02) opens an in-app form instead of the
 * mail app: the request reaches the System Admin console ("📨 פניות", with
 * an email and a push), and the reply comes back under "הפניות שלי".
 */
export function HelpCenterModal({ visible, onClose }: HelpCenterModalProps) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [categories, setCategories] = useState<HelpCategory[]>(HELP_CATEGORIES);
  const [feedback, setFeedback] = useState<Record<string, 'yes' | 'no'>>({});
  const [sentQuestion, setSentQuestion] = useState<string | null>(null);
  const reportedMisses = useRef(new Set<string>());
  const [view, setView] = useState<'faq' | 'contact' | 'mine'>('faq');
  const [topic, setTopic] = useState<SupportTopic>('question');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendState, setSendState] = useState<{ ok: boolean; text: string } | null>(null);
  const [myTickets, setMyTickets] = useState<MySupportTicket[] | null>(null);
  const [myTicketsError, setMyTicketsError] = useState(false);
  const unreadReplies = (myTickets ?? []).filter((t) => t.replyUnread).length;

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setOpenId(null);
      setFeedback({});
      setSentQuestion(null);
      reportedMisses.current.clear();
      setView('faq');
      setMessage('');
      setSendState(null);
      return undefined;
    }
    let active = true;
    fetchPublishedHelpArticles()
      .then((articles) => { if (active) setCategories(mergeHelpArticles(HELP_CATEGORIES, articles)); })
      .catch(() => { /* offline or not configured: the built-in answers still show */ });
    listMySupportTickets()
      .then((tickets) => { if (active) { setMyTickets(tickets); setMyTicketsError(false); } })
      .catch(() => { if (active) setMyTicketsError(true); });
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

  const openContact = () => {
    setSendState(null);
    if (!message.trim() && query.trim()) setMessage(query.trim());
    setView('contact');
  };

  const sendTicket = async () => {
    const text = message.trim();
    if (text.length < 3 || sending) return;
    setSending(true);
    setSendState(null);
    try {
      await submitSupportTicket(topic, text);
      setMessage('');
      setSendState({ ok: true, text: 'הפנייה נשלחה, תודה! התשובה תופיע כאן תחת "הפניות שלי", ותקבלו התראה.' });
      listMySupportTickets().then(setMyTickets).catch(() => undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? '');
      setSendState({
        ok: false,
        text: /too many/i.test(msg)
          ? 'נשלחו הרבה פניות בשעה האחרונה. אפשר לנסות שוב מאוחר יותר.'
          : /active profile/i.test(msg)
            ? 'כדי לשלוח פנייה צריך להיות מחוברים לפרופיל במשפחה.'
            : 'השליחה לא הצליחה. בדקו את החיבור ונסו שוב.',
      });
    } finally {
      setSending(false);
    }
  };

  const openMine = () => {
    setView('mine');
    listMySupportTickets()
      .then((tickets) => {
        setMyTickets(tickets);
        setMyTicketsError(false);
        if (tickets.some((t) => t.replyUnread)) void markMySupportRepliesSeen().catch(() => undefined);
      })
      .catch(() => setMyTicketsError(true));
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
          <RtlText style={styles.title} accessibilityRole="header">
            {view === 'contact' ? '✍️ כתבו לנו' : view === 'mine' ? '📬 הפניות שלי' : '💬 עזרה ותמיכה'}
          </RtlText>
          {view !== 'faq' ? (
            <Pressable onPress={() => setView('faq')} accessibilityRole="button" accessibilityLabel="חזרה לשאלות הנפוצות" hitSlop={8}>
              <RtlText style={styles.backLink}>‹ חזרה לשאלות הנפוצות</RtlText>
            </Pressable>
          ) : null}

          {view === 'contact' ? (
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              <RtlText style={styles.contactText}>במה מדובר?</RtlText>
              <View style={styles.topicRow}>
                {SUPPORT_TOPICS.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => setTopic(t.id)}
                    style={[styles.topicChip, topic === t.id && styles.topicChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: topic === t.id }}
                  >
                    <RtlText style={[styles.topicText, topic === t.id && styles.topicTextActive]}>{t.label}</RtlText>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={message}
                onChangeText={(text) => { setMessage(text); if (sendState?.ok) setSendState(null); }}
                placeholder="ספרו לנו מה קרה או מה תרצו לשאול…"
                placeholderTextColor={colors.textSecondary}
                style={[styles.search, styles.messageInput]}
                textAlign="right"
                multiline
                maxLength={2000}
                accessibilityLabel="תוכן הפנייה"
                testID="support-message"
              />
              <RtlText style={styles.privacyNote}>יחד עם הפנייה נשלחים שמכם, המשפחה וסוג המכשיר, כדי שנוכל לעזור.</RtlText>
              {sendState ? (
                <RtlText style={sendState.ok ? styles.feedbackThanks : styles.errorText} accessibilityLiveRegion="polite">{sendState.text}</RtlText>
              ) : null}
              <Button
                label={sending ? 'שולח…' : '📨 שליחה'}
                onPress={() => void sendTicket()}
                disabled={sending || message.trim().length < 3}
              />
            </ScrollView>
          ) : view === 'mine' ? (
            <ScrollView style={styles.scroll}>
              {myTickets === null && !myTicketsError ? <ActivityIndicator color={colors.primary} accessibilityLabel="טוען…" /> : null}
              {myTicketsError ? <RtlText style={styles.errorText}>לא הצלחנו לטעון את הפניות. נסו שוב.</RtlText> : null}
              {myTickets && myTickets.length === 0 ? <RtlText style={styles.empty}>עוד לא שלחתם פניות.</RtlText> : null}
              {(myTickets ?? []).map((t) => (
                <View key={t.id} style={styles.ticket}>
                  <RtlText style={styles.ticketMeta}>
                    {`${supportTopicLabel(t.topic)} · ${new Date(t.createdAt).toLocaleDateString('he-IL')} · ${supportStatusLabel(t.status)}`}
                  </RtlText>
                  <RtlText style={styles.ticketBody}>{t.body}</RtlText>
                  {t.adminReply ? (
                    <View style={styles.replyBox}>
                      <RtlText style={styles.replyTitle}>{t.replyUnread ? '🆕 תשובה מאיתנו' : 'תשובה מאיתנו'}</RtlText>
                      <RtlText style={styles.ticketBody}>{t.adminReply}</RtlText>
                    </View>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          ) : (
            <>
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

              <View style={styles.contact}>
                <RtlText style={styles.contactTitle}>לא מצאתם תשובה?</RtlText>
                <RtlText style={styles.contactText}>כתבו לנו מכאן, ונחזור אליכם בתוך האפליקציה.</RtlText>
                <Button label="✍️ כתבו לנו" variant="secondary" onPress={openContact} />
                {myTickets && myTickets.length > 0 ? (
                  <Button
                    label={unreadReplies > 0 ? `📬 הפניות שלי · ${unreadReplies} ${unreadReplies === 1 ? 'תשובה חדשה' : 'תשובות חדשות'}` : `📬 הפניות שלי (${myTickets.length})`}
                    variant="secondary"
                    onPress={openMine}
                  />
                ) : null}
              </View>
            </ScrollView>
            </>
          )}

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
  backLink: { ...typography.meta, color: colors.primaryDark, fontWeight: '700', textAlign: 'right', marginBottom: spacing.sm },
  topicRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  topicChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.surface },
  topicChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  topicText: { ...typography.meta, color: colors.textPrimary },
  topicTextActive: { color: colors.primaryDark, fontWeight: '700' },
  messageInput: { minHeight: 120, textAlignVertical: 'top' },
  privacyNote: { ...typography.caption, fontWeight: '500', color: colors.textSecondary, textAlign: 'right', marginBottom: spacing.sm },
  errorText: { ...typography.meta, color: colors.danger, textAlign: 'right', marginBottom: spacing.xs },
  ticket: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  ticketMeta: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  ticketBody: { ...typography.meta, fontSize: 14, color: colors.textPrimary, textAlign: 'right' },
  replyBox: { backgroundColor: colors.primarySoft, borderRadius: radii.sm, padding: spacing.sm, gap: 2 },
  replyTitle: { ...typography.caption, color: colors.primaryDark, textAlign: 'right' },
});
