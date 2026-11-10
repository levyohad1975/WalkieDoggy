import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';
import { listRoutineChangeRequests } from '../lib/routineRequests';
import type { RoutineChangeRequest } from '../logic/routineRequests';

/** How often Home re-checks for routine requests while it is open. */
export const ROUTINE_REQUESTS_HOME_REFRESH_MS = 30000;

/** Requests waiting for this member's answer (or the admin's approval). */
export function routineRequestsWaitingFor(requests: RoutineChangeRequest[], userId: string, isAdmin: boolean): number {
  return requests.filter((r) =>
    (r.status === 'pending_target' && r.targetUserId === userId) || (r.status === 'pending_admin' && isAdmin),
  ).length;
}

/**
 * Owner request 2026-11-10: a routine change request reaches the other member
 * and then the admin. Home shows one line when something waits for this
 * person; tapping it opens "ניהול שגרה", where the request is answered.
 * Renders nothing otherwise.
 */
export function RoutineRequestsHomeCard({ enabled, familyId, userId, isAdmin, onOpen }: {
  enabled: boolean;
  familyId: string | null;
  userId: string | null;
  isAdmin: boolean;
  onOpen: () => void;
}) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!enabled || !familyId || !userId) return;
    listRoutineChangeRequests(familyId)
      .then((rows) => setCount(routineRequestsWaitingFor(rows, userId, isAdmin)))
      .catch(() => { /* offline: keep what we have */ });
  }, [enabled, familyId, userId, isAdmin]);

  useEffect(() => {
    if (!enabled) { setCount(0); return undefined; }
    refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, ROUTINE_REQUESTS_HOME_REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [enabled, refresh]);

  if (count === 0) return null;
  const label = count === 1 ? 'בקשה לשינוי בשגרה ממתינה לך' : `${count} בקשות לשינוי בשגרה ממתינות לך`;
  return (
    <Pressable onPress={onOpen} style={styles.card} accessibilityRole="button" accessibilityLabel={`${label}. פתיחת ניהול השגרה`}>
      <RtlText style={styles.text}>{`🔁 ${label}`}</RtlText>
      <RtlText style={styles.link}>לצפייה ›</RtlText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: '#FFF1E2',
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: '#F08A24',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  text: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  link: { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
});
