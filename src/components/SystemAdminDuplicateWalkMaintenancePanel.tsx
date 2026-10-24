import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';
import { friendlyErrorMessage } from '../lib/errorMessages';
import {
  listDuplicateWalkMaintenanceAuthorizations,
  resolveDuplicateWalkMaintenanceAuthorization,
  type DuplicateWalkMaintenanceAuthorization,
} from '../lib/systemAdmin';

/**
 * Staging maintenance for a verified System Admin (PR #150). Lists only the
 * owner-approved authorizations stored server-side and applies one with an
 * explicit two-step confirmation. The server marks the named walks as
 * resolved duplicates (no canonical walk); it never deletes walk or GPS data.
 */
export function SystemAdminDuplicateWalkMaintenancePanel() {
  const [items, setItems] = useState<DuplicateWalkMaintenanceAuthorization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listDuplicateWalkMaintenanceAuthorizations());
    } catch (e) {
      setItems([]);
      setError(friendlyErrorMessage(e, [], 'לא הצלחנו לטעון את הרשאות התחזוקה. לא בוצע שום שינוי.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const resolve = async (item: DuplicateWalkMaintenanceAuthorization) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(item.authorizationId);
    setError(null);
    setResult(null);
    try {
      const groupId = await resolveDuplicateWalkMaintenanceAuthorization(item.authorizationId);
      setResult(`סומנו ${item.walkIds.length} טיולים ככפילויות. מזהה ביקורת: ${groupId}`);
      setConfirmId(null);
      await refresh();
    } catch (e) {
      setError(friendlyErrorMessage(e, [], 'הסימון לא בוצע. אם החיבור נותק, אפשר לנסות שוב בבטחה — אותה פעולה לא תבוצע פעמיים.'));
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  };

  return (
    <View style={styles.card} accessibilityLabel="תחזוקת Staging: טיולים פעילים כפולים">
      <RtlText style={styles.title} accessibilityRole="header">תחזוקת Staging — טיולים פעילים כפולים</RtlText>
      <RtlText style={styles.line}>מסמן רק טיולים שאושרו מראש ככפילויות. שום טיול, זמן, שיוך או נתון GPS לא נמחק או משתנה.</RtlText>
      {loading ? <ActivityIndicator accessibilityLabel="טוען…" /> : null}
      {error ? <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</RtlText> : null}
      {result ? <RtlText style={styles.success} accessibilityRole="alert" accessibilityLiveRegion="polite">{result}</RtlText> : null}
      {!loading && !error && items.length === 0 ? <RtlText style={styles.line}>אין הרשאות תחזוקה פתוחות.</RtlText> : null}
      {items.map((item: DuplicateWalkMaintenanceAuthorization) => {
        const consumed = Boolean(item.consumedAt);
        const expired = !consumed && new Date(item.expiresAt).getTime() <= Date.now();
        const ready = !consumed && !expired && item.unresolvedActiveCount === item.walkIds.length;
        return (
          <View key={item.authorizationId} style={styles.item}>
            <RtlText style={styles.itemTitle}>{item.familyName} · {item.dogName}</RtlText>
            <RtlText style={styles.meta}>משפחה: {item.familyId}</RtlText>
            <RtlText style={styles.meta}>טיולים: {item.walkIds.join(', ')}</RtlText>
            <RtlText style={styles.meta}>פעילים שטרם טופלו: {item.unresolvedActiveCount} מתוך {item.walkIds.length}</RtlText>
            <RtlText style={styles.meta}>{item.reason}</RtlText>
            <RtlText style={styles.meta}>
              {consumed ? `בוצע · מזהה ביקורת ${item.consumedGroupId}` : expired ? 'פג תוקף — נדרש אישור חדש' : `בתוקף עד ${item.expiresAt}`}
            </RtlText>
            {ready && confirmId !== item.authorizationId ? (
              <Button label="סמן ככפילויות (ללא מחיקה)" onPress={() => setConfirmId(item.authorizationId)} disabled={Boolean(busyId)} />
            ) : null}
            {ready && confirmId === item.authorizationId ? (
              <>
                <RtlText style={styles.warning}>אישור סופי: {item.walkIds.length} הטיולים יסומנו ככפילויות ללא טיול קנוני. הפעולה נרשמת ביומן המערכת.</RtlText>
                <Button
                  label={busyId === item.authorizationId ? 'מסמנים…' : 'אישור סופי'}
                  onPress={() => void resolve(item)}
                  disabled={Boolean(busyId)}
                />
                <Button label="ביטול" variant="secondary" onPress={() => setConfirmId(null)} disabled={Boolean(busyId)} />
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm, marginBottom: spacing.lg },
  title: { fontSize: 17, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  line: { color: colors.textSecondary, textAlign: 'right' },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs },
  itemTitle: { fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  meta: { color: colors.textSecondary, fontSize: 12, textAlign: 'right' },
  warning: { color: colors.warning, fontWeight: '700', textAlign: 'right' },
  error: { color: colors.danger, textAlign: 'right' },
  success: { color: colors.success, fontWeight: '700', textAlign: 'right' },
});
