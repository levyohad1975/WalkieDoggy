import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { Button } from './Button';
import { adminListFamilyActivity, type FamilyActivityRow } from '../lib/requests';

interface AdminActivityModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * "מי מחובר / פעילות אחרונה" — Admin-only. Deliberately does NOT claim true
 * real-time "online" presence: last_seen_at is written by touch_last_seen()
 * on app foreground (see App.tsx), so this is inherently a "last known
 * activity" signal, not a live connection status. No raw auth_user_id or
 * other sensitive identifier is shown — admin_list_family_activity() never
 * returns it (requirement 12).
 */
export function AdminActivityModal({ visible, onClose }: AdminActivityModalProps) {
  const [rows, setRows] = useState<FamilyActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    adminListFamilyActivity()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה בטעינת הנתונים'))
      .finally(() => setLoading(false));
  }, [visible]);

  // touch_last_seen() only fires on app-foreground (see App.tsx) — there is
  // no continuous heartbeat while the app stays open/backgrounded, so
  // "last_seen_at < 5 minutes ago" is NOT reliable proof someone is
  // currently using the app right now. Never word this as "online"/"now" —
  // always "last seen", however recent.
  function freshnessLabel(lastSeenAt: string | null): string {
    if (!lastSeenAt) return 'אין נתוני פעילות';
    const minutesAgo = Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 60000);
    if (minutesAgo < 1) return 'נראה/תה ממש עכשיו';
    if (minutesAgo < 5) return `נראה/תה לפני פחות מ-5 דקות`;
    if (minutesAgo < 60) return `פעיל/ה לאחרונה · לפני ${minutesAgo} דקות`;
    const hoursAgo = Math.round(minutesAgo / 60);
    if (hoursAgo < 24) return `פעיל/ה לאחרונה · לפני ${hoursAgo} שעות`;
    const daysAgo = Math.round(hoursAgo / 24);
    return `לפני ${daysAgo} ימים`;
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="סגירת מי בשימוש במערכת"
      >
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title} accessibilityRole="header">מי בשימוש במערכת</RtlText>
          {loading ? <ActivityIndicator color={colors.primary} accessibilityLabel="טוען…" /> : null}
          {error ? (
            <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </RtlText>
          ) : null}
          <ScrollView style={styles.list}>
            {rows.map((r) => (
              <View key={r.user_id} style={styles.row}>
                <RtlText style={styles.rowName}>
                  {r.name}
                  {r.removed_at ? ' (הוסר)' : ''} · {r.role === 'admin' ? 'מנהל' : 'חבר משפחה'}
                </RtlText>
                <RtlText style={styles.rowMeta}>{freshnessLabel(r.last_seen_at)}</RtlText>
              </View>
            ))}
          </ScrollView>
          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '80%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 10 },
  error: { color: colors.statusOverdue, textAlign: 'center', marginBottom: 8 },
  list: { maxHeight: '80%' },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  rowMeta: { fontSize: 12, color: colors.textSecondary, textAlign: 'right', marginTop: 2 },
  closeButton: { marginTop: 14 },
});
