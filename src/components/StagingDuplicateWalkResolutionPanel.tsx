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
  getDuplicateActiveWalkGroups,
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

function auditDetails(metadata: Record<string, unknown>): string {
  const details = [
    typeof metadata.date === 'string' ? `תאריך ${metadata.date}` : null,
    typeof metadata.time === 'string' ? `שעה ${metadata.time}` : null,
    typeof metadata.responsible_user_id === 'string' ? `אחראי/ת ${metadata.responsible_user_id}` : null,
  ].filter((value): value is string => Boolean(value));
  return details.join(' · ') || 'ללא פרטים נוספים';
}

function operationScope(familyId: string, walkIds: string[]): string {
  return `${familyId}:${[...walkIds].sort().join(',')}`;
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
  const [retryScopes, setRetryScopes] = useState<string[]>([]);
  const [confirmDogId, setConfirmDogId] = useState('');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolvedGroupId, setResolvedGroupId] = useState('');
  const busyRef = useRef(false);

  const groups = useMemo(
    () => familyId ? getDuplicateActiveWalkGroups(records, familyId) : [],
    [records, familyId],
  );
  const confirmGroup = groups.find((group) => group.dogId === confirmDogId);
  const confirmWalkIds = confirmGroup?.walkIds ?? [];
  const confirmScope = familyId && confirmWalkIds.length ? operationScope(familyId, confirmWalkIds) : '';
  const readiness = familyId && confirmGroup
    ? getDuplicateResolutionReadiness(records, familyId, confirmGroup.walkIds)
    : 'missing_records';
  const mayRetrySameOperation = Boolean(confirmScope && retryScopes.includes(confirmScope));
  const maySubmit = readiness === 'ready' || mayRetrySameOperation;

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
      const reviewRecords = await repository.getDuplicateActiveWalkReview(familyId, []);
      const reviewGroups = getDuplicateActiveWalkGroups(reviewRecords, familyId);
      const existingScopes = await Promise.all(reviewGroups.map(async (group) => {
        const scope = operationScope(familyId, group.walkIds);
        const existingId = await getExistingWalkLifecycleOperationId(ACTION, scope, profileId);
        return existingId ? scope : null;
      }));
      setRecords(reviewRecords);
      setRetryScopes(existingScopes.filter((scope): scope is string => Boolean(scope)));
    } catch (error) {
      setRecords([]);
      setRetryScopes([]);
      setLoadError(getDuplicateResolutionReviewErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [allowed, familyId, profileId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submitResolution = useCallback(async () => {
    if (busyRef.current || !checked || !allowed || !familyId || !profileId || !confirmGroup || !maySubmit) return;
    busyRef.current = true;
    setBusy(true);
    setActionError('');
    setOutcomeUncertain(false);
    try {
      // Persist and reuse one UUID for this exact family + sorted walk set + actor.
      const scope = operationScope(familyId, confirmGroup.walkIds);
      const operationId = await getWalkLifecycleOperationId(ACTION, scope, profileId);
      if (!repository.resolveDuplicateActiveWalksV12) throw new Error('Staging duplicate resolution RPC is not configured');
      const groupId = await repository.resolveDuplicateActiveWalksV12({
        walkIds: [...confirmGroup.walkIds],
        canonicalWalkId: null,
        rationale: TEST_DUPLICATE_RESOLUTION_RATIONALE,
        operationId,
      });
      setResolvedGroupId(groupId);
      await completeWalkLifecycleOperation(ACTION, scope, profileId);
      setRetryScopes((current) => current.filter((candidate) => candidate !== scope));
      setConfirmVisible(false);
      setChecked(false);
      setConfirmDogId('');
      await refresh();
    } catch (error) {
      const errorKind = getDuplicateResolutionErrorKind(error);
      setOutcomeUncertain(errorKind === 'network' && !/no resolution request was sent/i.test(String((error as { message?: string })?.message ?? error)));
      setActionError(getDuplicateResolutionErrorMessage(error));
      if (confirmScope) setRetryScopes((current) => current.includes(confirmScope) ? current : [...current, confirmScope]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [allowed, familyId, profileId, checked, confirmGroup, maySubmit, confirmScope, refresh]);

  if (!allowed) return null;

  return (
    <View style={styles.panel}>
      <RtlText style={styles.title} accessibilityRole="header">בדיקת טיולים פעילים כפולים · Staging</RtlText>
      <RtlText style={styles.body}>הכלי קורא את כל הטיולים הפעילים במשפחה הנוכחית. כל קבוצה מוצגת לפי כלב, ורק מנהל/ת משפחה יכול/ה לאשר פתרון לא־הרסני. ההיסטוריה ורשומות ה-GPS נשמרות.</RtlText>

      {loading ? <ActivityIndicator accessibilityLabel="טוען נתוני בדיקה מהשרת" color={colors.primary} /> : null}
      {loadError ? (
        <View style={styles.messageBox}>
          <RtlText style={styles.errorText}>{loadError}</RtlText>
          <ActionButton title="בדיקה מחדש" onPress={() => void refresh()} disabled={loading} />
        </View>
      ) : null}

      {!loading && !loadError ? (
        <>
          {groups.length === 0 ? (
            <RtlText style={styles.statusText}>לא נמצאו במשפחה זו קבוצות של יותר מטיול פעיל לא פתור אחד לאותו כלב.</RtlText>
          ) : (
            <RtlText style={styles.statusText}>נמצאו {groups.length} קבוצות פעילות לבדיקה. לא יבוצע שינוי ללא אישור מפורש של כל הקבוצה המוצגת.</RtlText>
          )}
          {groups.map((group) => {
            const scope = familyId ? operationScope(familyId, group.walkIds) : '';
            const retryExists = retryScopes.includes(scope);
            return (
              <View key={group.dogId} style={styles.group}>
                <RtlText style={styles.groupHeading}>כלב {group.dogId} · {group.records.length} טיולים פעילים לא פתורים</RtlText>
                {group.records.map((record) => (
                  <View key={record.walkId} style={styles.record}>
                    <RtlText style={styles.recordHeading}>טיול {record.walkId}</RtlText>
                    <RtlText style={styles.detail}>משפחה: {record.familyId} · כלב: {record.dogId} · סוג: {record.isUnplanned ? 'ספונטני' : 'מתוזמן'}{record.scheduleEntryId ? ` · מופע ${record.scheduleEntryId}` : ''}</RtlText>
                    <RtlText style={styles.detail}>נוצר: {formatTimestamp(record.createdAt, authFamilyTimezone)} · התחיל: {formatTimestamp(record.startedAt, authFamilyTimezone)}</RtlText>
                    <RtlText style={styles.detail}>פותח/ת: {record.startedByUserId ?? 'לא נשמר'} · אחראי/ת: {record.responsibleUserId}</RtlText>
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
                  </View>
                ))}
                <ActionButton
                  title={retryExists ? 'בדיקת / ניסיון חוזר בטוח לקבוצה' : `סקירה ואישור של ${group.records.length} רשומות`}
                  onPress={() => { setConfirmDogId(group.dogId); setChecked(false); setActionError(''); setConfirmVisible(true); }}
                  disabled={busy}
                />
              </View>
            );
          })}

          {actionError ? (
            <View style={styles.messageBox}>
              <RtlText style={styles.errorText}>{actionError}</RtlText>
              {outcomeUncertain ? <RtlText style={styles.body}>לא ייווצר מזהה פעולה חדש. ניסיון חוזר לאותה קבוצת הליכות ישתמש באותו UUID; רענון הנתונים יבדוק אם השרת כבר השלים את הפעולה.</RtlText> : null}
            </View>
          ) : null}
          {resolvedGroupId ? <RtlText style={styles.successText}>נשמרה קבוצת ביקורת {resolvedGroupId}. הסטטוסים והיסטוריית ה-GPS המקוריים נשמרו.</RtlText> : null}
          <ActionButton title="רענון נתונים" onPress={() => void refresh()} disabled={busy || loading} secondary />
        </>
      ) : null}

      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => { if (!busy) setConfirmVisible(false); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <RtlText style={styles.modalTitle} accessibilityRole="header">אישור פתרון של {confirmWalkIds.length} כפילויות</RtlText>
            <RtlText style={styles.body}>השרת יסמן את הרשומות המדויקות שלהלן ככפילויות פתורות, ללא טיול קנוני. הסטטוס, הזמנים, השיוך ורשומות ה-GPS יישמרו.</RtlText>
            <ScrollView style={styles.modalList}>
              {confirmGroup?.records.map((record) => (
                <RtlText key={record.walkId} style={styles.detail}>{record.walkId} · {formatTimestamp(record.createdAt ?? record.startedAt, authFamilyTimezone)}</RtlText>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() => setChecked((value) => !value)}
              style={styles.checkboxRow}
            >
              <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked ? <RtlText style={styles.checkmark}>✓</RtlText> : null}</View>
              <RtlText style={styles.checkboxLabel}>אני מאשר/ת שכל {confirmWalkIds.length} הרשומות המוצגות הן טיולי בדיקה כפולים, ושלא יישאר טיול קנוני פעיל.</RtlText>
            </Pressable>
            <View style={styles.modalActions}>
              <ActionButton title="ביטול" onPress={() => setConfirmVisible(false)} disabled={busy} secondary />
              <ActionButton title={busy ? 'שולח בקשה…' : 'אישור מנהל/ת'} onPress={() => void submitResolution()} disabled={!checked || busy || !maySubmit} />
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
  group: { padding: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, gap: 8 },
  groupHeading: { color: colors.textPrimary, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  record: { padding: 10, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, gap: 5 },
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
