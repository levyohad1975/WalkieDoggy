import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore, useEffectiveUserId } from '../store/authStore';
import { colors } from '../theme/colors';
import { breakpoints, nativeDirection, radii, spacing, typography } from '../theme/tokens';
import { Avatar } from '../components/Avatar';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { DEMO_FAMILY } from '../data/demoData';
import {
  computeCompletionStats,
  computeMemberDistribution,
  computePlannedVsSpontaneous,
  filterWalksByPeriod,
  type StatsPeriod,
} from '../logic/statistics';
import { canAccessStatisticsScreen } from '../logic/permissions';
import { isSupabaseConfigured } from '../lib/supabase';
import { fetchStatisticsWalks } from '../lib/permissionedWalks';
import type { Walk } from '../types';

const PERIOD_LABELS: [StatsPeriod, string][] = [
  ['7d', '7 ימים'],
  ['30d', '30 ימים'],
  ['all', 'הכל'],
];

/** A horizontal percentage bar built from plain Views — no chart library needed for this app's needs (see final report for why none was added). */
function Bar({ percent, color }: { percent: number; color: string }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: color }]} />
    </View>
  );
}

/**
 * Section 13: real-data-only graphs/statistics screen.
 *
 * CORRECTED (Batch 3 correction #2, review #2): this screen used to read
 * directly from scheduleStore's live `walks` array (a useMemo over it, not
 * a snapshot). It now computes from statisticsDataset — the authorized
 * result of list_statistics_walks() (migration 0027) — because the raw
 * `walks` RLS path (what scheduleStore reads) is deliberately restricted to
 * an operational window and no longer a valid source of bulk historical
 * data for anyone, permitted or not (see 0027's own comment). Reactivity is
 * preserved via useFocusEffect (the same established pattern HomeScreen.tsx
 * already uses for its own refetch-on-return-to-tab): this screen has no
 * mutations of its own, so a refetch on every focus is what keeps it
 * reflecting edits made elsewhere (History, Home) while this tab wasn't
 * active, without falling back to unrestricted raw historical access just
 * to stay live.
 */
