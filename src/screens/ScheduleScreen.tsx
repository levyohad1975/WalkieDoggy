import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { useRequestsStore } from '../store/requestsStore';
import { colors } from '../theme/colors';
import { breakpoints, radii, spacing, typography } from '../theme/tokens';
import { WalkRow } from '../components/WalkRow';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { EditWalkModal } from '../components/EditWalkModal';
import { CompleteWalkModal } from '../components/CompleteWalkModal';
import { RuleFormModal, type RuleFormResult } from '../components/RuleFormModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { UserPickerModal } from '../components/UserPickerModal';
import { SwapWalkPickerModal } from '../components/SwapWalkPickerModal';
import { DogSelectorRow } from '../components/DogSelectorRow';
import { RequestTimeChangeModal } from '../components/RequestTimeChangeModal';
import { DEMO_FAMILY } from '../data/demoData';
import { generateId } from '../lib/id';
import { localDateOnly } from '../logic/dateFormat';
import { isOverdue } from '../logic/nextWalk';
import { previewRotation } from '../logic/rotation';
import { canRequestChangeForWalk } from '../logic/walkActions';
import { walkHasActiveSwapRequest, walkHasActiveTimeChangeRequest } from '../logic/requestLifecycle';
import { computeWalkRequestStatusLine } from '../logic/walkRequestStatusLine';
import { isSupabaseConfigured } from '../lib/supabase';
import type { ScheduleRule, Walk } from '../types';

type RangeKey = 'today' | 'tomorrow' | 'week';

const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'היום',
  tomorrow: 'מחר',
  week: 'השבוע',
};

// Local (not UTC) date-only, shared with dateFormat.ts — see that file's
// doc comment for why "today" must be computed from the viewer's own local
// calendar day rather than toDateOnly()'s UTC anchor.
const toLocalDateOnly = localDateOnly;

function inRange(dateStr: string, range: RangeKey): boolean {
  const today = toLocalDateOnly(new Date());
  if (range === 'today') return dateStr === today;
  if (range === 'tomorrow') return dateStr === toLocalDateOnly(new Date(Date.now() + 86400000));
  const weekEnd = toLocalDateOnly(new Date(Date.now() + 7 * 86400000));
  return dateStr >= today && dateStr <= weekEnd;
}

