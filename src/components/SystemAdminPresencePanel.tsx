import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import {
  familyIdentityParts,
  isOnline,
  listSystemAdminPresence,
  matchesPresenceSearch,
  presenceLabel,
  type PresenceFamily,
} from '../lib/systemAdminPresence';

/** The list refreshes itself while open; members send a heartbeat every 2 minutes. */
const REFRESH_MS = 60_000;

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /42501|permission|verified system admin/i.test(message)
    ? 'הגישה נדחתה. נדרשת התחברות מאומתת כמנהל מערכת.'
    : 'לא ניתן לטעון את הנתונים כרגע. בדקו את החיבור ונסו שוב.';
}

/**
 * "🟢 מי אונליין": every family with the details that tell same-named
 * families apart (invite code, family admins, dogs, verified email) and each
 * member's last activity. "פעיל עכשיו" = seen in the last 5 minutes, the same
 * rule as the green dot inside a family.
 */
export function SystemAdminPresencePanel() {
  const [families, setFamilies] = useState<PresenceFamily[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyOnline, setOnlyOnline] = useState(true);
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFamilies(await listSystemAdminPresence());
      setNow(new Date());
    } catch (e) {
      setError(friendly(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const onlineCount = useMemo(
    () => families.reduce((n, f) => n + f.members.filter((m) => isOnline(m.lastSeenAt, now)).length, 0),
    [families, now]
  );
  const onlineFamilies = useMemo(
    () => families.filter((f) => f.members.some((m) => isOnline(m.lastSeenAt, now))).length,
    [families, now]
  );
  const visible = useMemo(
    () => families
      .filter((f) => matchesPresenceSearch(f, search))
      .filter((f) => !onlyOnline || f.members.some((m) => isOnline(m.lastSeenAt, now))),
    [families, search, onlyOnline, now]
  );

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <RtlText style={styles.sectionTitle}>🟢 מי אונליין</RtlText>
      <RtlText style={styles.summary} testID="presence-summary">
        {`${onlineCount} ${onlineCount === 1 ? 'משתמש פעיל' : 'משתמשים פעילים'} עכשיו · ב-${onlineFamilies} ${onlineFamilies === 1 ? 'משפחה' : 'משפחות'} · מתוך ${families.length} משפחות`}
      </RtlText>
      <RtlText style={styles.hint}>"פעיל עכשיו" = היה באפליקציה ב-5 הדקות האחרונות. מתעדכן כל דקה.</RtlText>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="חיפוש: משפחה, קוד, מנהל, כלב או אימייל"
        placeholderTextColor={colors.textSecondary}
        style={styles.search}
        textAlign="right"
        accessibilityLabel="חיפוש משפחה לפי שם, קוד, מנהל, כלב או אימייל"
      />
      <View style={styles.chips}>
        <Pressable onPress={() => setOnlyOnline(true)} style={[styles.chip, onlyOnline && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: onlyOnline }}>
          <RtlText style={[styles.chipText, onlyOnline && styles.chipTextActive]}>רק מי שאונליין</RtlText>
        </Pressable>
        <Pressable onPress={() => setOnlyOnline(false)} style={[styles.chip, !onlyOnline && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: !onlyOnline }}>
          <RtlText style={[styles.chipText, !onlyOnline && styles.chipTextActive]}>כל המשפחות</RtlText>
        </Pressable>
        <Pressable onPress={() => void load()} style={styles.chip} accessibilityRole="button" accessibilityLabel="רענון רשימת המחוברים">
          <RtlText style={styles.chipText}>↻ רענון</RtlText>
        </Pressable>
      </View>

      {error ? <RtlText style={styles.error} accessibilityRole="alert">{error}</RtlText> : null}
      {loading && families.length === 0 ? <ActivityIndicator color={colors.primary} accessibilityLabel="טוען…" /> : null}
      {!loading && !error && visible.length === 0 ? (
        <RtlText style={styles.hint}>{onlyOnline ? 'אין כרגע אף אחד אונליין.' : 'לא נמצאו משפחות.'}</RtlText>
      ) : null}

      {visible.map((f) => (
        <View key={f.familyId} style={styles.card} testID={`presence-family-${f.familyId}`}>
          <RtlText style={styles.familyName}>{f.familyName}</RtlText>
          <RtlText style={styles.identity}>{familyIdentityParts(f).join(' · ')}</RtlText>
          <View style={styles.members}>
            {f.members
              .filter((m) => !onlyOnline || isOnline(m.lastSeenAt, now))
              .map((m) => {
                const online = isOnline(m.lastSeenAt, now);
                return (
                  <View key={m.userId} style={styles.memberRow}>
                    <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
                    <RtlText style={styles.memberName}>
                      {m.name}{m.role === 'admin' ? ' (מנהל/ת)' : ''}
                    </RtlText>
                    <RtlText style={[styles.memberStatus, online && styles.memberStatusOnline]}>{presenceLabel(m, now)}</RtlText>
                  </View>
                );
              })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 96 },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'right' },
  summary: { ...typography.body, color: colors.success, textAlign: 'right' },
  hint: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  search: {
    ...typography.body,
    fontWeight: '500',
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.xs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { ...typography.meta, color: colors.textPrimary },
  chipTextActive: { color: colors.primaryDark, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, gap: spacing.xs },
  familyName: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },
  identity: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  members: { gap: 6, marginTop: spacing.xs },
  memberRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOnline: { backgroundColor: colors.success },
  dotOffline: { backgroundColor: colors.border },
  memberName: { ...typography.meta, fontSize: 14, color: colors.textPrimary, flex: 1, textAlign: 'right' },
  memberStatus: { ...typography.meta, color: colors.textSecondary },
  memberStatusOnline: { color: colors.success, fontWeight: '700' },
  error: { ...typography.meta, color: colors.danger, textAlign: 'right' },
});