export function StatisticsScreen() {
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const effectiveUserId = useEffectiveUserId();
  const { users, loading: familyLoading, error: familyError, load: loadFamily, permissionOverrides, permissionOverridesStatus } = useFamilyStore();
  const { walks, loading: scheduleLoading, error: scheduleError, load: loadSchedule } = useScheduleStore();
  const [period, setPeriod] = useState<StatsPeriod>('7d');
  const [memberFilter, setMemberFilter] = useState<string>('all');
  const [walkTypeFilter, setWalkTypeFilter] = useState<'all' | 'planned' | 'spontaneous'>('all');

  // BATCH 3 CORRECTION #2 (review #2): the actual display/calculation
  // dataset — see this file's own doc comment above. statisticsAccessStatus
  // doubles as the fetch-in-flight/denied signal AND the real
  // server-authoritative gate (list_statistics_walks() itself raises unless
  // has_member_permission('view_statistics') is true for the caller).
  const [statisticsDataset, setStatisticsDataset] = useState<Walk[]>([]);
  const [statisticsAccessStatus, setStatisticsAccessStatus] = useState<'checking' | 'granted' | 'denied'>(
    isSupabaseConfigured ? 'checking' : 'granted'
  );
  // Tracks whether a prior refreshStatisticsDataset() call already landed
  // 'granted' at least once. useFocusEffect below re-runs
  // refreshStatisticsDataset() (and thus resets statisticsAccessStatus to
  // 'checking') on EVERY return to this tab, not just first mount — without
  // this, a background revalidation of an already-authorized user would
  // transiently render the "no access" EmptyState over their already-loaded,
  // still-valid statisticsDataset on every single refocus. Reset to false on
  // a genuine 'denied' so a subsequent refocus is treated as an unverified
  // first check again, not a trusted background refresh.
  const hasEverGrantedRef = useRef(false);

  const refreshStatisticsDataset = useCallback(async () => {
    if (!isSupabaseConfigured) {
      // Local/demo mode: no per-member permission concept and no RPC to
      // call — scheduleStore.walks (unrestricted there) remains the
      // dataset, exactly as before this correction.
      setStatisticsAccessStatus('granted');
      hasEverGrantedRef.current = true;
      return;
    }
    setStatisticsAccessStatus('checking');
    try {
      const rows = await fetchStatisticsWalks();
      setStatisticsDataset(rows);
      setStatisticsAccessStatus('granted');
      hasEverGrantedRef.current = true;
    } catch (e) {
      setStatisticsDataset([]);
      setStatisticsAccessStatus('denied');
      hasEverGrantedRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadFamily(familyId);
    loadSchedule(familyId);
  }, [loadFamily, loadSchedule, familyId]);

  useFocusEffect(
    useCallback(() => {
      void refreshStatisticsDataset();
    }, [refreshStatisticsDataset, familyId, effectiveUserId])
  );

  const sourceWalks = isSupabaseConfigured ? statisticsDataset : walks;

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const periodWalks = useMemo(() => filterWalksByPeriod(sourceWalks, period), [sourceWalks, period]);
  const filteredWalks = useMemo(
    () =>
      periodWalks.filter((walk) => {
        if (memberFilter !== 'all' && walk.responsibleUserId !== memberFilter) return false;
        if (walkTypeFilter === 'planned' && walk.isUnplanned) return false;
        if (walkTypeFilter === 'spontaneous' && !walk.isUnplanned) return false;
        return true;
      }),
    [periodWalks, memberFilter, walkTypeFilter]
  );

  const completion = useMemo(() => computeCompletionStats(filteredWalks), [filteredWalks]);
  const memberDistribution = useMemo(() => computeMemberDistribution(filteredWalks), [filteredWalks]);
  const plannedVsSpontaneous = useMemo(() => computePlannedVsSpontaneous(filteredWalks), [filteredWalks]);

  const loading = familyLoading || scheduleLoading;
  const error = familyError || scheduleError;
  const maxMemberCount = Math.max(1, ...memberDistribution.map((m) => m.count));

  if (loading && sourceWalks.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="טוען…" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <ErrorState message={error} onRetry={() => {}} />
      </SafeAreaView>
    );
  }

  // BATCH 3 (Task 4) — see HistoryScreen.tsx's identical guard for the full
  // reasoning: the hidden nav tab is a convenience, this is the boundary.
  // CORRECTED (Batch 3 correction #1/#2, post-review): two independent
  // checks, both must pass — canAccessStatisticsScreen() fails closed while
  // permissionOverrides hasn't finished loading/failed, and
  // statisticsAccessStatus reflects the actual server-side
  // list_statistics_walks() (migration 0027) response. CORRECTED FURTHER
  // (review #2): statisticsAccessStatus also gates whether statisticsDataset
  // (this screen's actual data source above) is trustworthy to render from.
  // CORRECTED FURTHER (review #3): a background refocus revalidation
  // ('checking' after a prior 'granted') must not blank an already-verified
  // user's real data with this gate — only a genuine 'denied', or a
  // never-yet-granted 'checking' (the real first-load case), should block.
  if (
    !canAccessStatisticsScreen(effectiveUserId, permissionOverrides, permissionOverridesStatus) ||
    (statisticsAccessStatus !== 'granted' && !(statisticsAccessStatus === 'checking' && hasEverGrantedRef.current))
  ) {
    return (
      <SafeAreaView style={styles.center}>
        <EmptyState emoji="🔒" title="אין לך גישה לסטטיסטיקה" subtitle="פנו למנהל/ת המשפחה אם לדעתכם זו טעות" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, Platform.OS === 'web' && styles.webContent]}>
        <View style={styles.headerBlock}>
          <RtlText style={styles.header} accessibilityRole="header">סטטיסטיקה</RtlText>
          <RtlText style={styles.headerSubtitle}>תמונה ברורה של הטיולים והחלוקה במשפחה</RtlText>
        </View>

        <View style={styles.filtersCard}>
          <View style={styles.filterHeaderRow}>
            <RtlText style={styles.filterTitle}>סינון נתונים</RtlText>
            {(period !== '7d' || memberFilter !== 'all' || walkTypeFilter !== 'all') ? (
              <Pressable onPress={() => { setPeriod('7d'); setMemberFilter('all'); setWalkTypeFilter('all'); }}>
                <RtlText style={styles.clearFilters}>איפוס</RtlText>
              </Pressable>
            ) : null}
          </View>

          <RtlText style={styles.filterLabel}>תקופה</RtlText>
          <View style={styles.segmentedRow}>
            {PERIOD_LABELS.map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => setPeriod(key)}
                style={[styles.segment, period === key && styles.segmentActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: period === key }}
                accessibilityLabel={`תקופה: ${label}`}
              >
                <RtlText style={[styles.segmentText, period === key && styles.segmentTextActive]}>{label}</RtlText>
              </Pressable>
            ))}
          </View>

          <RtlText style={styles.filterLabel}>בן משפחה</RtlText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsRow}>
            <Pressable onPress={() => setMemberFilter('all')} style={[styles.filterChip, memberFilter === 'all' && styles.filterChipActive]}>
              <RtlText style={[styles.filterChipText, memberFilter === 'all' && styles.filterChipTextActive]}>כולם</RtlText>
            </Pressable>
            {users.map((user) => (
              <Pressable key={user.id} onPress={() => setMemberFilter(user.id)} style={[styles.filterChip, memberFilter === user.id && styles.filterChipActive]}>
                <Avatar emoji={user.avatar ?? '🙂'} color={user.color ?? colors.primary} photoUrl={user.photoUrl} size={22} />
                <RtlText style={[styles.filterChipText, memberFilter === user.id && styles.filterChipTextActive]}>{user.name}</RtlText>
              </Pressable>
            ))}
          </ScrollView>

          <RtlText style={styles.filterLabel}>סוג טיול</RtlText>
          <View style={styles.typeRow}>
            {([
              ['all', 'הכל'],
              ['planned', 'מתוכנן'],
              ['spontaneous', 'ספונטני'],
            ] as const).map(([key, label]) => (
              <Pressable key={key} onPress={() => setWalkTypeFilter(key)} style={[styles.typeChip, walkTypeFilter === key && styles.typeChipActive]}>
                <RtlText style={[styles.typeChipText, walkTypeFilter === key && styles.typeChipTextActive]}>{label}</RtlText>
              </Pressable>
            ))}
          </View>
        </View>

        {filteredWalks.length === 0 ? (
          <EmptyState emoji="📈" title="אין עדיין נתונים בטווח הזה" subtitle="הסטטיסטיקה תתמלא ככל שיירשמו טיולים" />
        ) : (
          <>
            {/*
              FINAL CORRECTION PASS — Deliverable 3B: the approved Design 1
              KPI grid — 4 equal tiles (סה״כ טיולים / בוצעו + אחוז ביצוע /
              לא בוצעו / ספונטניים), each a single clear number with its own
              label, instead of the previous single dense "completion" card.
              BIDI: every numeric run stays its own Text pinned to
              styles.ltrText (so digits/percent signs can never be
              reordered by the surrounding RTL layout — the exact bug the
              prior redesign's bidi fix already established the pattern
              for), every Hebrew label its own Text pinned to
              styles.rtlText. NARROW FIX PASS (typecheck): writingDirection
              is a Text `style` property in this project's RN/@types/
              react-native version, not a direct JSX prop — moved into
              these two shared style objects (styles.ltrText/rtlText,
              defined below) rather than 15 repeated inline `{
              writingDirection: 'ltr' }` objects, matching how this file
              already shares kpiValue/kpiLabel/etc. The VISUAL behavior is
              unchanged — same property, same values, just relocated into
              `style`.
            */}
            <View style={styles.kpiGrid}>
              <View style={styles.kpiTile}>
                <RtlText style={[styles.kpiValue, styles.ltrText]}>
                  {completion.total}
                </RtlText>
                <RtlText style={[styles.kpiLabel, styles.rtlText]}>
                  סה״כ טיולים
                </RtlText>
              </View>
              <View style={styles.kpiTile}>
                <RtlText style={[styles.kpiValue, styles.kpiValueDone, styles.ltrText]}>
                  {completion.done}
                </RtlText>
                <RtlText style={[styles.kpiLabel, styles.rtlText]}>
                  בוצעו
                </RtlText>
                <RtlText style={[styles.kpiSubValue, styles.ltrText]}>
                  {completion.donePercentOfResolved}%
                </RtlText>
              </View>
              <View style={styles.kpiTile}>
                <RtlText style={[styles.kpiValue, styles.kpiValueSkipped, styles.ltrText]}>
                  {completion.notDone}
                </RtlText>
                <RtlText style={[styles.kpiLabel, styles.rtlText]}>
                  לא בוצעו
                </RtlText>
              </View>
              <View style={styles.kpiTile}>
                <RtlText style={[styles.kpiValue, styles.ltrText]}>
                  {plannedVsSpontaneous.spontaneous}
                </RtlText>
                <RtlText style={[styles.kpiLabel, styles.rtlText]}>
                  ספונטניים
                </RtlText>
              </View>
            </View>

            <View style={styles.card}>
              <RtlText style={styles.cardTitle}>התפלגות בין בני המשפחה</RtlText>
              {memberDistribution.length === 0 ? (
                <RtlText style={styles.metaText}>עדיין אין טיולים שהושלמו בטווח הזה</RtlText>
              ) : (
                memberDistribution.map(({ userId, count }) => {
                  const user = usersById[userId];
                  return (
                    <View key={userId} style={styles.memberRow}>
                      <RtlText style={[styles.memberName, styles.rtlText]} numberOfLines={1}>
                        {user?.name ?? 'לא ידוע'}
                      </RtlText>
                      <Avatar emoji={user?.avatar ?? '🙂'} color={user?.color ?? colors.primary} photoUrl={user?.photoUrl} size={28} />
                      <View style={styles.memberBarWrap}>
                        <Bar percent={(count / maxMemberCount) * 100} color={user?.color ?? colors.primary} />
                      </View>
                      <RtlText style={[styles.memberCount, styles.ltrText]}>
                        {count}
                      </RtlText>
                    </View>
                  );
                })
              )}
            </View>

            <View style={styles.card}>
              <RtlText style={styles.cardTitle}>מתוכנן לעומת ספונטני</RtlText>
              <View style={styles.rowBetween}>
                <View style={styles.inlineStat}>
                  <RtlText style={[styles.metaText, styles.rtlText]}>
                    ספונטני
                  </RtlText>
                  <RtlText style={[styles.metaTextStrong, styles.ltrText]}>
                    {plannedVsSpontaneous.spontaneous}
                  </RtlText>
                </View>
                <View style={styles.inlineStat}>
                  <RtlText style={[styles.metaText, styles.rtlText]}>
                    מתוכנן
                  </RtlText>
                  <RtlText style={[styles.metaTextStrong, styles.ltrText]}>
                    {plannedVsSpontaneous.planned}
                  </RtlText>
                </View>
              </View>
              <Bar
                percent={
                  plannedVsSpontaneous.planned + plannedVsSpontaneous.spontaneous === 0
                    ? 0
                    : (plannedVsSpontaneous.planned / (plannedVsSpontaneous.planned + plannedVsSpontaneous.spontaneous)) * 100
                }
                color={colors.primary}
              />
            </View>

          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  // Bottom padding increased (final QA round, item H: adequate bottom
  // safe-area padding) so the last card clears the tab bar comfortably.
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  webContent: { maxWidth: breakpoints.desktopContent, alignSelf: 'center', width: '100%' },
  headerBlock: { width: '100%', gap: 2 },
  header: { width: '100%', ...typography.screenTitle, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  headerSubtitle: { width: '100%', fontSize: 13, lineHeight: 19, color: colors.textSecondary, fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' },
  filtersCard: { backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 10 },
  filterHeaderRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  filterTitle: { ...typography.cardTitle, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  clearFilters: { fontSize: 12, fontWeight: '800', color: colors.primaryDark },
  filterLabel: { width: '100%', fontSize: 12, fontWeight: '800', color: colors.textSecondary, textAlign: 'right', writingDirection: 'rtl' },
  segmentedRow: { flexDirection: 'row-reverse', backgroundColor: colors.surfaceMuted, borderRadius: 14, padding: 3, gap: 3 },
  segment: { flex: 1, borderRadius: 11, paddingVertical: 9, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface, shadowColor: colors.shadow, shadowOpacity: 0.8, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  segmentTextActive: { color: colors.primaryDark, fontWeight: '900' },
  filterChipsRow: { flexDirection: 'row-reverse', gap: 7, paddingVertical: 1 },
  filterChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 11 },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  filterChipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  filterChipTextActive: { color: colors.primaryDark, fontWeight: '900' },
  typeRow: { flexDirection: 'row-reverse', gap: 7 },
  typeChip: { flex: 1, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  typeChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  typeChipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  typeChipTextActive: { color: colors.textInverse, fontWeight: '900' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { width: '100%', ...typography.cardTitle, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  rowBetween: { flexDirection: 'row', ...nativeDirection('rtl'), justifyContent: 'space-between' },
  metaText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', textAlign: 'right' },
  // Deliverable 3B — the 4-tile KPI grid (2x2, equal width, wraps via flexWrap
  // so it reads correctly at any phone width without a fixed column count).
  kpiGrid: { flexDirection: 'row', ...nativeDirection('rtl'), flexWrap: 'wrap', gap: spacing.sm },
  kpiTile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  kpiValue: { ...typography.statValue, color: colors.textPrimary },
  kpiValueDone: { color: colors.statusDone },
  kpiValueSkipped: { color: colors.statusSkipped },
  kpiLabel: { ...typography.meta, color: colors.textSecondary },
  kpiSubValue: { fontSize: 13, fontWeight: '700', color: colors.statusDone, marginTop: 2 },
  inlineStat: { flexDirection: 'row', ...nativeDirection('rtl'), alignItems: 'baseline', gap: 4 },
  metaTextStrong: { fontSize: 13, color: colors.textPrimary, fontWeight: '800' },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
  memberRow: { flexDirection: 'row', ...nativeDirection('rtl'), alignItems: 'center', gap: 8 },
  memberName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, width: 64, textAlign: 'right' },
  memberBarWrap: { flex: 1 },
  memberCount: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, minWidth: 20, textAlign: 'center' },
  // NARROW FIX PASS (typecheck): writingDirection belongs in the Text
  // `style` object in this project's RN/@types/react-native version, not
  // as a direct JSX prop (`<RtlText writingDirection="ltr">` typechecks under
  // some RN/TS version combinations but not this project's — see this
  // file's own BIDI doc comment above). Shared here instead of 15 repeated
  // inline `{ writingDirection: '...' }` objects, consistent with this
  // file's existing shared-style convention.
  ltrText: { writingDirection: 'ltr' },
  rtlText: { writingDirection: 'rtl' },
});
