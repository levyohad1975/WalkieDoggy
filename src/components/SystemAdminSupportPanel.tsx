import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { familyIdentityParts } from '../lib/systemAdminPresence';
import {
  listAdminSupportTickets,
  replyToSupportTicket,
  setSupportTicketStatus,
  supportStatusLabel,
  supportTopicLabel,
  type AdminSupportTicket,
  type SupportStatus,
} from '../lib/support';

const TABS: Array<{ id: SupportStatus; label: string }> = [
  { id: 'open', label: 'ממתינות' },
  { id: 'answered', label: 'נענו' },
  { id: 'closed', label: 'סגורות' },
];

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? '');
  return /42501|permission|verified system admin/i.test(message)
    ? 'הגישה נדחתה. נדרשת התחברות מאומתת כמנהל מערכת.'
    : 'הפעולה לא הצליחה. בדקו את החיבור ונסו שוב.';
}

function contextLine(context: Record<string, unknown>): string {
  const parts = [context.device, context.installed === true ? 'מותקן' : context.installed === false ? 'בדפדפן' : null]
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  return parts.join(' · ');
}

/**
 * "📨 פניות": support requests sent from Help & Support, with who sent them
 * and the details that identify the family. A reply is shown to the sender
 * under "הפניות שלי" and announced with a push.
 */
export function SystemAdminSupportPanel() {
  const [tab, setTab] = useState<SupportStatus>('open');
  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTickets(await listAdminSupportTickets(tab));
    } catch (e) {
      setError(friendly(e));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  const sendReply = async (ticket: AdminSupportTicket) => {
    const text = replyText.trim();
    if (!text || busyId) return;
    setBusyId(ticket.id);
    setError(null);
    try {
      await replyToSupportTicket(ticket.id, text);
      setReplyFor(null);
      setReplyText('');
      setNotice(`התשובה נשלחה ל${ticket.userName ?? 'פונה'}.`);
      await load();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusyId(null);
    }
  };

  const changeStatus = async (ticket: AdminSupportTicket, status: SupportStatus) => {
    if (busyId) return;
    setBusyId(ticket.id);
    setError(null);
    try {
      await setSupportTicketStatus(ticket.id, status);
      setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <RtlText style={styles.sectionTitle}>📨 פניות</RtlText>
      <View style={styles.chips}>
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => { setTab(t.id); setNotice(null); }} style={[styles.chip, tab === t.id && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: tab === t.id }}>
            <RtlText style={[styles.chipText, tab === t.id && styles.chipTextActive]}>{t.label}</RtlText>
          </Pressable>
        ))}
        <Pressable onPress={() => void load()} style={styles.chip} accessibilityRole="button" accessibilityLabel="רענון הפניות">
          <RtlText style={styles.chipText}>↻ רענון</RtlText>
        </Pressable>
      </View>

      {notice ? <RtlText style={styles.notice}>{notice}</RtlText> : null}
      {error ? <RtlText style={styles.error} accessibilityRole="alert">{error}</RtlText> : null}
      {loading && tickets.length === 0 ? <ActivityIndicator color={colors.primary} accessibilityLabel="טוען…" /> : null}
      {!loading && !error && tickets.length === 0 ? <RtlText style={styles.hint}>אין פניות ברשימה הזו.</RtlText> : null}

      {tickets.map((t) => (
        <View key={t.id} style={styles.card} testID={`support-ticket-${t.id}`}>
          <RtlText style={styles.meta}>{`${supportTopicLabel(t.topic)} · ${new Date(t.createdAt).toLocaleString('he-IL')} · ${supportStatusLabel(t.status)}`}</RtlText>
          <RtlText style={styles.from}>{`${t.userName ?? '—'} · משפחת ${t.familyName}`}</RtlText>
          <RtlText style={styles.identity}>
            {[...familyIdentityParts({ inviteCode: t.inviteCode, adminNames: t.adminNames, dogNames: t.dogNames, verifiedEmail: t.verifiedEmail }), contextLine(t.context)].filter(Boolean).join(' · ')}
          </RtlText>
          <RtlText style={styles.body}>{t.body}</RtlText>

          {t.adminReply ? (
            <View style={styles.replyBox}>
              <RtlText style={styles.replyTitle}>{t.replySeenAt ? 'התשובה שלך · נקראה' : 'התשובה שלך · טרם נקראה'}</RtlText>
              <RtlText style={styles.body}>{t.adminReply}</RtlText>
            </View>
          ) : null}

          {replyFor === t.id ? (
            <View style={styles.replyForm}>
              <TextInput
                value={replyText}
                onChangeText={setReplyText}
                placeholder="התשובה שתוצג לפונה בתוך האפליקציה…"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                textAlign="right"
                multiline
                maxLength={2000}
                accessibilityLabel="תשובה לפנייה"
              />
              <View style={styles.actions}>
                <Button label={busyId === t.id ? 'שולח…' : '📨 שליחת תשובה'} onPress={() => void sendReply(t)} disabled={busyId === t.id || !replyText.trim()} compact style={styles.flex} />
                <Button label="ביטול" variant="secondary" onPress={() => { setReplyFor(null); setReplyText(''); }} compact style={styles.flex} />
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              <Button label={t.adminReply ? '✍️ עדכון התשובה' : '✍️ לענות'} onPress={() => { setReplyFor(t.id); setReplyText(''); setNotice(null); }} compact style={styles.flex} />
              {t.status !== 'closed' ? (
                <Button label="סגירה" variant="secondary" onPress={() => void changeStatus(t, 'closed')} disabled={busyId === t.id} compact style={styles.flex} />
              ) : (
                <Button label="פתיחה מחדש" variant="secondary" onPress={() => void changeStatus(t, 'open')} disabled={busyId === t.id} compact style={styles.flex} />
              )}
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 96 },
  flex: { flex: 1 },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'right' },
  hint: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.xs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { ...typography.meta, color: colors.textPrimary },
  chipTextActive: { color: colors.primaryDark, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, gap: spacing.xs },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  from: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },
  identity: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  body: { ...typography.meta, fontSize: 14, color: colors.textPrimary, textAlign: 'right' },
  replyBox: { backgroundColor: colors.primarySoft, borderRadius: radii.sm, padding: spacing.sm, gap: 2 },
  replyTitle: { ...typography.caption, color: colors.primaryDark, textAlign: 'right' },
  replyForm: { gap: spacing.xs },
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
    minHeight: 100,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.xs },
  notice: { ...typography.meta, color: colors.success, textAlign: 'right' },
  error: { ...typography.meta, color: colors.danger, textAlign: 'right' },
});
