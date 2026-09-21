import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RtlText } from '../components/RtlText';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { useAuthStore } from '../store/authStore';
import {
  getSystemAdminEmailDeliveryLog,
  getSystemAdminGlobalAudit,
  getSystemAdminFamilyDetail,
  listSystemAdminFamilies,
  setSystemAdminFamilyApproval,
  type SystemAdminEmailDeliveryLogEntry,
  type SystemAdminGlobalAuditEntry,
  type SystemAdminFamilyDetail,
  type SystemAdminFamilyListItem,
} from '../lib/systemAdmin';

interface SystemAdminScreenProps {
  visible: boolean;
  onClose: () => void;
}

/** Hebrew label for families.approval_status (0032/0035) — falls back to the raw value for any future status this screen doesn't know about yet, rather than hiding it. */
function approvalStatusLabel(status: string): string {
  if (status === 'active') return 'פעילה';
  if (status === 'pending') return 'ממתינה לאישור';
  if (status === 'rejected') return 'נדחתה';
  return status;
}

/** Hebrew label for email_delivery_log.message_type (0034). */
function emailMessageTypeLabel(type: string): string {
  if (type === 'family_welcome') return 'ברוכים הבאים למשפחה';
  if (type === 'system_owner_new_family') return 'התראת מנהל מערכת';
  return type;
}

/** Hebrew label for email_delivery_log.status (0034) — falls back to the raw value for any future provider status. */
function auditTargetLabel(targetType: string | null): string {
  const labels: Record<string, string> = {
    family: 'משפחה', families: 'משפחה',
    user: 'בן/בת משפחה', users: 'בן/בת משפחה',
    dog: 'כלב/ה', dogs: 'כלב/ה',
    walk: 'טיול', walks: 'טיול',
    schedule_rule: 'כלל תורנות', schedule_rules: 'כלל תורנות',
    schedule_entries: 'שיבוץ תורנות',
    walk_swap_requests: 'בקשת החלפת טיול',
    time_change_requests: 'בקשת שינוי שעה',
    member_permission_overrides: 'הרשאה',
    family_auth_members: 'הרשאת משפחה',
    profile_auth_sessions: 'חיבור פרופיל',
    notifications: 'התראה',
  };
  return targetType ? (labels[targetType] ?? 'רשומת מערכת') : 'מערכת';
}

function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    'family.created': 'יצירת משפחה',
    'family.approval_changed': 'שינוי סטטוס אישור משפחה',
    profile_claimed: 'חיבור פרופיל למכשיר',
    profile_edited: 'עריכת פרופיל בן/בת משפחה',
    family_member_removed: 'הסרת בן/בת משפחה',
    schedule_rule_created: 'יצירת תורנות',
    schedule_rule_edited: 'עריכת תורנות',
    schedule_rule_deleted: 'מחיקת תורנות',
    spontaneous_walk_added: 'הוספת טיול ספונטני',
    walk_completed: 'סיום טיול',
    system_admin_view_family_detail: 'צפייה של מנהל המערכת בפרטי משפחה',
    'system_observer.started': 'כניסת מנהל מערכת כצופה נסתר',
    'system_observer.ended': 'יציאת מנהל מערכת מצפייה נסתרת',
    'walks.insert': 'יצירת טיול',
    'walks.update': 'עדכון טיול',
    'walks.delete': 'מחיקת טיול',
    'schedule_rules.insert': 'יצירת כלל תורנות',
    'schedule_rules.update': 'עדכון כלל תורנות',
    'schedule_rules.delete': 'מחיקת כלל תורנות',
    'schedule_entries.insert': 'יצירת שיבוץ תורנות',
    'schedule_entries.update': 'עדכון שיבוץ תורנות',
    'schedule_entries.delete': 'מחיקת שיבוץ תורנות',
    'users.insert': 'הוספת בן/בת משפחה',
    'users.update': 'עדכון בן/בת משפחה',
    'users.delete': 'מחיקת בן/בת משפחה',
    'dogs.insert': 'הוספת כלב/ה',
    'dogs.update': 'עדכון פרטי כלב/ה',
    'dogs.delete': 'מחיקת כלב/ה',
    'walk_swap_requests.insert': 'יצירת בקשת החלפת טיול',
    'walk_swap_requests.update': 'עדכון בקשת החלפת טיול',
    'walk_swap_requests.delete': 'מחיקת בקשת החלפת טיול',
    'time_change_requests.insert': 'יצירת בקשת שינוי שעה',
    'time_change_requests.update': 'עדכון בקשת שינוי שעה',
    'time_change_requests.delete': 'מחיקת בקשת שינוי שעה',
    'member_permission_overrides.insert': 'שינוי הרשאת משתמש',
    'member_permission_overrides.update': 'עדכון הרשאת משתמש',
    'member_permission_overrides.delete': 'איפוס הרשאת משתמש',
    'family_auth_members.insert': 'הוספת הרשאת משפחה',
    'family_auth_members.update': 'עדכון הרשאת משפחה',
    'family_auth_members.delete': 'הסרת הרשאת משפחה',
    'profile_auth_sessions.insert': 'חיבור מכשיר לפרופיל',
    'profile_auth_sessions.update': 'עדכון חיבור מכשיר לפרופיל',
    'profile_auth_sessions.delete': 'ניתוק מכשיר מפרופיל',
    'notifications.insert': 'יצירת התראה',
    'notifications.update': 'עדכון התראה',
    'notifications.delete': 'מחיקת התראה',
  };
  if (labels[action]) return labels[action];
  const match = action.match(/^(.+)\.(insert|update|delete)$/);
  if (match) {
    const target = auditTargetLabel(match[1]);
    const verb = match[2] === 'insert' ? 'יצירת' : match[2] === 'update' ? 'עדכון' : 'מחיקת';
    return `${verb} ${target}`;
  }
  return 'פעולת מערכת';
}

