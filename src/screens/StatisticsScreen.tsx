import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
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
 * Section 13: real-data-only graphs/statistics screen. Reads directly from
 * scheduleStore/familyStore on every render (useMemo over the live `walks`
 * array, not a snapshot fetched once) so it always reflects later edits to
 * completed-walk data, per the spec's explicit requirement.
 */
export function StatisticsScreen() {
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const { users, loading: familyLoading, error: familyError, load: loadFamily } = useFamilyStore();
  const { walks, loading: scheduleLoading, error: scheduleError, load: loadSchedule } = useScheduleStore();
  const [period, setPeriod] = useState<StatsPeriod>('7d');

  useEffect(() => {
    loadFamily(familyId);
    loadSchedule(familyId);
  }, [loadFamily, loadSchedule, familyId]);

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const periodWalks = useMemo(() => filterWalksByPeriod(walks, period), [walks, period]);

  const completion = useMemo(() => computeCompletionStats(periodWalks), [periodWalks]);
  const memberDistribution = useMemo(() => computeMemberDistribution(periodWalks), [periodWalks]);
  const plannedVsSpontaneous = useMemo(() => computePlannedVsSpontaneous(periodWalks), [periodWalks]);

  const loading = familyLoading || scheduleLoading;
  const error = familyError || scheduleError;
  const maxMemberCount = Math.max(1, ...memberDistribution.map((m) => m.count));

  if (loading && walks.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <RtlText style={styles.header}>📈 סטטיסטיקה</RtlText>

        <View style={styles.periodRow}>
          {PERIOD_LABELS.map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setPeriod(key)}
              style={[styles.periodChip, period === key && styles.periodChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: period === key }}
              accessibilityLabel={`תקופה: ${label}`}
            >
              <RtlText style={[styles.periodChipText, period === key && styles.periodChipTextActive]}>{label}</RtlText>
            </Pressable>
          ))}
        </View>

        {periodWalks.length === 0 ? (
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
  content: { padding: 20, gap: 16, paddingBottom: 64 },
  header: { width: '100%', fontSize: 22, fontWeight: '800', color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  periodRow: { flexDirection: 'row', direction: 'rtl', gap: 8 },
  periodChip: { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  periodChipActive: { backgroundColor: colors.primary },
  periodChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  periodChipTextActive: { color: colors.textInverse },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  cardTitle: { width: '100%', fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  rowBetween: { flexDirection: 'row', direction: 'rtl', justifyContent: 'space-between' },
  metaText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', textAlign: 'right' },
  // Deliverable 3B — the 4-tile KPI grid (2x2, equal width, wraps via flexWrap
  // so it reads correctly at any phone width without a fixed column count).
  kpiGrid: { flexDirection: 'row', direction: 'rtl', flexWrap: 'wrap', gap: spacing.sm },
  kpiTile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
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
  inlineStat: { flexDirection: 'row', direction: 'rtl', alignItems: 'baseline', gap: 4 },
  metaTextStrong: { fontSize: 13, color: colors.textPrimary, fontWeight: '800' },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
  memberRow: { flexDirection: 'row', direction: 'rtl', alignItems: 'center', gap: 8 },
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
