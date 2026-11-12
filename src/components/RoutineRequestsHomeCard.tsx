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
export function routineRequestsWaitingFor(requests: RoutineChangeRequest[], userId: string, isAdmin: boolean): RoutineChangeRequest[] {
  return requests.filter((r) =>
    (r.status === 'pending_target' && r.targetUserId === userId) || (r.status === 'pending_admin' && isAdmin),
  );
}

/**
 * The family's routine change requests for Home (the card and the 🔔 bell),
 * refreshed every 30 s while the app is in front and whenever it returns.
 */
export function useRoutineChangeRequests(enabled: boolean, familyId: string | null): RoutineChangeRequest[] {
  const [rows, setRows] = useState<RoutineChangeRequest[]>([]);
  const refresh = useCallback(() => {
    if (!enabled || !familyId) return;
    listRoutineChangeRequests(familyId)
      .then(setRows)
      .catch(() => { /* offline: keep what we have */ });
  }, [enabled, familyId]);

  useEffect(() => {
    if (!enabled) { setRows([]); return undefined; }
    refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, ROUTINE_REQUESTS_HOME_REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [enabled, refresh]);

  return rows;
}

/**
 * Owner request 2026-11-10: a routine change request reaches the other member
 * and then the admin. Home shows one line when something waits for this
 * person; tapping it opens "ניהול שגרה", where the request is answered.
 * Renders nothing otherwise.
 */
export function RoutineRequestsHomeCard({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count === 0) return null;
  // Routine changes and one-off "take my walk" requests (2026-11-12).
  const label = count === 1 ? 'בקשה בשגרת הטיולים ממתינה לך' : `${count} בקשות בשגרת הטיולים ממתינות לך`;
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
