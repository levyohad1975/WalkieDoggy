import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore, useEffectiveUserId } from '../store/authStore';
import { colors } from '../theme/colors';
import { breakpoints, nativeDirection, radii, spacing, typography } from '../theme/tokens';
import { Avatar } from '../components/Avatar';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { DEMO_FAMILY } from '../data/demoData';
import { repository } from '../data';
import {
  applyStatisticsFilters,
  computeCompletionStats,
  computeDailyTrend,
  computeDistanceStats,
  computeDogDistribution,
  computeDurationStats,
  computeInsights,
  computeMemberDistribution,
  computeOnTimeStats,
  computePlannedVsSpontaneous,
  DEFAULT_STATISTICS_FILTERS,
  formatDistanceMeters,
  periodToDateRange,
  type StatisticsFilters,
  type StatsPeriod,
} from '../logic/statistics';
import { formatHistoryDate, localDateOnly } from '../logic/dateFormat';
import { canAccessStatisticsScreen } from '../logic/permissions';
import { isSupabaseConfigured } from '../lib/supabase';
import { fetchStatisticsWalks } from '../lib/permissionedWalks';
import type { Walk, WalkGpsSession, WalkStatus } from '../types';

const PERIOD_LABELS: [StatsPeriod, string][] = [
  ['7d', '7 ימים'],
  ['30d', '30 ימים'],
  ['all', 'הכל'],
];

const STATUS_LABELS: [WalkStatus | 'all', string][] = [
  ['all', 'הכל'],
  ['done', 'בוצע'],
  ['pending', 'ממתין'],
  ['skipped', 'לא בוצע'],
  ['in_progress', 'בתהליך'],
];