function formatDateLabel(dateStr: string): string {
  const today = toLocalDateOnly(new Date());
  if (dateStr === today) return 'היום';
  if (dateStr === toLocalDateOnly(new Date(Date.now() + 86400000))) return 'מחר';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function ScheduleScreen() {
  const { users, dog, dogs, selectedDogId, selectDog, loading: familyLoading, load: loadFamily } = useFamilyStore();
  const {
    walks,
    rules,
    loading: scheduleLoading,
    error,
    actionError,
    load: loadSchedule,
    addRule,
    updateRule,
    deleteRule,
    rescheduleWalk,
    swap,
    swapTwoWalks,
    skip,
    markDone,
    clearActionError,
  } = useScheduleStore();
  const currentUserId = useAuthStore((s) => s.currentUserId)!;
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  // Single source of truth for admin/member permissions — see authStore.
  // Effective, not raw: 'member' while Admin Test Mode is simulating one,
  // so this screen's admin-only controls (rule add/edit/delete, and the
  // tap-to-edit-a-walk row below) are hidden consistently with Home's,
  // instead of only Home reflecting the simulation.
  const familyRole = useEffectiveFamilyRole();
  // ROUND-5, Part 2 fix: this screen previously used raw currentUserId for
  // "is this walk mine" eligibility decisions, which broke under REAL QA
  // Impersonation (Admin -> impersonate Omar -> Schedule should behave
  // exactly as if Omar's own device were looking at it). effectiveUserId is
  // the simulated/impersonated member's id while either mode is active, the
  // real currentUserId otherwise — mirrors HomeScreen's own usage. Display/
  // eligibility-filtering only: the request-creation RPCs still resolve the
  // real actor server-side via current_profile_id(), never a client-supplied
  // id (see useEffectiveUserId's own doc comment in authStore.ts).
  // NARROW FIX PASS (typecheck): ScheduleScreen, like HomeScreen (see its
  // identical `!` with the same justification), is only ever rendered as a
  // Tab.Screen inside RootNavigator (navigation/RootNavigator.tsx), which
  // App.tsx renders only once `currentUserId` is non-null — the final
  // fallback in useEffectiveUserId()'s `impersonatingUserId ?? testModeUserId
  // ?? currentUserId` chain. So effectiveUserId is genuinely non-null for the
  // entire lifetime of this component; the `!` documents that real render-time
  // guarantee rather than papering over an actual nullable case.
  const effectiveUserId = useEffectiveUserId()!;

  const {
    createSwap: createSwapRequest,
    createTimeChange: createTimeChangeRequest,
    swapRequests,
    timeChangeRequests,
    error: requestsError,
    clearError: clearRequestsError,
  } = useRequestsStore();

  // P1 — compact request-status line on walk cards: single lookup shared by
  // every WalkRow below (computeWalkRequestStatusLine needs a walk-status
  // map to tell an 'expired' pending request apart from a still-actionable
  // one — see requestLifecycle.ts). Recomputed only when the walk list
  // itself changes.
  const walksById = useMemo(
    () => Object.fromEntries(walks.map((w) => [w.id, { status: w.status }])),
    [walks]
  );

  const [range, setRange] = useState<RangeKey>('today');
  const [editingWalkId, setEditingWalkId] = useState<string | null>(null);
  const [ruleFormVisible, setRuleFormVisible] = useState(false);
  const [editingRule, setEditingRule] = useState<ScheduleRule | null>(null);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);
  const [requestSwapWalkId, setRequestSwapWalkId] = useState<string | null>(null);
  const [requestSwapTargetUserId, setRequestSwapTargetUserId] = useState<string | null>(null);
  const [requestTimeChangeWalkId, setRequestTimeChangeWalkId] = useState<string | null>(null);
  // QA pass v3, issue 11 fix: overdue-resolution ("✓ בוצע"/"✕ לא בוצע") for
  // any walk in this list the viewer may resolve — see WalkRow's
  // onMarkDone/onMarkNotDone doc comment for why this can no longer be
  // limited to just HomeScreen's single "next walk".
  const [resolveWalkId, setResolveWalkId] = useState<string | null>(null);

  useEffect(() => {
    loadFamily(familyId);
    loadSchedule(familyId);
  }, [loadFamily, loadSchedule, familyId]);

  // Full set, including removed members — needed so history/rule labels
  // still resolve a removed member's real name/avatar (see
  // FamilyUser.removedAt's doc comment).
  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  // Active-only — for pickers that assign NEW work (rotation membership,
  // "hand this walk to"): a removed member must never be offered here.
  const activeUsers = useMemo(() => users.filter((u) => !u.removedAt), [users]);

  // PRD §11: multi-dog families must see only the SELECTED dog's schedule
  // here — `walks`/`rules` themselves are the raw, family-wide store,
  // unfiltered by dog. A single-dog family (dogs.length <= 1) is
  // unaffected. ID-based lookups (walksById, walks.find) stay on the
  // unfiltered `walks` on purpose — they resolve one already-known walk
  // regardless of which dog is currently selected.
  const visibleWalks = useMemo(
    () => (dogs.length > 1 && dog ? walks.filter((w) => w.dogId === dog.id) : walks),
    [walks, dogs.length, dog?.id]
  );
  const visibleRules = useMemo(
    () => (dogs.length > 1 && dog ? rules.filter((r) => r.dogId === dog.id) : rules),
    [rules, dogs.length, dog?.id]
  );

  const grouped = useMemo(() => {
    // Schedule is forward-looking. Completed/skipped walks belong in History,
    // not in this screen; keep only unresolved/active walks here.
    const filtered = visibleWalks.filter(
      (w) => (w.status === 'pending' || w.status === 'in_progress') && inRange(w.date, range)
    );
    const byDate = new Map<string, Walk[]>();
    for (const w of filtered) {
      const list = byDate.get(w.date) ?? [];
      list.push(w);
      byDate.set(w.date, list);
    }
    for (const list of byDate.values()) list.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visibleWalks, range]);

  // Chronological by actual walk time, not the old manual sort_order — the
  // ▲/▼ reordering UI only ever changed display order while the times
  // stayed the same, which was confusing with little product value. The
  // `sortOrder` column itself is left alone (no migration needed; nothing
  // still reads it for ordering, but other code/back-compat may still rely
  // on the column existing).
  const sortedRules = useMemo(() => [...visibleRules].sort((a, b) => a.time.localeCompare(b.time)), [visibleRules]);

  const editingWalk = editingWalkId ? walks.find((w) => w.id === editingWalkId) ?? null : null;
  const otherPendingWalks = useMemo(() => {
    if (!editingWalk) return [];
    // Multi-dog (PRD §11): a swap target must belong to the SAME dog as
    // the walk being edited — matching HomeScreen's identical fix and the
    // dogId filter SwapWalkPickerModal's other call sites already apply.
    return walks
      .filter((w) => w.id !== editingWalk.id && w.status === 'pending' && w.dogId === editingWalk.dogId)
      .sort((a, b) => (a.date + a.scheduledTime).localeCompare(b.date + b.scheduledTime))
      .slice(0, 12)
      .map((w) => ({ walk: w, responsible: usersById[w.responsibleUserId] }));
  }, [walks, editingWalk, usersById]);

  const loading = familyLoading || scheduleLoading;

  // QA/UX round, Part A fix: this used to be an inline predicate here with
  // no equivalent on HomeScreen at all — extracted to
  // logic/walkActions.ts's canRequestChangeForWalk() so both screens share
  // exactly one eligibility rule. See that function's doc comment for the
  // full reasoning (unchanged from this screen's original inline version).
  const canRequestForWalk = (w: Walk): boolean =>
    canRequestChangeForWalk(w, effectiveUserId, familyRole, isSupabaseConfigured);

  // Both create_swap_request() and create_time_change_request() (migrations
  // 0018/0006) reject a second pending request naming a walk that already
  // has one outstanding (see requestLifecycle.ts's own doc comment) — these
  // add that check on top of canRequestForWalk's base eligibility rule, so
  // the request links aren't shown for a walk that would always be rejected.
  const canRequestSwapForWalk = (w: Walk): boolean =>
    canRequestForWalk(w) && !walkHasActiveSwapRequest(w.id, swapRequests, walksById);
  const canRequestTimeChangeForWalk = (w: Walk): boolean =>
    canRequestForWalk(w) && !walkHasActiveTimeChangeRequest(w.id, timeChangeRequests, walksById);

  // QA pass v3, issue 11 fix: same authorization as NextWalkCard's
  // `canResolve` (admin, or the currently-responsible member — migration
  // 0012), but applied to EVERY overdue+pending walk in this list, not just
  // whichever one happens to be HomeScreen's single "next walk".
  const canResolveWalk = (w: Walk): boolean =>
    w.status === 'pending' &&
    isOverdue(w) &&
    (familyRole === 'admin' || w.responsibleUserId === effectiveUserId);

  const resolveWalk = resolveWalkId ? walks.find((w) => w.id === resolveWalkId) : undefined;

  const requestSwapWalk = requestSwapWalkId ? walks.find((w) => w.id === requestSwapWalkId) : undefined;
  const requestTimeChangeWalk = requestTimeChangeWalkId
    ? walks.find((w) => w.id === requestTimeChangeWalkId)
    : undefined;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, Platform.OS === 'web' && styles.webContent]}>
        <RtlText style={styles.header} accessibilityRole="header">לוח הזמנים של {dog?.name ?? 'הכלב/ה שלנו'}</RtlText>

        {/* PRD §11: easy dog picker whenever there's more than one dog —
            same widget/placement pattern as HomeScreen's own fix. Hidden
            entirely for a single-dog family. */}
        {dogs.length > 1 ? (
          <DogSelectorRow dogs={dogs} selectedDogId={selectedDogId} onSelect={(dogId) => void selectDog(dogId)} />
        ) : null}

        <View style={styles.tabs}>
          {(['today', 'tomorrow', 'week'] as RangeKey[]).map((key) => (
            <RtlText key={key} onPress={() => setRange(key)} style={[styles.tab, range === key && styles.tabActive]}>
              {RANGE_LABELS[key]}
            </RtlText>
          ))}
        </View>

        {loading && walks.length === 0 ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} accessibilityLabel="טוען…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => loadSchedule(familyId)} />
        ) : grouped.length === 0 ? (
          <EmptyState title="אין תורנויות בטווח הזה" subtitle="אפשר להוסיף שעת טיול למטה" />
        ) : (
          <View style={styles.daysList}>
            {grouped.map(([date, dayWalks]) => (
              <View key={date} style={styles.daySection}>
                <RtlText style={styles.dayTitle}>{formatDateLabel(date)}</RtlText>
                <View style={styles.list}>
                  {dayWalks.map((w) => (
                    <WalkRow
                      key={w.id}
                      walk={w}
                      responsible={usersById[w.responsibleUserId]}
                      completedBy={w.completedByUserId ? usersById[w.completedByUserId] : undefined}
                      // Reaching EditWalkModal (change time/responsible,
                      // cancel the walk) is Admin-only — requirement 6.
                      // Previously reachable here for anyone; now consistent
                      // with Home's gating.
                      onPress={w.status === 'pending' && familyRole === 'admin' ? () => setEditingWalkId(w.id) : undefined}
                      // ROUND-5, Part 2: request actions for ANY eligible
                      // future walk, not just Home's "next walk" — see
                      // canRequestForWalk() above for the exact filter.
                      onRequestSwap={canRequestSwapForWalk(w) ? () => setRequestSwapWalkId(w.id) : undefined}
                      onRequestTimeChange={canRequestTimeChangeForWalk(w) ? () => setRequestTimeChangeWalkId(w.id) : undefined}
                      onMarkDone={canResolveWalk(w) ? () => setResolveWalkId(w.id) : undefined}
                      onMarkNotDone={canResolveWalk(w) ? () => skip(w.id) : undefined}
                      requestStatusLine={
                        computeWalkRequestStatusLine(w, swapRequests, timeChangeRequests, walksById, new Date(), effectiveUserId)?.text
                      }
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            {/*
              FINAL CORRECTION PASS — Deliverable 3H: removed
              adjustsFontSizeToFit/minimumFontScale — this is a short,
              bounded string ("שעות קבועות (N)") with no realistic overflow
              risk at any phone width; the auto-shrink was an unreviewed
              leftover, not a real fix for anything, and is exactly the
              pattern WalkRow's own redesign already established should
              never be used for this reason (per its own doc comment).
              numberOfLines alone is enough headroom for the rare case.
            */}
            <RtlText style={styles.sectionTitle} numberOfLines={1}>
              שעות קבועות ({sortedRules.length})
            </RtlText>
            {familyRole === 'admin' ? (
  <Pressable
    onPress={() => {
      setEditingRule(null);
      setRuleFormVisible(true);
    }}
  >
    <RtlText style={styles.addLink}>+ הוספת שעה</RtlText>
  </Pressable>
) : null}
          </View>

          {sortedRules.length === 0 ? (
            <RtlText style={styles.empty}>עדיין אין שעות טיול מוגדרות</RtlText>
          ) : (
            sortedRules.map((r) => (
  <View key={r.id} style={styles.ruleRow}>
    {familyRole === 'admin' ? (
  <View style={styles.ruleActions}>
    <Pressable
      onPress={() => {
        setEditingRule(r);
        setRuleFormVisible(true);
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`עריכת שעת טיול ${r.time}`}
    >
      <RtlText style={styles.ruleActionIcon}>✏️</RtlText>
    </Pressable>

    <Pressable
      onPress={() => setDeleteRuleId(r.id)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`מחיקת שעת טיול ${r.time}`}
      accessibilityHint="יוצג אישור לפני מחיקת שעת הטיול"
    >
      <RtlText style={styles.ruleActionIcon}>🗑️</RtlText>
    </Pressable>
  </View>
) : null}

    <View style={styles.ruleInfo}>
      <RtlText style={styles.ruleTime}>
        {r.time}
        {r.label ? ` · ${r.label}` : ''}
      </RtlText>

      {/* RTL polish (final QA round): a long rotation ("דנה → יוסי → מיכל
          → אורי") used to be forced onto one shrinking line, which on a
          narrow phone could shrink names down past legibility or truncate
          into an unreadable ellipsis — a name effectively reduced to
          "bare dots". Wrapping instead of shrinking/truncating keeps every
          name fully readable at a consistent size. */}
      <RtlText style={styles.ruleRotation}>
        {previewRotation(
          r.rotationUserIds.map((id) => usersById[id]?.name ?? '?'),
          r.rotationUserIds.length
        )}
      </RtlText>
    </View>
  </View>
))

          )}
        </View>
      </ScrollView>

      <EditWalkModal
        visible={!!editingWalk}
        walk={editingWalk}
        users={activeUsers}
        otherPendingWalks={otherPendingWalks}
        onChangeTime={async (newTime) => {
          if (editingWalk) await rescheduleWalk(editingWalk.id, newTime);
          setEditingWalkId(null);
        }}
        onChangeResponsible={async (newUserId) => {
          if (editingWalk) await swap(editingWalk.id, newUserId, currentUserId);
          setEditingWalkId(null);
        }}
        onSwapWithWalk={async (otherWalkId) => {
          if (editingWalk) await swapTwoWalks(editingWalk.id, otherWalkId, currentUserId);
          setEditingWalkId(null);
        }}
        onCancelWalk={async () => {
          if (editingWalk) await skip(editingWalk.id);
          setEditingWalkId(null);
        }}
        onClose={() => setEditingWalkId(null)}
      />

      <RuleFormModal
        visible={ruleFormVisible}
        editingRule={editingRule}
        users={activeUsers}
        onSave={async (result: RuleFormResult) => {
          if (editingRule) {
            await updateRule(editingRule.id, result);
          } else if (dog) {
            const rule: ScheduleRule = {
              id: generateId('rule'),
              familyId,
              dogId: dog.id,
              time: result.time,
              label: result.label || undefined,
              daysOfWeek: result.daysOfWeek,
              rotationUserIds: result.rotationUserIds,
              rotationAnchorDate: toLocalDateOnly(new Date()),
              sortOrder: sortedRules.length,
              active: true,
              createdAt: new Date().toISOString(),
            };
            await addRule(rule);
          } else {
            // Must never fail silently: without a loaded dog we have no
            // dogId to attach the new rule to, but the person tapped
            // "שמירה" and needs to see *something* happened, not a modal
            // that quietly closes with nothing added.
            useScheduleStore.setState({
              actionError: 'עדיין טוענים את פרטי הכלב/ה — נסו שוב בעוד רגע',
            });
          }
          setRuleFormVisible(false);
        }}
        onClose={() => setRuleFormVisible(false)}
      />

      <ConfirmModal
        visible={!!deleteRuleId}
        title="למחוק את שעת הטיול הזו?"
        message="טיולים עתידיים שטרם בוצעו יימחקו מהלוח. היסטוריה תישאר."
        confirmLabel="מחק"
        onConfirm={async () => {
          if (deleteRuleId) await deleteRule(deleteRuleId);
          setDeleteRuleId(null);
        }}
        onCancel={() => setDeleteRuleId(null)}
      />

      <ConfirmModal
        visible={!!actionError}
        title="אופס"
        message={actionError ?? ''}
        confirmLabel="הבנתי"
        onConfirm={clearActionError}
        onCancel={clearActionError}
      />

      {/*
        ROUND-5, Part 2: request creation for any eligible future walk —
        mirrors HomeScreen's identical UserPickerModal/RequestTimeChangeModal
        wiring against useRequestsStore's createSwap/createTimeChange (which
        already runs guardTestModeMutation() as their first line, so
        read-only Test Mode blocking falls out for free here too — see
        requestsStore.ts). Real QA Impersonation "just works" because the
        server resolves the actual actor via current_profile_id()
        (migrations/0006_qa_impersonation.sql), regardless of what this
        screen passes.
      */}
      {/* QA pass v3, issue 11 fix — mirrors HomeScreen's identical
          CompleteWalkModal wiring for onMarkDone, just for whichever
          overdue walk in THIS list was resolved (not only "next walk"). */}
      <CompleteWalkModal
        visible={!!resolveWalk}
        dogName={dog?.name ?? 'הכלב/ה'}
        scheduledTime={resolveWalk?.scheduledTime}
        users={activeUsers}
        defaultUserId={effectiveUserId}
        onConfirm={async ({ completedByUserId, hadPee, hadPoop, note }) => {
          const walkId = resolveWalkId;
          setResolveWalkId(null);
          if (!walkId) return;
          await markDone(walkId, completedByUserId, { hadPee, hadPoop, note: note || undefined });
        }}
        onCancel={() => setResolveWalkId(null)}
      />

      <UserPickerModal
        visible={!!requestSwapWalk && !requestSwapTargetUserId}
        title="לבקש החלפה עם מי?"
        users={activeUsers}
        excludeUserId={requestSwapWalk?.responsibleUserId}
        onSelect={(userId) => setRequestSwapTargetUserId(userId)}
        onClose={() => {
          setRequestSwapTargetUserId(null);
          setRequestSwapWalkId(null);
        }}
      />

      <SwapWalkPickerModal
        visible={!!requestSwapWalk && !!requestSwapTargetUserId}
        walk={requestSwapWalk ?? null}
        options={walks
          .filter((w) =>
            w.id !== requestSwapWalkId &&
            w.status === 'pending' &&
            w.responsibleUserId === requestSwapTargetUserId &&
            (!requestSwapWalk || w.dogId === requestSwapWalk.dogId) &&
            new Date(`${w.date}T${w.scheduledTime}:00`).getTime() > Date.now() &&
            !walkHasActiveSwapRequest(w.id, swapRequests, walksById)
          )
          .sort((a, b) => `${a.date}T${a.scheduledTime}`.localeCompare(`${b.date}T${b.scheduledTime}`))
          .slice(0, 20)
          .map((w) => ({ walk: w, responsible: usersById[w.responsibleUserId] }))}
        onSelect={async (targetWalkId) => {
          const sourceWalkId = requestSwapWalkId;
          setRequestSwapTargetUserId(null);
          setRequestSwapWalkId(null);
          if (sourceWalkId) await createSwapRequest(sourceWalkId, targetWalkId);
        }}
        onClose={() => {
          setRequestSwapTargetUserId(null);
          setRequestSwapWalkId(null);
        }}
      />

      <RequestTimeChangeModal
        visible={!!requestTimeChangeWalk}
        currentTime={requestTimeChangeWalk?.scheduledTime ?? ''}
        onSubmit={async (proposedTime) => {
          const walkId = requestTimeChangeWalkId;
          setRequestTimeChangeWalkId(null);
          if (walkId) await createTimeChangeRequest(walkId, proposedTime);
        }}
        onClose={() => setRequestTimeChangeWalkId(null)}
      />

      <ConfirmModal
        visible={!!requestsError}
        title="אופס"
        message={requestsError ?? ''}
        confirmLabel="הבנתי"
        onConfirm={clearRequestsError}
        onCancel={clearRequestsError}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xxxl },
  webContent: { maxWidth: breakpoints.desktopContent, alignSelf: 'center', width: '100%' },
  header: { width: '100%', ...typography.screenTitle, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl', paddingHorizontal: 4 },
  tabs: { flexDirection: 'row-reverse', gap: spacing.sm, paddingVertical: spacing.sm },
  tab: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    color: colors.textSecondary,
    fontWeight: '700',
    overflow: 'hidden',
  },
  tabActive: { backgroundColor: colors.primary, color: colors.textInverse },
  daysList: { gap: spacing.xl },
  daySection: { gap: spacing.sm },
  dayTitle: { width: '100%', ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  list: { gap: spacing.sm },
  empty: { fontSize: 14, color: colors.textSecondary, textAlign: 'right' },
  section: { gap: spacing.sm, marginTop: spacing.xl, width: '100%' },
  sectionHeaderRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
},
  sectionTitle: {
  fontSize: 16,
  fontWeight: '700',
  color: colors.textPrimary,
  textAlign: 'right',
  writingDirection: 'rtl',
  flex: 1,
  minWidth: 0,
},
  addLink: {
  color: colors.primaryDark,
  fontWeight: '700',
  fontSize: 13,
  flexShrink: 0,
  paddingStart: 8,
},
  ruleRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  backgroundColor: colors.surface,
  borderRadius: radii.lg,
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
},

ruleActions: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
},

ruleActionIcon: {
  fontSize: 16,
  padding: 3,
},

ruleInfo: {
  flex: 1,
  gap: 2,
  minWidth: 0,
  alignItems: 'flex-end',
},

ruleTime: {
  fontSize: 17,
  fontWeight: '800',
  color: colors.textPrimary,
  textAlign: 'right',
},

ruleRotation: {
  fontSize: 12,
  color: colors.textSecondary,
  textAlign: 'right',
  width: '100%',
},
});
