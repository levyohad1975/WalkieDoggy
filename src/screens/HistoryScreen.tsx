import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { WalkieMascot } from '../components/WalkieMascot';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { summarizeWalksByUser } from '../logic/walkActions';
import { isOverdue } from '../logic/nextWalk';
import { formatHistoryDate, localDateOnly } from '../logic/dateFormat';
import { isWalkEligibleForHistory, walkMatchesHistorySearch } from '../logic/history';
import { canAccessHistoryScreen } from '../logic/permissions';
import { isSupabaseConfigured } from '../lib/supabase';
import { repository } from '../data';
import { fetchHistoryWalks } from '../lib/permissionedWalks';
import { colors } from '../theme/colors';
import { breakpoints, nativeDirection, radii, spacing, typography } from '../theme/tokens';
import { WalkRow } from '../components/WalkRow';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Avatar } from '../components/Avatar';
import { EditDoneDetailsModal } from '../components/EditDoneDetailsModal';
import { CompleteWalkModal } from '../components/CompleteWalkModal';
import { AddUnplannedWalkModal, type UnplannedWalkResult } from '../components/AddUnplannedWalkModal';
import { DEMO_FAMILY } from '../data/demoData';
import type { Walk, WalkGpsSession } from '../types';

type PlanFilter = 'all' | 'planned' | 'unplanned';
// Section 11: replaces the old "up to 10 individual date chips" wall with a
// compact quick-range concept, per the exact requested labels.
type RangeFilter = 'all' | 'today' | '7d' | '30d' | 'custom';

const RANGE_LABELS: [RangeFilter, string][] = [
  ['all', 'הכל'],
  ['today', 'היום'],
  ['7d', '7 ימים'],
  ['30d', '30 ימים'],
  ['custom', 'בחר תאריך'],
];

