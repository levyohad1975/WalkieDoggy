import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { repository } from '../data';
import type { DuplicateActiveWalkReviewRecord } from '../data/repository';
import {
  completeWalkLifecycleOperation,
  getExistingWalkLifecycleOperationId,
  getWalkLifecycleOperationId,
} from '../data/walkLifecycleOperationIds';
import {
  canOpenDuplicateResolution,
  CONFIRMED_STAGING_DUPLICATE_WALK_IDS,
  getDuplicateResolutionErrorKind,
  getDuplicateResolutionErrorMessage,
  getDuplicateResolutionReviewErrorMessage,
  getDuplicateResolutionReadiness,
  TEST_DUPLICATE_RESOLUTION_RATIONALE,
} from '../logic/duplicateWalkResolution';
import { isSupabaseConfigured, isWalkResolutionStaging } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useFamilyStore } from '../store/familyStore';
import { colors } from '../theme/colors';
import { RtlText } from './RtlText';

const ACTION = 'resolve_duplicates' as const;

function formatTimestamp(value: string | undefined, timeZone: string): string {
  if (!value) return 'לא נשמר';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return `${new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date)} (${value})`;
  } catch {
    return value;
  }
}

function roleStatus(status: string): string {
  if (status === 'in_progress') return 'פעיל';
  if (status === 'done') return 'הסתיים';
  if (status === 'skipped') return 'דולג';
  return status;
}

function auditDetails(metadata: Record<string, unknown>): string {
  const details = [
    typeof metadata.date === 'string' ? `תאריך ${metadata.date}` : null,
    typeof metadata.time === 'string' ? `שעה ${metadata.time}` : null,
    typeof metadata.responsible_user_id === 'string' ? `אחראי/ת ${metadata.responsible_user_id}` : null,
  ].filter((value): value is string => Boolean(value));
  return details.join(' · ') || 'ללא פרטים נוספים';
}