const PLANNED_LABELS: [StatisticsFilters['planned'], string][] = [
  ['all', 'הכל'],
  ['planned', 'מתוכנן'],
  ['adhoc', 'ספונטני'],
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
 * A minimal daily trend sparkline — vertical bars sized relative to the
 * busiest day in range. Plain Views, matching this screen's existing
 * no-chart-library convention. Unlike the member-distribution Bar above
 * (which sits beside a visible name/count RtlText, so the bar itself can
 * stay purely decorative), each point here has no adjacent visible label at
 * all — the bar height is the ONLY representation of that day's count. A
 * screen reader got nothing from this chart before; each point is now its
 * own accessible element with a real date + count description.
 */
function TrendChart({ points }: { points: { date: string; count: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <View style={styles.trendRow}>
      {points.map((p) => (
        <View
          key={p.date}
          style={styles.trendBarWrap}
          accessible
          accessibilityLabel={`${formatHistoryDate(p.date)}: ${p.count} ${p.count === 1 ? 'טיול' : 'טיולים'}`}
        >
          <View style={[styles.trendBar, { height: `${Math.max(6, (p.count / max) * 100)}%` }]} />
        </View>
      ))}
    </View>
  );
}

/**
 * Reports & Insights redesign (Statistics/Settings batch): a real filters +
 * KPIs + trends experience, replacing the old period-chips-only screen.
 * Pee/poop is deliberately NOT a KPI tile here — see computeInsights' own
 * doc comment for where it's allowed to appear (one supplementary sentence).
 *
 * CORRECTED (Batch 3 correction #2, review #2, preserved through this
 * redesign): this screen computes from statisticsDataset — the authorized
 * result of list_statistics_walks() (migration 0027) — never the raw
 * scheduleStore.walks array, because that RLS path is a permission-
 * independent operational window, not a valid bulk-historical source.
 * Reactivity is preserved via useFocusEffect, same as before.
 */
export function StatisticsScreen() {
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const effectiveUserId = useEffectiveUserId();
  const { users, dogs, loading: familyLoading, error: familyError, load: loadFamily, permissionOverrides, permissionOverridesStatus } = useFamilyStore();
  const { walks, loading: scheduleLoading, error: scheduleError, load: loadSchedule } = useScheduleStore();
  const [period, setPeriod] = useState<StatsPeriod>('7d');
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);
  const [filters, setFilters] = useState<StatisticsFilters>(DEFAULT_STATISTICS_FILTERS);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [rangePickerOpen, setRangePickerOpen] = useState<'start' | 'end' | null>(null);
  const [draftRangeDate, setDraftRangeDate] = useState<string | null>(null);
  const [gpsSessions, setGpsSessions] = useState<WalkGpsSession[]>([]);

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
  const dogsById = useMemo(() => Object.fromEntries(dogs.map((d) => [d.id, d])), [dogs]);

  // periodToDateRange() allocates a brand-new { start, end } object on every
  // call (never null unless period === 'all') — computing it directly in
  // the render body gave `dateRange` a new reference on every single
  // render, which cascaded through effectiveFilters -> filteredWalks (both
  // memoized on reference equality) into the GPS-sessions effect below
  // (dependent on filteredWalks), whose setGpsSessions() call triggered
  // another render, recomputing dateRange again — an infinite render loop
  // that pegged the CPU and crashed the tab. Memoizing on the actual
  // primitive inputs (period, customRange) keeps the reference stable
  // across renders that don't change either.
  const dateRange = useMemo(
    () => (period === 'all' ? customRange : periodToDateRange(period)),
    [period, customRange]
  );
  const effectiveFilters = useMemo<StatisticsFilters>(() => ({ ...filters, dateRange }), [filters, dateRange]);
  const filteredWalks = useMemo(() => applyStatisticsFilters(sourceWalks, effectiveFilters), [sourceWalks, effectiveFilters]);

  // Distance is an optional KPI (see computeDistanceStats' own doc comment)
  // — best-effort fetch, never blocking the rest of the screen. Bulk query
  // scoped to exactly the walks currently in view.
  useEffect(() => {
    const doneWalkIds = filteredWalks.filter((w) => w.status === 'done').map((w) => w.id);
    if (doneWalkIds.length === 0) {
      setGpsSessions([]);
      return;
    }
    let cancelled = false;
    repository
      .getGpsSessionsForWalkIds(doneWalkIds)
      .then((sessions) => {
        if (!cancelled) setGpsSessions(sessions);
      })
      .catch(() => {
        if (!cancelled) setGpsSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [filteredWalks]);

  const completion = useMemo(() => computeCompletionStats(filteredWalks), [filteredWalks]);
  const memberDistribution = useMemo(() => computeMemberDistribution(filteredWalks), [filteredWalks]);
  const dogDistribution = useMemo(() => computeDogDistribution(filteredWalks), [filteredWalks]);
  const plannedVsSpontaneous = useMemo(() => computePlannedVsSpontaneous(filteredWalks), [filteredWalks]);
  const onTimeStats = useMemo(() => computeOnTimeStats(filteredWalks), [filteredWalks]);
  const durationStats = useMemo(() => computeDurationStats(filteredWalks), [filteredWalks]);
  const distanceStats = useMemo(() => computeDistanceStats(gpsSessions), [gpsSessions]);
  const trend = useMemo(() => computeDailyTrend(filteredWalks), [filteredWalks]);
  const insights = useMemo(() => computeInsights(filteredWalks, usersById, dogsById), [filteredWalks, usersById, dogsById]);

  const loading = familyLoading || scheduleLoading;
  const error = familyError || scheduleError;
  const maxMemberCount = Math.max(1, ...memberDistribution.map((m) => m.count));
  const maxDogCount = Math.max(1, ...dogDistribution.map((m) => m.count));

  const openRangePicker = (which: 'start' | 'end') => {
    setDraftRangeDate((which === 'start' ? customRange?.start : customRange?.end) ?? localDateOnly(new Date()));
    setRangePickerOpen(which);
  };
  const confirmRangePicker = (value: string) => {
    setCustomRange((prev) => {
      const base = prev ?? { start: value, end: value };
      return rangePickerOpen === 'start' ? { ...base, start: value } : { ...base, end: value };
    });
    setPeriod('all');
    setRangePickerOpen(null);
  };

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
        <View style={styles.hero}>
          <RtlText style={styles.header} accessibilityRole="header">סטטיסטיקה ותובנות</RtlText>
          <RtlText style={styles.headerSubtitle}>תמונה ברורה של הטיולים, הזמנים והחלוקה המשפחתית</RtlText>
        </View>

        <RtlText style={styles.filterLabel}>טווח זמן</RtlText>
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

        <View style={styles.customRangeRow}>
          <Pressable style={styles.customRangeButton} onPress={() => openRangePicker('start')} accessibilityRole="button">
            <RtlText style={styles.customRangeButtonText}>
              מ: {customRange?.start ?? '—'}
            </RtlText>
          </Pressable>
          <Pressable style={styles.customRangeButton} onPress={() => openRangePicker('end')} accessibilityRole="button">
            <RtlText style={styles.customRangeButtonText}>
              עד: {customRange?.end ?? '—'}
            </RtlText>
          </Pressable>
          {customRange ? (
            <Pressable
              style={styles.customRangeClear}
              onPress={() => {
                setCustomRange(null);
                setPeriod('7d');
              }}
              accessibilityRole="button"
              accessibilityLabel="נקה טווח תאריכים מותאם"
            >
              <RtlText style={styles.customRangeClearText}>✕</RtlText>
            </Pressable>
          ) : null}
        </View>

        {Platform.OS === 'android' && rangePickerOpen ? (
          <DateTimePicker
            value={draftRangeDate ? new Date(`${draftRangeDate}T00:00:00`) : new Date()}
            mode="date"
            display="default"
            onChange={(_event: DateTimePickerEvent, selected?: Date) => {
              if (selected) confirmRangePicker(localDateOnly(selected));
              else setRangePickerOpen(null);
            }}
          />
        ) : null}

        <Modal visible={Platform.OS === 'ios' && !!rangePickerOpen} transparent animationType="fade" onRequestClose={() => setRangePickerOpen(null)}>
          <View style={styles.dateModalBackdrop}>
            <View style={styles.dateModalCard}>
              <RtlText style={styles.dateModalTitle}>{rangePickerOpen === 'start' ? 'תאריך התחלה' : 'תאריך סיום'}</RtlText>
              <DateTimePicker
                value={draftRangeDate ? new Date(`${draftRangeDate}T00:00:00`) : new Date()}
                mode="date"
                display="inline"
                onChange={(_event: DateTimePickerEvent, selected?: Date) => {
                  if (selected) setDraftRangeDate(localDateOnly(selected));
                }}
              />
              <View style={styles.dateModalActions}>
                <Pressable style={[styles.dateModalButton, styles.dateModalCancel]} onPress={() => setRangePickerOpen(null)}>
                  <RtlText style={styles.dateModalCancelText}>ביטול</RtlText>
                </Pressable>
                <Pressable
                  style={[styles.dateModalButton, styles.dateModalConfirm]}
                  onPress={() => confirmRangePicker(draftRangeDate ?? localDateOnly(new Date()))}
                >
                  <RtlText style={styles.dateModalConfirmText}>אישור</RtlText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Pressable
          style={styles.filterToggleRow}
          onPress={() => setFiltersExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersExpanded }}
        >
          <RtlText style={styles.filterToggleText}>{filtersExpanded ? 'הסתר סינון מתקדם ⌃' : 'סינון מתקדם ⌄'}</RtlText>
        </Pressable>

        {filtersExpanded ? (
          <View style={styles.advancedFilters}>
            {dogs.length > 1 ? (
              <View style={styles.filterGroup}>
                <RtlText style={styles.filterGroupLabel}>כלב</RtlText>
                <View style={styles.chipRow}>
                  <Pressable
                    style={[styles.chip, !filters.dogId && styles.chipActive]}
                    onPress={() => setFilters((f) => ({ ...f, dogId: null }))}
                    accessibilityRole="button"
                  >
                    <RtlText style={[styles.chipText, !filters.dogId && styles.chipTextActive]}>הכל</RtlText>
                  </Pressable>
                  {dogs.map((d) => (
                    <Pressable
                      key={d.id}
                      style={[styles.chip, filters.dogId === d.id && styles.chipActive]}
                      onPress={() => setFilters((f) => ({ ...f, dogId: f.dogId === d.id ? null : d.id }))}
                      accessibilityRole="button"
                    >
                      <RtlText style={[styles.chipText, filters.dogId === d.id && styles.chipTextActive]}>{d.name}</RtlText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.filterGroup}>
              <RtlText style={styles.filterGroupLabel}>בן/בת משפחה</RtlText>
              <View style={styles.chipRow}>
                <Pressable
                  style={[styles.chip, !filters.memberId && styles.chipActive]}
                  onPress={() => setFilters((f) => ({ ...f, memberId: null }))}
                  accessibilityRole="button"
                >
                  <RtlText style={[styles.chipText, !filters.memberId && styles.chipTextActive]}>הכל</RtlText>
                </Pressable>
                {users.map((u) => (
                  <Pressable
                    key={u.id}
                    style={[styles.chip, filters.memberId === u.id && styles.chipActive]}
                    onPress={() => setFilters((f) => ({ ...f, memberId: f.memberId === u.id ? null : u.id }))}
                    accessibilityRole="button"
                  >
                    <RtlText style={[styles.chipText, filters.memberId === u.id && styles.chipTextActive]}>{u.name}</RtlText>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.filterGroup}>
              <RtlText style={styles.filterGroupLabel}>סטטוס</RtlText>
              <View style={styles.chipRow}>
                {STATUS_LABELS.map(([key, label]) => (
                  <Pressable
                    key={key}
                    style={[styles.chip, filters.status === key && styles.chipActive]}
                    onPress={() => setFilters((f) => ({ ...f, status: key }))}
                    accessibilityRole="button"
                  >
                    <RtlText style={[styles.chipText, filters.status === key && styles.chipTextActive]}>{label}</RtlText>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.filterGroup}>
              <RtlText style={styles.filterGroupLabel}>סוג</RtlText>
              <View style={styles.chipRow}>
                {PLANNED_LABELS.map(([key, label]) => (
                  <Pressable
                    key={key}
                    style={[styles.chip, filters.planned === key && styles.chipActive]}
                    onPress={() => setFilters((f) => ({ ...f, planned: key }))}
                    accessibilityRole="button"
                  >
                    <RtlText style={[styles.chipText, filters.planned === key && styles.chipTextActive]}>{label}</RtlText>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        ) : null}

        {filteredWalks.length === 0 ? (
          <EmptyState emoji="📈" title="אין עדיין נתונים בטווח או בסינון הזה" subtitle="הסטטיסטיקה תתמלא ככל שיירשמו טיולים" />
        ) : (
          <>
            <View style={styles.kpiGrid}>
              <View style={styles.kpiTile}>
                <RtlText style={[styles.kpiValue, styles.ltrText]}>{completion.total}</RtlText>
                <RtlText style={[styles.kpiLabel, styles.rtlText]}>סה״כ טיולים</RtlText>
              </View>
              <View style={styles.kpiTile}>
                <RtlText style={[styles.kpiValue, styles.kpiValueDone, styles.ltrText]}>{completion.done}</RtlText>
                <RtlText style={[styles.kpiLabel, styles.rtlText]}>בוצעו</RtlText>
                <RtlText style={[styles.kpiSubValue, styles.ltrText]}>{completion.donePercentOfResolved}%</RtlText>
              </View>
              <View style={styles.kpiTile}>
                <RtlText style={[styles.kpiValue, styles.ltrText]}>{onTimeStats.onTimePercent}%</RtlText>
                <RtlText style={[styles.kpiLabel, styles.rtlText]}>בזמן</RtlText>
                {onTimeStats.onTime + onTimeStats.late > 0 ? (
                  <RtlText style={[styles.kpiSubValue, styles.rtlText]}>{onTimeStats.onTime + onTimeStats.late} רלוונטיים</RtlText>
                ) : null}
              </View>
              <View style={styles.kpiTile}>
                <RtlText style={[styles.kpiValue, styles.ltrText]}>
                  {durationStats.averageMinutes ?? '—'}
                </RtlText>
                <RtlText style={[styles.kpiLabel, styles.rtlText]}>דקות בממוצע</RtlText>
              </View>
              {distanceStats.sessionCount > 0 ? (
                <View style={styles.kpiTile}>
                  <RtlText style={[styles.kpiValue, styles.ltrText]}>{formatDistanceMeters(distanceStats.totalMeters)}</RtlText>
                  <RtlText style={[styles.kpiLabel, styles.rtlText]}>מרחק כולל</RtlText>
                </View>
              ) : null}
              <View style={styles.kpiTile}>
                <RtlText style={[styles.kpiValue, styles.ltrText]}>{plannedVsSpontaneous.spontaneous}</RtlText>
                <RtlText style={[styles.kpiLabel, styles.rtlText]}>ספונטניים</RtlText>
              </View>
            </View>

            {trend.length > 1 ? (
              <View style={styles.card}>
                <RtlText style={styles.cardTitle}>מגמה יומית</RtlText>
                <TrendChart points={trend} />
              </View>
            ) : null}

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
                      <RtlText style={[styles.memberCount, styles.ltrText]}>{count}</RtlText>
                    </View>
                  );
                })
              )}
            </View>

            {dogs.length > 1 && dogDistribution.length > 0 ? (
              <View style={styles.card}>
                <RtlText style={styles.cardTitle}>התפלגות בין כלבים</RtlText>
                {dogDistribution.map(({ dogId, count }) => {
                  const dog = dogsById[dogId];
                  return (
                    <View key={dogId} style={styles.memberRow}>
                      <RtlText style={[styles.memberName, styles.rtlText]} numberOfLines={1}>
                        {dog?.name ?? 'לא ידוע'}
                      </RtlText>
                      <View style={styles.memberBarWrap}>
                        <Bar percent={(count / maxDogCount) * 100} color={colors.primary} />
                      </View>
                      <RtlText style={[styles.memberCount, styles.ltrText]}>{count}</RtlText>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.card}>
              <RtlText style={styles.cardTitle}>מתוכנן לעומת ספונטני</RtlText>
              <View style={styles.rowBetween}>
                <View style={styles.inlineStat}>
                  <RtlText style={[styles.metaText, styles.rtlText]}>ספונטני</RtlText>
                  <RtlText style={[styles.metaTextStrong, styles.ltrText]}>{plannedVsSpontaneous.spontaneous}</RtlText>
                </View>
                <View style={styles.inlineStat}>
                  <RtlText style={[styles.metaText, styles.rtlText]}>מתוכנן</RtlText>
                  <RtlText style={[styles.metaTextStrong, styles.ltrText]}>{plannedVsSpontaneous.planned}</RtlText>
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

            {insights.length > 0 ? (
              <View style={styles.card}>
                <RtlText style={styles.cardTitle}>תובנות</RtlText>
                {insights.map((line, i) => (
                  <RtlText key={i} style={[styles.insightText, styles.rtlText]}>
                    {line}
                  </RtlText>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  webContent: { maxWidth: breakpoints.desktopContent, alignSelf: 'center', width: '100%' },
  hero: { width: '100%', gap: spacing.xs, paddingTop: spacing.xs },
  header: { width: '100%', ...typography.screenTitle, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  headerSubtitle: { width: '100%', ...typography.meta, color: colors.textSecondary, textAlign: 'right', writingDirection: 'rtl' },
  filterLabel: { width: '100%', ...typography.meta, fontWeight: '700', color: colors.textSecondary, textAlign: 'right', writingDirection: 'rtl', marginBottom: -spacing.sm },
  periodRow: { flexDirection: 'row', ...nativeDirection('rtl'), gap: spacing.xs, backgroundColor: colors.surfaceMuted, borderRadius: radii.lg, padding: spacing.xs },
  periodChip: { flex: 1, backgroundColor: 'transparent', borderRadius: radii.md, paddingVertical: spacing.sm, alignItems: 'center' },
  periodChipActive: { backgroundColor: colors.primary },
  periodChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  periodChipTextActive: { color: colors.textInverse },
  customRangeRow: { flexDirection: 'row', ...nativeDirection('rtl'), gap: spacing.sm, alignItems: 'center' },
  customRangeButton: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, alignItems: 'center' },
  customRangeButtonText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary, writingDirection: 'rtl' },
  customRangeClear: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  customRangeClearText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  filterToggleRow: { alignItems: 'center', paddingVertical: spacing.xs },
  filterToggleText: { fontSize: 13, fontWeight: '700', color: colors.primaryDark, writingDirection: 'rtl' },
  advancedFilters: { gap: spacing.md, backgroundColor: colors.surfaceMuted, borderRadius: radii.lg, padding: spacing.md },
  filterGroup: { gap: spacing.xs },
  filterGroupLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'right', writingDirection: 'rtl' },
  chipRow: { flexDirection: 'row', ...nativeDirection('rtl'), flexWrap: 'wrap', gap: spacing.xs },
  chip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.round, paddingVertical: 6, paddingHorizontal: 12 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  dateModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  dateModalCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md, width: '100%', maxWidth: 340 },
  dateModalTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  dateModalActions: { flexDirection: 'row', ...nativeDirection('rtl'), gap: spacing.sm },
  dateModalButton: { flex: 1, borderRadius: radii.md, paddingVertical: spacing.sm, alignItems: 'center' },
  dateModalCancel: { backgroundColor: colors.surfaceMuted },
  dateModalCancelText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  dateModalConfirm: { backgroundColor: colors.primary },
  dateModalConfirmText: { fontSize: 13, fontWeight: '700', color: colors.textInverse },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { width: '100%', ...typography.cardTitle, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  rowBetween: { flexDirection: 'row', ...nativeDirection('rtl'), justifyContent: 'space-between' },
  metaText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', textAlign: 'right' },
  kpiGrid: { flexDirection: 'row', ...nativeDirection('rtl'), flexWrap: 'wrap', gap: spacing.sm },
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
  trendRow: { flexDirection: 'row', ...nativeDirection('ltr'), alignItems: 'flex-end', height: 64, gap: 4 },
  trendBarWrap: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  trendBar: { width: '100%', minHeight: 4, borderRadius: 3, backgroundColor: colors.primary },
  insightText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600', textAlign: 'right', lineHeight: 19 },
  ltrText: { writingDirection: 'ltr' },
  rtlText: { writingDirection: 'rtl' },
});