function auditBoolean(value: unknown): string {
  return value === true ? 'כן' : value === false ? 'לא' : String(value ?? '—');
}

function auditFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    name: 'שם', date: 'תאריך', time: 'שעה', scheduled_time: 'שעה מתוכננת',
    status: 'סטטוס', role: 'תפקיד', label: 'תיאור', notes: 'הערות',
    walks_per_day: 'מספר טיולים ביום', had_pee: 'פיפי', had_poop: 'קקי',
    approval_status: 'סטטוס אישור', photo_url: 'תמונה', responsible_user_id: 'אחראי',
    completed_by_user_id: 'בוצע על ידי', proposed_time: 'שעה מוצעת',
  };
  return labels[field] ?? 'פרט נוסף';
}

function auditValue(field: string, value: unknown): string {
  if (field === 'photo_url') return value ? 'עודכנה' : 'הוסרה';
  if (typeof value === 'boolean') return auditBoolean(value);
  if (value === null || value === undefined || value === '') return 'ללא';
  return String(value);
}

function auditMetadataLines(entry: SystemAdminGlobalAuditEntry): string[] {
  const m = entry.metadata ?? {};
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== '') lines.push(`${label}: ${String(value)}`);
  };

  add('תאריך הטיול', m.date);
  add('שעת הטיול', m.time);
  add('אחראי לטיול', m.responsible_user_name);
  add('הטיול הושלם על ידי', m.completed_by_user_name);
  add('משתמש יעד', m.target_user_name);
  if ('had_pee' in m) lines.push(`פיפי: ${auditBoolean(m.had_pee)}`);
  if ('had_poop' in m) lines.push(`קקי: ${auditBoolean(m.had_poop)}`);
  if ('approval_status' in m) add('סטטוס אישור', approvalStatusLabel(String(m.approval_status)));
  if ('multi_device' in m) lines.push(`חיבור ממספר מכשירים: ${auditBoolean(m.multi_device)}`);
  if ('read_only' in m) lines.push(`מצב קריאה בלבד: ${auditBoolean(m.read_only)}`);
  if ('hidden_from_family' in m) lines.push(`נסתר מבני המשפחה: ${auditBoolean(m.hidden_from_family)}`);

  const changedFields = Array.isArray(m.changed_fields) ? m.changed_fields.filter((v): v is string => typeof v === 'string') : [];
  const after = m.after && typeof m.after === 'object' && !Array.isArray(m.after) ? m.after as Record<string, unknown> : null;
  if (changedFields.length) {
    lines.push(`שדות ששונו: ${changedFields.map(auditFieldLabel).join(', ')}`);
    if (after) {
      changedFields
        .filter((field) => ['name','date','time','scheduled_time','status','role','label','notes','walks_per_day','had_pee','had_poop','approval_status','photo_url','proposed_time'].includes(field))
        .forEach((field) => lines.push(`${auditFieldLabel(field)} לאחר השינוי: ${auditValue(field, after[field])}`));
    }
  }

  return lines;
}

function emailStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: 'בתור',
    sent: 'נשלח',
    failed: 'נכשל',
    delivered: 'נמסר',
    bounced: 'הוחזר',
    complained: 'תלונת דואר זבל',
    opened: 'נפתח',
    clicked: 'נלחץ',
  };
  return labels[status] ?? status;
}

/**
 * BATCH 4 (item A) — "🛡️ ניהול מערכת", System Admin V1 (read-only).
 *
 * Deliberately a plain Modal with local component state (list <-> detail),
 * not a new navigation stack — this repo has no @react-navigation/
 * native-stack (or equivalent) dependency, and several existing flows
 * (FamilyOnboardingScreen, every "Modal" component in components/) already
 * use exactly this pattern, so this introduces no new dependency.
 *
 * SECURITY NOTE this component leans on: rendering here at all already
 * required useSystemAdminStore().isSystemAdmin to be true (App.tsx only
 * mounts this when that's the case), but that is UI convenience only —
 * every RPC this screen calls (lib/systemAdmin.ts -> migration 0029)
 * re-checks is_system_admin() server-side on every call. This screen never
 * reads or writes authStore's familyId/currentUserId — opening a family
 * here cannot change the device's own active family or create membership,
 * by construction (there is no code path here that touches those stores).
 */
export function SystemAdminScreen({ visible, onClose }: SystemAdminScreenProps) {
  const [search, setSearch] = useState('');
  const beginSystemObserver = useAuthStore((s) => s.beginSystemObserver);
  const [observerStartingFamilyId, setObserverStartingFamilyId] = useState<string | null>(null);
  const [observerError, setObserverError] = useState<string | null>(null);
  const [families, setFamilies] = useState<SystemAdminFamilyListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SystemAdminFamilyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [approvalActionLoading, setApprovalActionLoading] = useState(false);
  const [approvalActionError, setApprovalActionError] = useState<string | null>(null);

  const [emailLogVisible, setEmailLogVisible] = useState(false);
  const [emailLog, setEmailLog] = useState<SystemAdminEmailDeliveryLogEntry[]>([]);
  const [emailLogLoading, setEmailLogLoading] = useState(false);
  const [emailLogError, setEmailLogError] = useState<string | null>(null);

  const [auditVisible, setAuditVisible] = useState(false);
  const [auditLog, setAuditLog] = useState<SystemAdminGlobalAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditFamilyId, setAuditFamilyId] = useState<string | null>(null);

  const overview = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    return {
      totalFamilies: families.length,
      activeFamilies: families.filter((f) => f.status === 'active').length,
      pendingFamilies: families.filter((f) => f.status === 'pending').length,
      rejectedFamilies: families.filter((f) => f.status === 'rejected').length,
      members: families.reduce((sum, f) => sum + f.memberCount, 0),
      dogs: families.filter((f) => Boolean(f.dogName)).length,
      newThisWeek: families.filter((f) => new Date(f.createdAt).getTime() >= sevenDaysAgo).length,
      emailFailures: emailLog.filter((e) => e.status === 'failed' || e.status === 'bounced').length,
    };
  }, [families, emailLog]);

  const selectedFamily = useMemo(
    () => families.find((family) => family.familyId === selectedFamilyId) ?? null,
    [families, selectedFamilyId]
  );

  const detailOverview = useMemo(() => {
    if (!detail) return null;
    const activeMembers = detail.members.filter((m) => !m.removedAt);
    return {
      activeMembers: activeMembers.length,
      admins: activeMembers.filter((m) => m.role === 'admin').length,
      claimed: activeMembers.filter((m) => m.claimed).length,
      completedWalks: detail.walks.filter((w) => w.status === 'done').length,
      pendingWalks: detail.walks.filter((w) => w.status === 'pending').length,
      spontaneousWalks: detail.walks.filter((w) => w.isUnplanned).length,
    };
  }, [detail]);

  const loadFamilies = useCallback(async (query?: string) => {
    setListLoading(true);
    setListError(null);
    try {
      const result = await listSystemAdminFamilies(query);
      setFamilies(result);
    } catch (e) {
      setListError(friendlyErrorMessage(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setSelectedFamilyId(null);
      setDetail(null);
      setEmailLogVisible(false);
      setAuditVisible(false);
      void loadFamilies();
      void getSystemAdminEmailDeliveryLog().then(setEmailLog).catch(() => {
        // Overview email health is supplementary; the dedicated log keeps
        // its own visible error state when opened.
      });
    }
  }, [visible, loadFamilies]);

  const loadAuditLog = async (familyId: string | null) => {
    setAuditFamilyId(familyId);
    setAuditLoading(true);
    setAuditError(null);
    try {
      const result = await getSystemAdminGlobalAudit(500, familyId);
      setAuditLog(result);
    } catch (e) {
      setAuditError(friendlyErrorMessage(e));
    } finally {
      setAuditLoading(false);
    }
  };

  const openAuditLog = async () => {
    setAuditVisible(true);
    await loadAuditLog(null);
  };

  const openEmailLog = async () => {
    setEmailLogVisible(true);
    setEmailLogLoading(true);
    setEmailLogError(null);
    try {
      const result = await getSystemAdminEmailDeliveryLog();
      setEmailLog(result);
    } catch (e) {
      setEmailLogError(friendlyErrorMessage(e));
    } finally {
      setEmailLogLoading(false);
    }
  };

  const openFamily = async (familyId: string) => {
    setSelectedFamilyId(familyId);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    setApprovalActionError(null);
    try {
      const result = await getSystemAdminFamilyDetail(familyId);
      setDetail(result);
    } catch (e) {
      setDetailError(friendlyErrorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const backToList = () => {
    setSelectedFamilyId(null);
    setDetail(null);
    setDetailError(null);
    setApprovalActionError(null);
  };

  const openHiddenObserver = async (familyId: string) => {
    setObserverStartingFamilyId(familyId);
    setObserverError(null);
    try {
      await beginSystemObserver(familyId);
      onClose();
    } catch (e) {
      setObserverError(friendlyErrorMessage(e, [], 'לא הצלחנו להיכנס לצפייה נסתרת'));
    } finally {
      setObserverStartingFamilyId(null);
    }
  };

  const handleSetApproval = async (approvalStatus: 'active' | 'rejected') => {
    if (!selectedFamilyId) return;
    setApprovalActionLoading(true);
    setApprovalActionError(null);
    try {
      await setSystemAdminFamilyApproval(selectedFamilyId, approvalStatus);
      await openFamily(selectedFamilyId);
      await loadFamilies(search);
    } catch (e) {
      setApprovalActionError(friendlyErrorMessage(e));
    } finally {
      setApprovalActionLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <RtlText style={styles.title} accessibilityRole="header">🛡️ ניהול מערכת</RtlText>
          <View style={styles.headerActions}>
            {!selectedFamilyId && !emailLogVisible && !auditVisible ? (
              <>
                <Pressable onPress={openAuditLog} accessibilityRole="button" accessibilityLabel="פתיחת Audit Trail" hitSlop={10}>
                  <RtlText style={styles.headerLink}>יומן פעילות</RtlText>
                </Pressable>
                <Pressable onPress={openEmailLog} accessibilityRole="button" accessibilityLabel="פתיחת יומן משלוח אימיילים" hitSlop={10}>
                <RtlText style={styles.headerLink}>יומן אימיילים</RtlText>
                </Pressable>
              </>
            ) : null}
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת ניהול מערכת" hitSlop={10}>
              <RtlText style={styles.closeLink}>סגירה</RtlText>
            </Pressable>
          </View>
        </View>

        {auditVisible ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setAuditVisible(false)} accessibilityRole="button" accessibilityLabel="חזרה לרשימת המשפחות">
              <RtlText style={styles.backLink}>‹ חזרה לרשימה</RtlText>
            </Pressable>
            <RtlText style={styles.sectionTitle}>יומן פעילות מערכת ({auditLog.length})</RtlText>
            <RtlText style={styles.auditHint}>כל פעולה נשמרת עם המשפחה, המשתמש, הזמן ופרטי השינוי. ניתן לסנן לפי משפחה.</RtlText>
            <RtlText style={styles.filterTitle}>סינון לפי משפחה</RtlText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.auditFilters}>
              <Pressable
                onPress={() => void loadAuditLog(null)}
                style={[styles.auditFilterChip, auditFamilyId === null && styles.auditFilterChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: auditFamilyId === null }}
              >
                <RtlText style={[styles.auditFilterText, auditFamilyId === null && styles.auditFilterTextActive]}>כל המשפחות</RtlText>
              </Pressable>
              {families.map((family) => (
                <Pressable
                  key={family.familyId}
                  onPress={() => void loadAuditLog(family.familyId)}
                  style={[styles.auditFilterChip, auditFamilyId === family.familyId && styles.auditFilterChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: auditFamilyId === family.familyId }}
                >
                  <RtlText style={[styles.auditFilterText, auditFamilyId === family.familyId && styles.auditFilterTextActive]}>{family.familyName}</RtlText>
                </Pressable>
              ))}
            </ScrollView>
            {auditLoading ? <ActivityIndicator color={colors.primary} style={styles.spinner} accessibilityLabel="טוען…" /> : null}
            {auditError ? <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{auditError}</RtlText> : null}
            {!auditLoading && auditLog.length === 0 ? <RtlText style={styles.cardLine}>לא נמצאו פעולות</RtlText> : null}
            {auditLog.map((entry) => {
              const detailLines = auditMetadataLines(entry);
              return (
                <View key={`${entry.source}-${entry.id}`} style={styles.auditCard}>
                  <RtlText style={styles.auditAction}>{auditActionLabel(entry.action)}</RtlText>
                  <RtlText style={styles.auditTime}>{new Date(entry.createdAt).toLocaleString('he-IL')}</RtlText>
                  <RtlText style={styles.cardLine}>משפחה: {entry.familyName ?? 'פעולת מערכת כללית'}</RtlText>
                  <RtlText style={styles.cardLine}>בוצע על ידי: {entry.actorName ?? 'מנהל מערכת / תהליך מערכת'}</RtlText>
                  {entry.actorEmail ? <RtlText style={styles.cardLine}>אימייל: {entry.actorEmail}</RtlText> : null}
                  <RtlText style={styles.cardLine}>סוג רשומה: {auditTargetLabel(entry.targetType)}</RtlText>
                  {detailLines.map((line, index) => (
                    <RtlText key={`${entry.id}-detail-${index}`} style={styles.auditDetail}>• {line}</RtlText>
                  ))}
                  {entry.targetId ? <RtlText style={styles.auditTechnical}>מזהה רשומה: {entry.targetId}</RtlText> : null}
                </View>
              );
            })}
          </ScrollView>
        ) : emailLogVisible ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable
              onPress={() => setEmailLogVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="חזרה לרשימת המשפחות"
            >
              <RtlText style={styles.backLink}>‹ חזרה לרשימה</RtlText>
            </Pressable>

            {emailLogLoading ? <ActivityIndicator color={colors.primary} style={styles.spinner} accessibilityLabel="טוען…" /> : null}
            {emailLogError ? (
              <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {emailLogError}
              </RtlText>
            ) : null}

            <RtlText style={styles.sectionTitle}>יומן משלוח אימיילים ({emailLog.length})</RtlText>
            <View style={styles.card}>
              {!emailLogLoading && emailLog.length === 0 ? (
                <RtlText style={styles.cardLine}>אין רשומות</RtlText>
              ) : (
                emailLog.map((e) => (
                  <RtlText key={e.id} style={styles.cardLine}>
                    {new Date(e.createdAt).toLocaleString('he-IL')} · {emailMessageTypeLabel(e.messageType)} ·{' '}
                    {e.recipientEmail} · {emailStatusLabel(e.status)}
                    {e.error ? ` · שגיאה: ${e.error}` : ''}
                  </RtlText>
                ))
              )}
            </View>
          </ScrollView>
        ) : selectedFamilyId ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={backToList} accessibilityRole="button" accessibilityLabel="חזרה לרשימת המשפחות">
              <RtlText style={styles.backLink}>‹ חזרה לרשימה</RtlText>
            </Pressable>

            {detailLoading ? <ActivityIndicator color={colors.primary} style={styles.spinner} accessibilityLabel="טוען…" /> : null}
            {detailError ? (
              <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {detailError}
              </RtlText>
            ) : null}

            {detail ? (
              <View>
                {detailOverview ? (
                  <>
                    <RtlText style={styles.sectionTitle}>תמונת מצב</RtlText>
                    <View style={styles.metricsGrid}>
                      <View style={styles.metricCard}><RtlText style={styles.metricValue}>{detailOverview.activeMembers}</RtlText><RtlText style={styles.metricLabel}>חברים פעילים</RtlText></View>
                      <View style={styles.metricCard}><RtlText style={styles.metricValue}>{detailOverview.admins}</RtlText><RtlText style={styles.metricLabel}>מנהלים</RtlText></View>
                      <View style={styles.metricCard}><RtlText style={styles.metricValue}>{detailOverview.claimed}</RtlText><RtlText style={styles.metricLabel}>פרופילים מחוברים</RtlText></View>
                      <View style={styles.metricCard}><RtlText style={styles.metricValue}>{detailOverview.completedWalks}</RtlText><RtlText style={styles.metricLabel}>טיולים שבוצעו</RtlText></View>
                      <View style={styles.metricCard}><RtlText style={styles.metricValue}>{detailOverview.pendingWalks}</RtlText><RtlText style={styles.metricLabel}>טיולים ממתינים</RtlText></View>
                      <View style={styles.metricCard}><RtlText style={styles.metricValue}>{detailOverview.spontaneousWalks}</RtlText><RtlText style={styles.metricLabel}>טיולים ספונטניים</RtlText></View>
                    </View>
                  </>
                ) : null}

                <RtlText style={styles.sectionTitle}>משפחה</RtlText>
                {observerError ? <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{observerError}</RtlText> : null}
                <View style={styles.card}>
                  <RtlText style={styles.cardLine}>שם: {detail.family?.name ?? '—'}</RtlText>
                  <RtlText style={styles.cardLine}>קוד הצטרפות: {detail.family?.inviteCode ?? '—'}</RtlText>
                  <RtlText style={styles.cardLine}>אימייל שאומת ביצירת המשפחה: {selectedFamily?.verifiedEmail ?? '—'}</RtlText>
                  <RtlText style={styles.cardLine}>
                    נוצרה: {detail.family?.createdAt ? new Date(detail.family.createdAt).toLocaleDateString('he-IL') : '—'}
                  </RtlText>
                  <RtlText style={styles.cardLine}>
                    סטטוס אישור: {detail.family?.approvalStatus ? approvalStatusLabel(detail.family.approvalStatus) : '—'}
                  </RtlText>
                  {detail.family ? (
                    <View style={styles.observerAction}>
                      <Button
                        label={observerStartingFamilyId === detail.family.id ? 'נכנס לצפייה…' : 'כניסה כצופה נסתר'}
                        onPress={() => openHiddenObserver(detail.family!.id)}
                        disabled={observerStartingFamilyId !== null}
                        compact
                      />
                      <RtlText style={styles.observerHint}>מציג את כל המסכים וההגדרות כמנהל המשפחה, ללא אפשרות לשנות נתונים וללא נוכחות גלויה למשפחה.</RtlText>
                    </View>
                  ) : null}
                  {detail.family && detail.family.approvalStatus !== 'active' ? (
                    <View style={styles.approvalActions}>
                      {approvalActionError ? (
                        <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                          {approvalActionError}
                        </RtlText>
                      ) : null}
                      {approvalActionLoading ? (
                        <ActivityIndicator color={colors.primary} style={styles.spinner} accessibilityLabel="טוען…" />
                      ) : (
                        <>
                          <Button
                            label="אישור המשפחה"
                            onPress={() => handleSetApproval('active')}
                            compact
                          />
                          {detail.family.approvalStatus === 'pending' ? (
                            <Button
                              label="דחיית הבקשה"
                              onPress={() => handleSetApproval('rejected')}
                              variant="danger"
                              compact
                              accessibilityHint="הפעולה תעדכן מיידית את סטטוס המשפחה לנדחתה, ללא אישור נוסף"
                            />
                          ) : null}
                        </>
                      )}
                    </View>
                  ) : null}
                </View>

                <RtlText style={styles.sectionTitle}>כלב/ה</RtlText>
                <View style={styles.card}>
                  {detail.dog ? (
                    <>
                      <RtlText style={styles.cardLine}>שם: {detail.dog.name}</RtlText>
                      <RtlText style={styles.cardLine}>
                        מין: {detail.dog.sex === 'male' ? 'זכר' : detail.dog.sex === 'female' ? 'נקבה' : 'לא מוגדר'}
                      </RtlText>
                      <RtlText style={styles.cardLine}>טיולים ביום: {detail.dog.walksPerDay}</RtlText>
                    </>
                  ) : (
                    <RtlText style={styles.cardLine}>אין כלב/ה רשום/ה</RtlText>
                  )}
                </View>

                <RtlText style={styles.sectionTitle}>בני משפחה ({detail.members.length})</RtlText>
                <View style={styles.card}>
                  {detail.members.length === 0 ? (
                    <RtlText style={styles.cardLine}>אין בני משפחה</RtlText>
                  ) : (
                    detail.members.map((m) => (
                      <RtlText key={m.id} style={styles.cardLine}>
                        {m.avatar} {m.name} · {m.role === 'admin' ? 'מנהל/ת' : 'בן/בת משפחה'}
                        {m.removedAt ? ' · הוסר/ה' : ''}
                        {!m.claimed ? ' · לא נתבע' : ''}
                      </RtlText>
                    ))
                  )}
                </View>

                <RtlText style={styles.sectionTitle}>בקשות פעילות ({detail.activeRequests.length})</RtlText>
                <View style={styles.card}>
                  {detail.activeRequests.length === 0 ? (
                    <RtlText style={styles.cardLine}>אין בקשות ממתינות</RtlText>
                  ) : (
                    detail.activeRequests.map((r) => (
                      <RtlText key={`${r.kind}-${r.id}`} style={styles.cardLine}>
                        {r.kind === 'swap' ? 'בקשת החלפה' : 'בקשת שינוי שעה'} · טיול {r.walkId.slice(0, 8)}
                      </RtlText>
                    ))
                  )}
                </View>

                <RtlText style={styles.sectionTitle}>טיולים אחרונים ({detail.walks.length})</RtlText>
                <View style={styles.card}>
                  {detail.walks.slice(0, 10).map((w) => (
                    <RtlText key={w.id} style={styles.cardLine}>
                      {w.date} · {w.scheduledTime} · {w.status === 'done' ? 'בוצע' : w.status === 'skipped' ? 'לא בוצע' : 'ממתין'}
                    </RtlText>
                  ))}
                </View>

                <RtlText style={styles.sectionTitle}>יומן ביקורת ({detail.recentAudit.length})</RtlText>
                <View style={styles.card}>
                  {detail.recentAudit.length === 0 ? (
                    <RtlText style={styles.cardLine}>אין רשומות</RtlText>
                  ) : (
                    detail.recentAudit.slice(0, 15).map((a) => (
                      <RtlText key={a.id} style={styles.cardLine}>
                        {new Date(a.createdAt).toLocaleString('he-IL')} · {a.action}
                      </RtlText>
                    ))
                  )}
                </View>
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <View style={styles.flex}>
            <View style={styles.searchRow}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                onSubmitEditing={() => loadFamilies(search)}
                placeholder="חיפוש לפי שם משפחה, קוד, או שם משתמש"
                placeholderTextColor={colors.textSecondary}
                style={styles.searchInput}
                textAlign="right"
                returnKeyType="search"
                accessibilityLabel="חיפוש לפי שם משפחה, קוד, או שם משתמש"
              />
              <Button label="חיפוש" onPress={() => loadFamilies(search)} compact />
            </View>

            {listLoading ? <ActivityIndicator color={colors.primary} style={styles.spinner} accessibilityLabel="טוען…" /> : null}
            {listError ? (
              <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {listError}
              </RtlText>
            ) : null}

            <ScrollView contentContainerStyle={styles.content}>
              <RtlText style={styles.sectionTitle}>תמונת מצב מערכתית</RtlText>
              <View style={styles.metricsGrid}>
                <View style={styles.metricCard}><RtlText style={styles.metricValue}>{overview.totalFamilies}</RtlText><RtlText style={styles.metricLabel}>משפחות</RtlText></View>
                <View style={styles.metricCard}><RtlText style={styles.metricValue}>{overview.activeFamilies}</RtlText><RtlText style={styles.metricLabel}>פעילות</RtlText></View>
                <View style={styles.metricCard}><RtlText style={styles.metricValue}>{overview.pendingFamilies}</RtlText><RtlText style={styles.metricLabel}>ממתינות לאישור</RtlText></View>
                <View style={styles.metricCard}><RtlText style={styles.metricValue}>{overview.members}</RtlText><RtlText style={styles.metricLabel}>בני משפחה</RtlText></View>
                <View style={styles.metricCard}><RtlText style={styles.metricValue}>{overview.dogs}</RtlText><RtlText style={styles.metricLabel}>כלבים רשומים</RtlText></View>
                <View style={styles.metricCard}><RtlText style={styles.metricValue}>{overview.newThisWeek}</RtlText><RtlText style={styles.metricLabel}>חדשות השבוע</RtlText></View>
              </View>
              <View style={styles.healthCard}>
                <RtlText style={styles.healthTitle}>בריאות תפעולית</RtlText>
                <RtlText style={styles.healthLine}>משפחות שנדחו: {overview.rejectedFamilies}</RtlText>
                <RtlText style={styles.healthLine}>כשלים/החזרות ביומן האימיילים האחרון: {overview.emailFailures}</RtlText>
              </View>

              <RtlText style={styles.sectionTitle}>משפחות ({families.length})</RtlText>
              {!listLoading && families.length === 0 ? <RtlText style={styles.cardLine}>לא נמצאו משפחות</RtlText> : null}
              {families.map((f) => (
                <Pressable
                  key={f.familyId}
                  onPress={() => openFamily(f.familyId)}
                  style={styles.familyRow}
                  accessibilityRole="button"
                  accessibilityLabel={`פתיחת פרטי משפחת ${f.familyName}, קוד ${f.inviteCode}`}
                >
                  <View style={styles.familyTitleRow}>
                    <RtlText style={styles.familyName}>{f.familyName}</RtlText>
                    <RtlText style={styles.statusBadge}>{approvalStatusLabel(f.status)}</RtlText>
                  </View>
                  <RtlText style={styles.familyMeta}>
                    קוד: {f.inviteCode} · {f.memberCount} בני משפחה
                    {f.dogName ? ` · ${f.dogName}` : ''}
                  </RtlText>
                  <RtlText style={styles.familyMeta}>
                    מנהלים: {f.adminNames.length > 0 ? f.adminNames.join(', ') : '—'} · נוצרה{' '}
                    {new Date(f.createdAt).toLocaleDateString('he-IL')}
                  </RtlText>
                  <RtlText style={styles.familyMeta}>אימייל מאומת: {f.verifiedEmail ?? '—'}</RtlText>
                  <RtlText style={styles.familyMeta}>סטטוס: {approvalStatusLabel(f.status)}</RtlText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.screenTitle, fontSize: 20, color: colors.textPrimary },
  headerActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.lg },
  headerLink: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
  closeLink: { color: colors.primaryDark, fontWeight: '700', fontSize: 15 },
  backLink: { color: colors.primaryDark, fontWeight: '700', fontSize: 14, marginBottom: spacing.md },
  content: { padding: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xxxl },
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.md, alignItems: 'center' },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.md,
    fontSize: 14,
    color: colors.textPrimary,
  },
  spinner: { marginTop: spacing.lg },
  error: { ...typography.meta, fontWeight: '600', color: colors.statusOverdue, textAlign: 'right', marginHorizontal: spacing.xl, marginTop: spacing.sm },
  familyRow: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  familyTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  familyName: { ...typography.body, fontWeight: '800', color: colors.textPrimary, textAlign: 'right', flexShrink: 1 },
  statusBadge: { ...typography.caption, fontSize: 10, fontWeight: '800', color: colors.primaryDark, backgroundColor: colors.surfaceMuted, borderRadius: radii.round, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  familyMeta: { ...typography.caption, fontSize: 12, fontWeight: '500', color: colors.textSecondary, textAlign: 'right' },
  sectionTitle: { ...typography.cardTitle, fontWeight: '800', color: colors.textPrimary, textAlign: 'right', marginTop: spacing.md, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  observerAction: { gap: spacing.xs, marginTop: spacing.sm, alignItems: 'flex-end' },
  observerHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  approvalActions: { flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  cardLine: { ...typography.meta, color: colors.textPrimary, textAlign: 'right' },
  metricsGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm },
  metricCard: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 96,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  metricValue: { ...typography.statValue, fontSize: 24, color: colors.textPrimary, writingDirection: 'ltr' },
  metricLabel: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', writingDirection: 'rtl' },
  healthCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  healthTitle: { ...typography.cardTitle, color: colors.textPrimary, textAlign: 'right' },
  healthLine: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  auditHint: { ...typography.meta, color: colors.textSecondary, textAlign: 'right', marginBottom: spacing.sm },
  filterTitle: { ...typography.meta, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  auditFilters: { gap: spacing.sm, paddingVertical: spacing.sm, flexDirection: 'row-reverse' },
  auditFilterChip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  auditFilterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  auditFilterText: { ...typography.meta, color: colors.textPrimary },
  auditFilterTextActive: { color: colors.surface, fontWeight: '800' },
  auditCard: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  auditAction: { ...typography.body, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  auditTime: { ...typography.meta, color: colors.primaryDark, fontWeight: '700', textAlign: 'right' },
  auditDetail: { ...typography.meta, color: colors.textPrimary, textAlign: 'right', lineHeight: 21 },
  auditTechnical: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
});