export function HistoryScreen() {
  const { users, dog, loading: familyLoading, load: loadFamily, permissionOverrides, permissionOverridesStatus } = useFamilyStore();
  const { walks, loading: scheduleLoading, error, load: loadSchedule, editDoneDetails, editUnplannedWalk, deleteUnplannedWalk, deleteScheduledWalkOccurrence, skip, markDone } = useScheduleStore();
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const effectiveRole = useEffectiveFamilyRole();
  const effectiveUserId = useEffectiveUserId();

  const [editWalkId, setEditWalkId] = useState<string | null>(null);
  const [editUnplannedWalkId, setEditUnplannedWalkId] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('all');
  const [customDate, setCustomDate] = useState<string | null>(null);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [draftCustomDate, setDraftCustomDate] = useState<string | null>(null);
  const [resolveWalkId, setResolveWalkId] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');

  // BATCH 3 CORRECTION #2 (review #2, post-review): HistoryScreen's actual
  // display/calculation dataset. list_history_walks() (migration 0027) is
  // now the real DATA SOURCE, not just an allow/deny probe — the raw
  // `walks` RLS path (used by Home/Schedule via scheduleStore) is
  // deliberately restricted to an operational window and no longer exposes
  // bulk history at all (see migration 0027's own comment), so this screen
  // can no longer treat scheduleStore.walks as a valid history dataset in
  // Supabase mode even for a fully-permitted member. `historyAccessStatus`
  // doubles as both the fetch-in-flight/denied signal AND the actual
  // server-authoritative access check (list_history_walks() itself raises
  // unless has_member_permission('view_history') is true for the caller) —
  // independent of whatever the client-loaded permissionOverrides below
  // currently believes.
  const [historyDataset, setHistoryDataset] = useState<Walk[]>([]);
  const [gpsSessions, setGpsSessions] = useState<Record<string, WalkGpsSession>>({});
  const [historyAccessStatus, setHistoryAccessStatus] = useState<'checking' | 'granted' | 'denied'>(
    isSupabaseConfigured ? 'checking' : 'granted'
  );
  // Tracks whether a prior refreshHistoryDataset() call already landed
  // 'granted' at least once. useFocusEffect below re-runs
  // refreshHistoryDataset() (and thus resets historyAccessStatus to
  // 'checking') on EVERY return to this tab, not just first mount — without
  // this, a background revalidation of an already-authorized user would
  // transiently render the "no access" EmptyState over their already-loaded,
  // still-valid historyDataset on every single refocus. Reset to false on a
  // genuine 'denied' so a subsequent refocus is treated as an unverified
  // first check again, not a trusted background refresh.
  const hasEverGrantedRef = useRef(false);

  const refreshHistoryDataset = useCallback(async () => {
    if (!isSupabaseConfigured) {
      // Local/demo mode: no per-member permission concept and no RPC to
      // call — scheduleStore.walks (unrestricted there) remains the
      // dataset, exactly as before this correction.
      setHistoryAccessStatus('granted');
      hasEverGrantedRef.current = true;
      return;
    }
    setHistoryAccessStatus('checking');
    try {
      const rows = await fetchHistoryWalks();
      setHistoryDataset(rows);
      setHistoryAccessStatus('granted');
      hasEverGrantedRef.current = true;
    } catch (e) {
      setHistoryDataset([]);
      setHistoryAccessStatus('denied');
      hasEverGrantedRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadFamily(familyId);
    loadSchedule(familyId);
  }, [loadFamily, loadSchedule, familyId]);

  // Refetch on every return to this tab (not just on mount) — the same
  // established pattern HomeScreen already uses via useFocusEffect, so a
  // walk resolved/edited from another screen (or another device) while
  // this tab wasn't focused is reflected on return, without needing
  // unrestricted raw historical access just to stay reactive. Each of this
  // screen's own mutation handlers below also calls this directly right
  // after the mutation succeeds, so the dataset updates immediately rather
  // than waiting for a future focus event.
  useFocusEffect(
    useCallback(() => {
      void refreshHistoryDataset();
    }, [refreshHistoryDataset, familyId, effectiveUserId])
  );

  // The actual dataset this screen computes everything from: the
  // permission-gated fetch in Supabase mode, the ordinary reactive store in
  // local/demo mode (see refreshHistoryDataset()'s own comment).
  const sourceWalks = isSupabaseConfigured ? historyDataset : walks;

  useEffect(() => {
    const ids = sourceWalks.filter((w) => w.status === 'done').map((w) => w.id);
    if (ids.length === 0) {
      setGpsSessions({});
      return;
    }
    let cancelled = false;
    void repository.getGpsSessionsForWalkIds(ids).then((sessions) => {
      if (!cancelled) setGpsSessions(Object.fromEntries(sessions.map((session) => [session.walkId, session])));
    }).catch(() => {
      if (!cancelled) setGpsSessions({});
    });
    return () => { cancelled = true; };
  }, [sourceWalks]);

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const activeUsers = useMemo(() => users.filter((u) => !u.removedAt), [users]);
  const resolveWalk = resolveWalkId ? sourceWalks.find((w) => w.id === resolveWalkId) : undefined;
  const canResolveWalk = (w: Walk) => w.status === 'pending' && isOverdue(w) && (effectiveRole === 'admin' || w.responsibleUserId === effectiveUserId);

  // Local calendar day, not UTC — see dateFormat.ts's doc comment; a
  // UTC-anchored cutoff would shift this boundary by a day for anyone
  // ahead of UTC (e.g. Israel) for a few hours after local midnight.
  // `6 * 86400000` (not 7), matching statistics.ts's filterWalksByPeriod()
  // convention exactly: an inclusive-of-today 7-day window is TODAY minus 6
  // days, not 7 — `Date.now() - 7 * 86400000` here previously produced an
  // 8-calendar-day window, silently over-counting the "weekly summary" card
  // by one extra day every time it rendered.
  const weekAgo = useMemo(() => localDateOnly(new Date(Date.now() - 6 * 86400000)), []);
  const weeklyWalks = useMemo(
    () => sourceWalks.filter((w) => w.date >= weekAgo && isWalkEligibleForHistory(w)),
    [sourceWalks, weekAgo]
  );
  const summary = useMemo(() => summarizeWalksByUser(weeklyWalks), [weeklyWalks]);
  const summaryRanked = useMemo(
  () =>
    users
      .map((u) => ({ user: u, count: summary[u.id] ?? 0 }))
      .sort((a, b) => b.count - a.count),
  [users, summary]
);

  const allHistory = useMemo(
    () =>
      [...sourceWalks]
        .filter((w) => isWalkEligibleForHistory(w))
        .sort((a, b) => (a.date + a.scheduledTime < b.date + b.scheduledTime ? 1 : -1)),
    [sourceWalks]
  );

  const todayString = useMemo(() => localDateOnly(new Date()), []);
  const rangeStartDate = useMemo(() => {
    if (rangeFilter === 'today') return todayString;
    if (rangeFilter === '7d') return localDateOnly(new Date(Date.now() - 6 * 86400000));
    if (rangeFilter === '30d') return localDateOnly(new Date(Date.now() - 29 * 86400000));
    return null;
  }, [rangeFilter, todayString]);

  const history = useMemo(
    () =>
      allHistory.filter((w) => {
        if (userFilter && w.completedByUserId !== userFilter && w.responsibleUserId !== userFilter) return false;
        if (planFilter === 'planned' && w.isUnplanned) return false;
        if (planFilter === 'unplanned' && !w.isUnplanned) return false;
        if (rangeFilter === 'today' && w.date !== todayString) return false;
        if ((rangeFilter === '7d' || rangeFilter === '30d') && rangeStartDate && w.date < rangeStartDate) return false;
        if (rangeFilter === 'custom' && customDate && w.date !== customDate) return false;
        if (!walkMatchesHistorySearch(w, historySearchQuery)) return false;
        return true;
      }),
    [allHistory, userFilter, planFilter, rangeFilter, rangeStartDate, customDate, todayString, historySearchQuery]
  );

  const dailySummary = useMemo(() => {
    const byDate = new Map<string, Walk[]>();
    for (const w of history) {
      const list = byDate.get(w.date) ?? [];
      list.push(w);
      byDate.set(w.date, list);
    }
    return [...byDate.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [history]);

  const loading = familyLoading || scheduleLoading;

  if (loading && sourceWalks.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <WalkieMascot state="excited" size={104} accessibilityLabel="Walkie Doggy טוען" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <ErrorState message={error} onRetry={() => loadSchedule(familyId)} />
      </SafeAreaView>
    );
  }

  // BATCH 3 (Task 4 — navigation visibility, requirement: "If a user
  // reaches a protected screen through stale navigation/deep-link/state
  // restoration, the screen/action must still enforce the permission"):
  // RootNavigator already omits this screen's tab when the effective
  // member lacks view_history, but that's a convenience, not the
  // boundary. CORRECTED (Batch 3 correction #1/#2, post-review): this is
  // now a REAL boundary, not just hidden UI — two independent checks, both
  // must pass:
  //   1. canAccessHistoryScreen() fails closed while permissionOverrides
  //      hasn't finished loading (or failed to load) rather than treating
  //      "not loaded yet" as "no override -> allowed".
  //   2. historyAccessStatus reflects the actual server-side
  //      list_history_walks() (migration 0027) response — 'checking'
  //      blocks exactly like 'denied' (fail closed while unverified), and
  //      a bypassed/stale/tampered client-side permission state still
  //      cannot grant access here, because the RPC re-verifies it fresh.
  // CORRECTED FURTHER (review #2): historyAccessStatus is no longer just a
  // probe result — it also gates whether historyDataset (this screen's
  // actual data source below) is trustworthy to render from at all.
  // CORRECTED FURTHER (review #3): a background refocus revalidation
  // ('checking' after a prior 'granted') must not blank an already-verified
  // user's real data with this gate — only a genuine 'denied', or a
  // never-yet-granted 'checking' (the real first-load case), should block.
  if (
    !canAccessHistoryScreen(effectiveUserId, permissionOverrides, permissionOverridesStatus) ||
    (historyAccessStatus !== 'granted' && !(historyAccessStatus === 'checking' && hasEverGrantedRef.current))
  ) {
    return (
      <SafeAreaView style={styles.center}>
        <EmptyState emoji="🔒" title="אין לך גישה להיסטוריה" subtitle="פנו למנהל/ת המשפחה אם לדעתכם זו טעות" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, Platform.OS === 'web' && styles.webContent]}>
        <RtlText style={styles.header} accessibilityRole="header" maxFontSizeMultiplier={1.35}>היסטוריה</RtlText>

        <View>
          <RtlText style={styles.sectionTitle}>סיכום שבועי</RtlText>
          <RtlText style={styles.sectionSubtitle}>שקיפות משפחתית, לא תחרות 💛</RtlText>
          <View style={styles.summaryCard}>
            {summaryRanked.map(({ user, count }) => (
              <View key={user.id} style={styles.summaryRow}>
                <RtlText style={styles.summaryCount}>{count} טיולים</RtlText>
                <RtlText style={styles.summaryName} numberOfLines={1}>
                  {user.name}
                </RtlText>
                <Avatar emoji={user.avatar} color={user.color} photoUrl={user.photoUrl} size={36} />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          {/* Section 11: compact/collapsible filter card instead of an
              always-open wall of controls — the range row (the one most
              people actually touch) stays visible; the rest expands on
              demand. */}
          <RtlText style={styles.sectionTitle}>סינון</RtlText>

          {/* PRD §14: "History displays ... with filtering AND SEARCH."
              Free-text search over a walk's note — instant/client-side,
              matching the instant-filter chips below rather than needing a
              submit step. */}
          <TextInput
            value={historySearchQuery}
            onChangeText={setHistorySearchQuery}
            placeholder="חיפוש בהערות הטיול"
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
            textAlign="right"
            returnKeyType="search"
            accessibilityLabel="חיפוש בהערות הטיול"
          />

          <View style={styles.chipRow}>
            {RANGE_LABELS.map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => {
                  if (key === 'custom') {
                    setDraftCustomDate(customDate ?? localDateOnly(new Date()));
                    setCustomPickerOpen(true);
                  } else {
                    setRangeFilter(key);
                  }
                }}
                style={[styles.chip, rangeFilter === key && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: rangeFilter === key }}
              >
                <RtlText style={[styles.chipText, rangeFilter === key && styles.chipTextActive]}>
                  {key === 'custom' && rangeFilter === 'custom' && customDate ? formatHistoryDate(customDate) : label}
                </RtlText>
              </Pressable>
            ))}
          </View>

          {Platform.OS === 'android' && customPickerOpen ? (
            <DateTimePicker
              value={draftCustomDate ? new Date(`${draftCustomDate}T00:00:00`) : new Date()}
              mode="date"
              display="default"
              onChange={(_event: DateTimePickerEvent, selected?: Date) => {
                setCustomPickerOpen(false);
                if (selected) {
                  const value = localDateOnly(selected);
                  setCustomDate(value);
                  setRangeFilter('custom');
                }
              }}
            />
          ) : null}

          <Modal visible={Platform.OS === 'ios' && customPickerOpen} transparent animationType="fade" onRequestClose={() => setCustomPickerOpen(false)}>
            <View style={styles.dateModalBackdrop}>
              <View style={styles.dateModalCard}>
                <RtlText style={styles.dateModalTitle}>בחר תאריך</RtlText>
                <DateTimePicker
                  value={draftCustomDate ? new Date(`${draftCustomDate}T00:00:00`) : new Date()}
                  mode="date"
                  display="inline"
                  onChange={(_event: DateTimePickerEvent, selected?: Date) => {
                    if (selected) setDraftCustomDate(localDateOnly(selected));
                  }}
                />
                <View style={styles.dateModalActions}>
                  <Pressable style={[styles.dateModalButton, styles.dateModalCancel]} onPress={() => setCustomPickerOpen(false)}>
                    <RtlText style={styles.dateModalCancelText}>ביטול</RtlText>
                  </Pressable>
                  <Pressable style={[styles.dateModalButton, styles.dateModalConfirm]} onPress={() => {
                    const value = draftCustomDate ?? localDateOnly(new Date());
                    setCustomDate(value);
                    setRangeFilter('custom');
                    setCustomPickerOpen(false);
                  }}>
                    <RtlText style={styles.dateModalConfirmText}>אישור</RtlText>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          {/*
            RTL/visual polish (final QA round): "עוד ⌄"/"הסתר ⌃" used to sit
            up next to the "סינון" heading, ABOVE the always-visible range
            chip row — visually detached from the member/type filters it
            actually expands, which render further down. Moved to sit
            directly above that expandable content instead, so the toggle
            and what it toggles read as one connected control.
          */}
          <Pressable
            style={styles.filterToggleRow}
            onPress={() => setFiltersExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: filtersExpanded }}
          >
            <RtlText style={styles.filterToggle}>{filtersExpanded ? 'הסתר ⌃' : 'עוד ⌄'}</RtlText>
          </Pressable>

          {filtersExpanded ? (
            <>
              <RtlText style={styles.filterLabel}>לפי בן משפחה</RtlText>
              <View style={styles.chipRow}>
                <Pressable onPress={() => setUserFilter(null)} style={[styles.chip, !userFilter && styles.chipActive]}>
                  <RtlText style={[styles.chipText, !userFilter && styles.chipTextActive]}>הכל</RtlText>
                </Pressable>
                {users.map((u) => (
                  <Pressable
                    key={u.id}
                    onPress={() => setUserFilter(u.id === userFilter ? null : u.id)}
                    style={[styles.chip, userFilter === u.id && styles.chipActive]}
                  >
                    <RtlText style={[styles.chipText, userFilter === u.id && styles.chipTextActive]}>
                      {u.name}{u.removedAt ? ' (הוסר)' : ''}
                    </RtlText>
                  </Pressable>
                ))}
              </View>

              <RtlText style={styles.filterLabel}>סוג</RtlText>
              <View style={styles.chipRow}>
                {(
                  [
                    ['all', 'הכל'],
                    ['planned', 'מתוכנן'],
                    ['unplanned', 'ספונטני'],
                  ] as [PlanFilter, string][]
                ).map(([key, label]) => (
                  <Pressable key={key} onPress={() => setPlanFilter(key)} style={[styles.chip, planFilter === key && styles.chipActive]}>
                    <RtlText style={[styles.chipText, planFilter === key && styles.chipTextActive]}>{label}</RtlText>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.section}>
          <RtlText style={styles.sectionTitle}>היסטוריה · {history.length} טיולים</RtlText>
          {history.length === 0 ? (
            <EmptyState title="אין היסטוריה בטווח הזה" subtitle="נסו לשנות את הסינון, או שחכו לטיול הראשון" />
          ) : (
            <View style={styles.list}>
              {dailySummary.map(([date, dayWalks]) => (
                <View key={date} style={styles.dayGroup}>
                  <RtlText style={styles.dayLabel}>
                    {formatHistoryDate(date)} - {dayWalks.length} טיולים · {dayWalks.filter((w) => w.hadPee).length} 💧 · {dayWalks.filter((w) => w.hadPoop).length} 💩
                  </RtlText>
                  {dayWalks.map((w) => (
                    <View key={w.id} style={styles.historyItem}>
                      <WalkRow
                        walk={w}
                        routeSession={gpsSessions[w.id]}
                        historyCompact
                        responsible={usersById[w.responsibleUserId]}
                        completedBy={w.completedByUserId ? usersById[w.completedByUserId] : undefined}
                        onMarkDone={canResolveWalk(w) ? () => setResolveWalkId(w.id) : undefined}
                        onMarkNotDone={
                          canResolveWalk(w)
                            ? async () => {
                                await skip(w.id);
                                // BATCH 3 CORRECTION #2 (review #2): refresh
                                // the permissioned dataset immediately after
                                // a mutation this screen owns, rather than
                                // waiting for a future focus event.
                                await refreshHistoryDataset();
                              }
                            : undefined
                        }
                        onPress={
                          // Section 2: an unplanned walk owned by the viewer
                          // (or any walk, for an admin) opens the dedicated
                          // edit/delete flow instead of the completed-details
                          // modal — "members can't freely edit another
                          // member's walk; admins can manage family data".
                          w.isUnplanned &&
                          (effectiveRole === 'admin' ||
                            w.responsibleUserId === effectiveUserId ||
                            w.completedByUserId === effectiveUserId)
                            ? () => setEditUnplannedWalkId(w.id)
                            : w.status === 'done' && !w.isUnplanned
                              ? () => setEditWalkId(w.id)
                              : undefined
                        }
                      />
                      {w.note ? <RtlText style={styles.note}>💬 {w.note}</RtlText> : null}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <CompleteWalkModal
        visible={!!resolveWalk}
        dogName={dog?.name ?? 'הכלב/ה'}
        scheduledTime={resolveWalk?.scheduledTime}
        users={activeUsers}
        defaultUserId={effectiveUserId ?? ''}
        onConfirm={async ({ completedByUserId, hadPee, hadPoop, note }) => {
          const walkId = resolveWalkId;
          setResolveWalkId(null);
          if (!walkId) return;
          await markDone(walkId, completedByUserId, { hadPee, hadPoop, note: note || undefined });
          await refreshHistoryDataset();
        }}
        onCancel={() => setResolveWalkId(null)}
      />

      <EditDoneDetailsModal
        visible={!!editWalkId}
        walk={editWalkId ? sourceWalks.find((w) => w.id === editWalkId) ?? null : null}
        currentUserId={effectiveUserId}
        onSave={async (details) => {
          if (editWalkId) {
            await editDoneDetails(editWalkId, details);
            await refreshHistoryDataset();
          }
          setEditWalkId(null);
        }}
        onDelete={effectiveRole === 'admin' ? async (walkId) => {
          setEditWalkId(null);
          await deleteScheduledWalkOccurrence(walkId);
          await refreshHistoryDataset();
        } : undefined}
        onClose={() => setEditWalkId(null)}
      />

      <AddUnplannedWalkModal
        visible={!!editUnplannedWalkId}
        dogName={dog?.name ?? 'הכלב/ה'}
        users={users}
        defaultUserId={effectiveUserId ?? ''}
        canChooseUser={effectiveRole === 'admin'}
        editingWalk={editUnplannedWalkId ? sourceWalks.find((w) => w.id === editUnplannedWalkId) ?? null : null}
        onConfirm={async (result: UnplannedWalkResult) => {
          const walkId = editUnplannedWalkId;
          setEditUnplannedWalkId(null);
          if (walkId) {
            await editUnplannedWalk(walkId, {
              date: result.date,
              scheduledTime: result.time,
              responsibleUserId: result.performedByUserId,
              hadPee: result.hadPee,
              hadPoop: result.hadPoop,
              note: result.note || undefined,
              durationMinutes: result.durationMinutes,
            });
            await refreshHistoryDataset();
          }
        }}
        onDelete={effectiveRole === 'admin' ? async (walkId) => {
          setEditUnplannedWalkId(null);
          await deleteUnplannedWalk(walkId);
          await refreshHistoryDataset();
        } : undefined}
        onClose={() => setEditUnplannedWalkId(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  // Bottom padding increased (final QA round, item F: bottom safe-area/
  // list padding so the last history item isn't hidden behind the tab bar).
  content: { padding: spacing.xl, gap: spacing.xxl, paddingBottom: spacing.xxxl },
  webContent: { maxWidth: breakpoints.desktopContent, alignSelf: 'center', width: '100%' },
  header: { width: '100%', ...typography.screenTitle, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  sectionTitle: { width: '100%', ...typography.sectionTitle, fontSize: 18, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  sectionSubtitle: { width: '100%', fontSize: 13, color: colors.textSecondary, marginTop: 2, marginBottom: 12, textAlign: 'right', writingDirection: 'rtl' },
  summaryCard: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  summaryRow: { flexDirection: 'row', ...nativeDirection('ltr'), alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8 },
  // RTL fix (final QA round, item F): member names had no explicit
  // textAlign at all.
  summaryName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary, textAlign: 'right' },
  summaryCount: { fontSize: 14, fontWeight: '700', color: colors.primary },
  section: { gap: spacing.sm },
  filterLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, textAlign: 'right', marginTop: 6 },
  // RTL/visual polish (final QA round): the toggle now sits directly above
  // the collapsible content it controls (see the JSX comment above its
  // usage) — right-aligned, matching this screen's own reading direction,
  // instead of pinned to the opposite end of a header row far from it.
  filterToggleRow: { width: '100%', marginTop: 4 },
  filterToggle: { width: '100%', fontSize: 13, fontWeight: '700', color: colors.primaryDark, textAlign: 'right', writingDirection: 'rtl' },
  searchInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.md,
    fontSize: 14,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  chipRow: { flexDirection: 'row-reverse', ...nativeDirection('ltr'), flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  list: { gap: spacing.xl },
  dayGroup: { gap: spacing.sm },
  dayLabel: { width: '100%', fontSize: 12, color: colors.textSecondary, fontWeight: '500', textAlign: 'right' },
  historyItem: { gap: 4 },
  note: { fontSize: 12, fontWeight: '400', color: colors.textSecondary, textAlign: 'right', paddingHorizontal: 8 },
  dateModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dateModalCard: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.md },
  dateModalTitle: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  dateModalActions: { flexDirection: 'row', gap: 10 },
  dateModalButton: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dateModalCancel: { backgroundColor: colors.surfaceMuted },
  dateModalConfirm: { backgroundColor: colors.primary },
  dateModalCancelText: { fontSize: 16, fontWeight: '700', color: colors.primaryDark },
  dateModalConfirmText: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