export function StagingDuplicateWalkResolutionPanel() {
  const familyId = useAuthStore((state) => state.familyId);
  const profileId = useAuthStore((state) => state.currentUserId);
  const familyRole = useAuthStore((state) => state.familyRole);
  const impersonating = useAuthStore((state) => Boolean(state.impersonatingUserId));
  const systemObserver = useAuthStore((state) => state.systemObserverActive);
  const testMode = useAuthStore((state) => Boolean(state.testModeUserId));
  const authFamilyTimezone = useFamilyStore((state) => state.family?.timezone) ?? 'UTC';
  const allowed = canOpenDuplicateResolution({
    staging: isWalkResolutionStaging,
    configured: isSupabaseConfigured,
    familyId,
    profileId,
    familyRole,
    impersonating,
    systemObserver,
    testMode,
  });

  const [records, setRecords] = useState<DuplicateActiveWalkReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [outcomeUncertain, setOutcomeUncertain] = useState(false);
  const [retryOperationExists, setRetryOperationExists] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolvedGroupId, setResolvedGroupId] = useState('');
  const busyRef = useRef(false);

  const operationScope = useMemo(() => {
    if (!familyId) return '';
    return `${familyId}:${[...CONFIRMED_STAGING_DUPLICATE_WALK_IDS].sort().join(',')}`;
  }, [familyId]);

  const refresh = useCallback(async () => {
    if (!allowed || !familyId || !profileId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      if (!repository.getDuplicateActiveWalkReview) throw new Error('Staging duplicate review is not configured');
      const [reviewRecords, existingId] = await Promise.all([
        repository.getDuplicateActiveWalkReview(familyId, [...CONFIRMED_STAGING_DUPLICATE_WALK_IDS]),
        getExistingWalkLifecycleOperationId(ACTION, operationScope, profileId),
      ]);
      setRecords(reviewRecords);
      setRetryOperationExists(Boolean(existingId));
    } catch (error) {
      setRecords([]);
      setLoadError(getDuplicateResolutionReviewErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [allowed, familyId, profileId, operationScope]);

  useEffect(() => { void refresh(); }, [refresh]);

  const byId = useMemo(() => new Map(records.map((record) => [record.walkId, record])), [records]);
  const readiness = familyId ? getDuplicateResolutionReadiness(records, familyId) : 'missing_records';
  const mayRetrySameOperation = retryOperationExists && readiness !== 'ready';
  const mayStartOrRetry = readiness === 'ready' || mayRetrySameOperation;

  const submitResolution = useCallback(async () => {
    if (busyRef.current || !checked || !allowed || !familyId || !profileId || !mayStartOrRetry) return;
    busyRef.current = true;
    setBusy(true);
    setActionError('');
    setOutcomeUncertain(false);
    try {
      // The same exact request scope and actor always reuse the persisted UUID.
      // Persistence failure blocks the RPC so a later retry cannot silently
      // acquire a different operation id.
      const operationId = await getWalkLifecycleOperationId(ACTION, operationScope, profileId);
      if (!repository.resolveDuplicateActiveWalksV12) throw new Error('Staging duplicate resolution RPC is not configured');
      const groupId = await repository.resolveDuplicateActiveWalksV12({
        walkIds: [...CONFIRMED_STAGING_DUPLICATE_WALK_IDS],
        canonicalWalkId: null,
        rationale: TEST_DUPLICATE_RESOLUTION_RATIONALE,
        operationId,
      });
      setResolvedGroupId(groupId);
      await completeWalkLifecycleOperation(ACTION, operationScope, profileId);
      setRetryOperationExists(false);
      setConfirmVisible(false);
      setChecked(false);
      await refresh();
    } catch (error) {
      const errorKind = getDuplicateResolutionErrorKind(error);
      setOutcomeUncertain(errorKind === 'network' && !/no resolution request was sent/i.test(String((error as { message?: string })?.message ?? error)));
      setActionError(getDuplicateResolutionErrorMessage(error));
      // Do not clear the persisted operation UUID on any failure. If the
      // database committed but the response was lost, the explicit retry is
      // resolved by the server's idempotency record.
      setRetryOperationExists(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [allowed, familyId, profileId, checked, mayStartOrRetry, operationScope, refresh]);

  if (!allowed) return null;

  const readinessLabel = readiness === 'ready'
    ? 'שלוש הרשומות הפעילות אומתו מאותו כלב ובאותה משפחה.'
    : readiness === 'missing_records'
      ? 'לא ניתן לאמת כעת את כל שלוש הרשומות במשפחה הפעילה.'
      : readiness === 'already_resolved'
        ? 'לפחות אחת מהרשומות כבר אינה פתיחה פעילה לא פתורה.'
        : 'הרשומות אינן שייכות לאותו כלב; הפעולה חסומה.';

  return (
    <View style={styles.panel}>
      <RtlText style={styles.title} accessibilityRole="header">פתיחות בדיקה כפולות · Staging</RtlText>
      <RtlText style={styles.body}>כלי מוגבל למנהל/ת משפחה בסביבת Supabase Staging המאושרת. הרשומות המקוריות ונתוני ה-GPS נשמרים.</RtlText>

      {loading ? <ActivityIndicator accessibilityLabel="טוען נתוני בדיקה מהשרת" color={colors.primary} /> : null}
      {loadError ? (
        <View style={styles.messageBox}>
          <RtlText style={styles.errorText}>{loadError}</RtlText>
          <ActionButton title="בדיקה מחדש" onPress={() => void refresh()} disabled={loading} />
        </View>
      ) : null}

      {!loading && !loadError ? (
        <>
          <RtlText style={styles.statusText}>{readinessLabel}</RtlText>
          {CONFIRMED_STAGING_DUPLICATE_WALK_IDS.map((walkId) => {
            const record = byId.get(walkId);
            return (
              <View key={walkId} style={styles.record}>
                <RtlText style={styles.recordHeading}>טיול {walkId}</RtlText>
                {record ? (
                  <>
                    <RtlText style={styles.detail}>משפחה: {record.familyId} · כלב: {record.dogId} · סטטוס: {roleStatus(record.status)}</RtlText>
                    <RtlText style={styles.detail}>התחלה: {formatTimestamp(record.startedAt, authFamilyTimezone)}</RtlText>
                    <RtlText style={styles.detail}>פותח/ת: {record.startedByUserId ?? 'לא נשמר'} · הולך/ת בפועל: {record.actualWalkerUserId ?? 'לא נשמר'}</RtlText>
                    <RtlText style={styles.detail}>אחראי/ת מתוזמן/ת: {record.responsibleUserId}</RtlText>
                    <RtlText style={styles.detail}>קבוצת ביקורת קיימת: {record.duplicateResolutionGroupId ?? 'אין'}</RtlText>
                    {record.auditEntries.length ? record.auditEntries.map((event) => (
                      <RtlText key={event.id} style={styles.detail}>
                        יומן ביקורת: {event.action} · {formatTimestamp(event.createdAt, authFamilyTimezone)} · מבצע/ת {event.actorUserId ?? 'לא נשמר'} · {auditDetails(event.metadata)}
                      </RtlText>
                    )) : <RtlText style={styles.detail}>לא נמצאה רשומת ביקורת מקושרת.</RtlText>}
                    {record.gpsSessions.length ? record.gpsSessions.map((session) => (
                      <RtlText key={session.id} style={styles.detail}>
                        GPS {session.id} · {session.pointCount} נקודות · {session.distanceMeters == null ? 'מרחק לא נשמר' : `${Math.round(session.distanceMeters)} מ׳`} · {formatTimestamp(session.startedAt, authFamilyTimezone)}–{formatTimestamp(session.endedAt, authFamilyTimezone)} · יוצר/ת {session.createdByUserId ?? 'לא נשמר'}
                      </RtlText>
                    )) : <RtlText style={styles.detail}>לא נמצאה רשומת GPS מקושרת.</RtlText>}
                  </>
                ) : <RtlText style={styles.detail}>הרשומה לא נמצאה במשפחה הפעילה.</RtlText>}
              </View>
            );
          })}

          {actionError ? (
            <View style={styles.messageBox}>
              <RtlText style={styles.errorText}>{actionError}</RtlText>
              {outcomeUncertain ? <RtlText style={styles.body}>הפעולה לא תישלח עם מזהה חדש. ניסיון חוזר ישתמש באותו UUID ויחזיר את קבוצת הביקורת הקיימת אם השרת כבר השלים אותה.</RtlText> : null}
            </View>
          ) : null}
          {resolvedGroupId ? <RtlText style={styles.successText}>נשמרה קבוצת ביקורת {resolvedGroupId}. היסטוריית ההליכות וה-GPS נשארה שמורה.</RtlText> : null}

          {mayStartOrRetry ? (
            <ActionButton
              title={retryOperationExists ? 'בדיקה / ניסיון חוזר בטוח' : 'סקירה ואישור'}
              onPress={() => { setChecked(false); setConfirmVisible(true); }}
              disabled={busy}
            />
          ) : null}
          <ActionButton title="רענון נתונים" onPress={() => void refresh()} disabled={busy || loading} secondary />
        </>
      ) : null}

      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => { if (!busy) setConfirmVisible(false); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <RtlText style={styles.modalTitle} accessibilityRole="header">אישור פתרון של שלוש כפילויות</RtlText>
            <RtlText style={styles.body}>השרת יסמן את שלוש הפתיחות ככפילויות פתורות, ללא בחירת טיול קנוני. הסטטוסים, הזמנים, המבצעים ורשומות ה-GPS המקוריות יישמרו.</RtlText>
            <ScrollView style={styles.modalList}>
              {CONFIRMED_STAGING_DUPLICATE_WALK_IDS.map((id) => (
                <RtlText key={id} style={styles.detail}>{id}{byId.has(id) ? ` · ${formatTimestamp(byId.get(id)?.startedAt, authFamilyTimezone)}` : ' · לא נמצא בבדיקה'}</RtlText>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() => setChecked((value) => !value)}
              style={styles.checkboxRow}
            >
              <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked ? <RtlText style={styles.checkmark}>✓</RtlText> : null}</View>
              <RtlText style={styles.checkboxLabel}>אני מאשר/ת שכל שלוש הרשומות הן פתיחות בדיקה כפולות, ושלא יישאר טיול קנוני פעיל.</RtlText>
            </Pressable>
            <View style={styles.modalActions}>
              <ActionButton title="ביטול" onPress={() => setConfirmVisible(false)} disabled={busy} secondary />
              <ActionButton title={busy ? 'שולח בקשה…' : 'אישור מנהל/ת'} onPress={() => void submitResolution()} disabled={!checked || busy || !mayStartOrRetry} />
            </View>
            {busy ? <ActivityIndicator accessibilityLabel="ממתין לאישור השרת" color={colors.primary} /> : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ActionButton({ title, onPress, disabled, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, secondary && styles.secondaryButton, disabled && styles.buttonDisabled]}
    >
      <RtlText style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{title}</RtlText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { marginBottom: 18, padding: 14, backgroundColor: colors.warningSoft, borderColor: colors.border, borderWidth: 1, borderRadius: 14, gap: 10 },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', textAlign: 'right' },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'right' },
  statusText: { color: colors.textPrimary, fontSize: 13, lineHeight: 20, fontWeight: '700', textAlign: 'right' },
  record: { padding: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, gap: 5 },
  recordHeading: { color: colors.textPrimary, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  detail: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  messageBox: { padding: 10, borderRadius: 10, backgroundColor: colors.dangerSoft, gap: 8 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 20, fontWeight: '700', textAlign: 'right' },
  successText: { color: colors.success, fontSize: 13, lineHeight: 20, fontWeight: '700', textAlign: 'right' },
  button: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  secondaryButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.textInverse, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  secondaryButtonText: { color: colors.textPrimary },
  buttonDisabled: { opacity: 0.5 },
  modalBackdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 520, maxHeight: '90%', alignSelf: 'center', padding: 18, gap: 12, borderRadius: 16, backgroundColor: colors.background },
  modalTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', textAlign: 'right' },
  modalList: { maxHeight: 160, padding: 10, backgroundColor: colors.surface, borderRadius: 10 },
  checkboxRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderColor: colors.primary, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.primary },
  checkmark: { color: colors.textInverse, fontWeight: '900' },
  checkboxLabel: { flex: 1, color: colors.textPrimary, fontSize: 13, lineHeight: 20, textAlign: 'right' },
  modalActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
