import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { decideDeviceAccessRequest, listAdminDeviceAccessRequests, type AdminDeviceAccessRequest } from '../lib/deviceAccess';

/** How often Home re-checks for new-device requests while it is open. */
export const DEVICE_ACCESS_ADMIN_REFRESH_MS = 20000;

/**
 * Owner request 2026-11-03: the family admin approves a family member's new
 * device (e.g. the iPhone home-screen shortcut) with one tap. Renders nothing
 * unless there is a pending request. The server re-checks that the caller is
 * a real family admin.
 */
export function DeviceAccessRequestsCard({ enabled }: { enabled: boolean }) {
  const [requests, setRequests] = useState<AdminDeviceAccessRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!enabled) return;
    listAdminDeviceAccessRequests().then(setRequests).catch(() => { /* offline: keep what we have */ });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setRequests([]); return undefined; }
    refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, DEVICE_ACCESS_ADMIN_REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [enabled, refresh]);

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    setError(null);
    try {
      await decideDeviceAccessRequest(id, approve);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(friendlyErrorMessage(e));
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (!enabled || requests.length === 0) return null;

  return (
    <View style={styles.card} accessibilityLabel="בקשות התחברות ממכשיר חדש">
      <RtlText style={styles.title} accessibilityRole="header">📲 בקשת התחברות ממכשיר חדש</RtlText>
      {requests.map((r) => (
        <View key={r.id} style={styles.row}>
          <RtlText style={styles.text}>
            {`${r.targetAvatar ? `${r.targetAvatar} ` : ''}${r.targetName} מבקש/ת להתחבר מ${r.device ? `${r.device} ` : ''}מכשיר חדש. לאשר רק אם זה באמת ${r.targetName}.`}
          </RtlText>
          <View style={styles.actions}>
            <Button label="✓ אישור" onPress={() => void decide(r.id, true)} loading={busyId === r.id} disabled={busyId !== null} style={styles.flex} compact />
            <Button label="דחייה" variant="secondary" onPress={() => void decide(r.id, false)} disabled={busyId !== null} style={styles.flex} compact />
          </View>
        </View>
      ))}
      {error ? <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</RtlText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.xs, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary, gap: spacing.sm },
  title: { fontSize: typography.body.fontSize, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  row: { gap: spacing.sm },
  text: { fontSize: typography.cardTitle.fontSize, lineHeight: 21, color: colors.textSecondary, textAlign: 'right' },
  actions: { flexDirection: 'row-reverse', gap: spacing.sm },
  flex: { flex: 1 },
  error: { color: colors.statusOverdue, fontSize: typography.meta.fontSize, textAlign: 'right', fontWeight: '600' },
});
