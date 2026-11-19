import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { getAdminChatAttachment, listAdminChatFamilies, listAdminFamilyChats, readAdminChatMessages, type AdminChatConversation, type AdminChatFamily, type AdminChatMessage, type ChatAccessReason } from '../lib/systemAdminChat';

const REASONS: Array<{ id: ChatAccessReason; label: string }> = [
  { id: 'support', label: 'תמיכה' }, { id: 'incident', label: 'בירור תקלה' }, { id: 'policy_review', label: 'בדיקת מדיניות' },
];
function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /42501|permission|forbidden|unauthorized/i.test(message)
    ? 'הגישה נדחתה. נדרשת התחברות מאומתת כמנהל מערכת, מחוץ למצב צפייה או התחזות.'
    : 'לא ניתן לטעון את הנתונים כרגע. בדקו את החיבור ונסו שוב.';
}

export function SystemAdminFamilyChatsPanel() {
  const [families, setFamilies] = useState<AdminChatFamily[]>([]);
  const [search, setSearch] = useState('');
  const [familyOffset, setFamilyOffset] = useState(0);
  const [family, setFamily] = useState<AdminChatFamily | null>(null);
  const [conversations, setConversations] = useState<AdminChatConversation[]>([]);
  const [conversation, setConversation] = useState<AdminChatConversation | null>(null);
  const [reason, setReason] = useState<ChatAccessReason | null>(null);
  const [messages, setMessages] = useState<AdminChatMessage[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openingRef = useRef(false);
  const olderRef = useRef(false);
  const attachmentRef = useRef(new Set<string>());

  const loadFamilies = useCallback(async (append = false) => { setLoading(true); setError(null); const offset = append ? familyOffset + 100 : 0; try { const page = await listAdminChatFamilies(search, offset); setFamilies((current) => append ? [...current, ...page] : page); setFamilyOffset(offset); } catch (e) { setError(friendly(e)); } finally { setLoading(false); } }, [search, familyOffset]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void listAdminChatFamilies(search).then((page) => { if (active) { setFamilies(page); setFamilyOffset(0); } })
      .catch((e) => { if (active) setError(friendly(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search]);

  const chooseFamily = async (item: AdminChatFamily) => {
    setFamily(item); setConversation(null); setReason(null); setMessages([]); setAttachmentUrls({}); setError(null); setLoading(true);
    try { setConversations(await listAdminFamilyChats(item.id)); } catch (e) { setError(friendly(e)); } finally { setLoading(false); }
  };
  const openConversation = (item: AdminChatConversation) => { setConversation(item); setReason(null); setMessages([]); setAttachmentUrls({}); setError(null); };
  const openContents = async (selectedReason: ChatAccessReason) => {
    if (!family || !conversation || openingRef.current) return;
    openingRef.current = true;
    setReason(selectedReason); setLoading(true); setError(null);
    try { setMessages(await readAdminChatMessages({ familyId: family.id, conversationId: conversation.id, reason: selectedReason })); }
    catch (e) { setReason(null); setError(friendly(e)); }
    finally { openingRef.current = false; setLoading(false); }
  };
  const loadOlder = async () => {
    if (!family || !conversation || !reason || !messages.length || olderRef.current) return;
    olderRef.current = true;
    setOlderLoading(true); setError(null);
    try {
      const page = await readAdminChatMessages({ familyId: family.id, conversationId: conversation.id, reason, before: messages[messages.length - 1] });
      setMessages((current) => [...current, ...page]);
    } catch (e) { setError(friendly(e)); } finally { olderRef.current = false; setOlderLoading(false); }
  };
  const loadAttachment = async (message: AdminChatMessage) => {
    if (!family || !conversation || !reason || attachmentRef.current.has(message.id)) return;
    attachmentRef.current.add(message.id);
    setError(null);
    try { const signedUrl = await getAdminChatAttachment({ familyId: family.id, conversationId: conversation.id, messageId: message.id, reason }); setAttachmentUrls((current) => ({ ...current, [message.id]: signedUrl })); }
    catch (e) { attachmentRef.current.delete(message.id); setError(friendly(e)); }
  };

  return <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
    <RtlText style={styles.title} accessibilityRole="header">צ׳אטים של משפחות</RtlText>
    <RtlText style={styles.notice}>הצפייה מיועדת לתמיכה ואבחון, לקריאה בלבד. פתיחת תוכן מתועדת ביומן ביקורת ללא גוף ההודעות או הקבצים. אין כאן אפשרות לשנות שיחה או לסמן הודעות כנקראו.</RtlText>
    {!family ? <>
      <View style={styles.row}>
        <TextInput value={search} onChangeText={setSearch} placeholder="חיפוש לפי שם או מזהה משפחה" placeholderTextColor={colors.textSecondary} style={styles.input} textAlign="right" accessibilityLabel="חיפוש משפחה לפי שם או מזהה" onSubmitEditing={() => void loadFamilies()} />
        <Button label="חיפוש" compact onPress={() => void loadFamilies()} disabled={loading} />
      </View>
      {loading ? <ActivityIndicator color={colors.primary} accessibilityLabel="טוען משפחות" /> : null}
      {families.map((item) => <Pressable key={item.id} style={styles.card} onPress={() => void chooseFamily(item)} accessibilityRole="button" accessibilityLabel={`פתיחת משפחת ${item.name}, מזהה ${item.id}`}>
        <RtlText style={styles.cardTitle}>{item.name}</RtlText><RtlText style={styles.meta}>מזהה: {item.id}</RtlText>
      </Pressable>)}
      {families.length > 0 && families.length % 100 === 0 ? <Button label="טעינת משפחות נוספות" compact onPress={() => void loadFamilies(true)} disabled={loading} /> : null}
      {!loading && !families.length ? <RtlText style={styles.meta}>לא נמצאו משפחות.</RtlText> : null}
    </> : <>
      <Pressable onPress={() => { setFamily(null); setConversation(null); setMessages([]); setError(null); }} accessibilityRole="button"><RtlText style={styles.back}>‹ כל המשפחות</RtlText></Pressable>
      <RtlText style={styles.cardTitle}>{family.name}</RtlText><RtlText style={styles.meta}>מזהה: {family.id}</RtlText>
      {!conversation ? <>
        <RtlText style={styles.subTitle}>שיחות ({conversations.length})</RtlText>
        {conversations.map((item) => <Pressable key={item.id} style={styles.card} onPress={() => openConversation(item)} accessibilityRole="button">
          <RtlText style={styles.cardTitle}>{item.kind === 'direct' ? 'שיחה פרטית' : item.kind === 'group' ? `שיחה קבוצתית${item.title ? ` · ${item.title}` : ''}` : 'שיחה משפחתית'}</RtlText>
          <RtlText style={styles.meta}>מזהה שיחה: {item.id}</RtlText>
          <RtlText style={styles.meta}>משתתפים: {item.participants.map((p) => p.name).join(', ') || 'לא ידועים'}</RtlText>
        </Pressable>)}
        {!loading && !conversations.length ? <RtlText style={styles.meta}>לא נמצאו שיחות במשפחה זו.</RtlText> : null}
      </> : <>
        <Pressable onPress={() => { setConversation(null); setReason(null); setMessages([]); setError(null); }} accessibilityRole="button"><RtlText style={styles.back}>‹ השיחות של {family.name}</RtlText></Pressable>
        <RtlText style={styles.subTitle}>{conversation.kind === 'direct' ? 'שיחה פרטית' : conversation.kind === 'group' ? 'שיחה קבוצתית' : 'שיחה משפחתית'}</RtlText>
        <RtlText style={styles.meta}>משתתפים: {conversation.participants.map((p) => p.name).join(', ') || 'לא ידועים'}</RtlText>
        {!reason ? <View style={styles.reasonBox}>
          <RtlText style={styles.reasonTitle}>לפני פתיחת תוכן השיחה</RtlText><RtlText style={styles.meta}>הצפייה תירשם ביומן הביקורת עם זהותך, המשפחה, השיחה והסיבה. גוף ההודעות לא נרשם ביומן.</RtlText>
          {REASONS.map((choice) => <Button key={choice.id} label={`פתיחה לצורך ${choice.label}`} onPress={() => void openContents(choice.id)} disabled={loading} />)}
        </View> : <>
          <Button label="טעינת הודעות ישנות" compact onPress={() => void loadOlder()} disabled={olderLoading || loading || messages.length === 0} />
          {olderLoading ? <ActivityIndicator color={colors.primary} accessibilityLabel="טוען הודעות ישנות" /> : null}
          {!loading && !messages.length ? <RtlText style={styles.meta}>השיחה ריקה או שאין הודעות זמינות.</RtlText> : null}
          {[...messages].reverse().map((message) => <View key={message.id} style={styles.message}>
            <RtlText style={styles.sender}>{message.sender_name || 'משתמש/ת שהוסר/ה'}</RtlText>
            <RtlText style={styles.meta}>{new Date(message.created_at).toLocaleString('he-IL')}</RtlText>
            <RtlText style={styles.body}>{message.deleted_at ? 'ההודעה נמחקה' : message.body || ''}</RtlText>
            {message.deleted_at ? null : message.attachment_mime?.startsWith('image/') ? attachmentUrls[message.id]
              ? <Image source={{ uri: attachmentUrls[message.id] }} style={styles.attachment} resizeMode="contain" accessibilityLabel="תמונה מצורפת לשיחה" />
              : <Button compact label="צפייה בתמונה המצורפת" onPress={() => void loadAttachment(message)} /> : null}
          </View>)}
        </>}
      </>}
    </>}
    {loading && conversation && !reason ? <ActivityIndicator color={colors.primary} accessibilityLabel="טוען שיחות" /> : null}
    {error ? <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</RtlText> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: { maxWidth: 1050, width: '100%', alignSelf: 'center', padding: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xxxl },
  title: { ...typography.screenTitle, textAlign: 'right', color: colors.textPrimary }, subTitle: { ...typography.cardTitle, textAlign: 'right', marginTop: spacing.md, color: colors.textPrimary },
  notice: { ...typography.body, textAlign: 'right', color: colors.textSecondary, backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }, input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, color: colors.textPrimary, backgroundColor: colors.surface },
  card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, gap: spacing.xs }, cardTitle: { ...typography.cardTitle, textAlign: 'right', color: colors.textPrimary }, meta: { ...typography.caption, textAlign: 'right', color: colors.textSecondary },
  back: { ...typography.body, color: colors.primaryDark, textAlign: 'right', fontWeight: '700', paddingVertical: spacing.sm }, reasonBox: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceMuted, borderRadius: radii.md }, reasonTitle: { ...typography.cardTitle, textAlign: 'right' },
  message: { padding: spacing.md, gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radii.md, borderColor: colors.border, borderWidth: 1 }, sender: { ...typography.body, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' }, body: { ...typography.body, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' }, attachment: { width: '100%', height: 260, borderRadius: radii.md }, error: { ...typography.body, color: colors.danger, textAlign: 'right' },
});
