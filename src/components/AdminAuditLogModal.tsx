import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { Button } from './Button';
import { adminListAuditLog, type AuditLogRow } from '../lib/requests';

interface AdminAuditLogModalProps {
  visible: boolean;
  onClose: () => void;
}

const ACTION_LABEL: Record<string, string> = {
  swap_request_created: 'בקשת החלפה נוצרה',
  swap_request_approved: 'בקשת החלפה אושרה',
  swap_request_rejected: 'בקשת החלפה נדחתה',
  time_change_request_created: 'בקשת שינוי שעה נוצרה',
  time_change_request_approved: 'בקשת שינוי שעה אושרה',
  time_change_request_rejected: 'בקשת שינוי שעה נדחתה',
  family_member_removed: 'בן משפחה הוסר',
  invite_code_rotated: 'קוד הצטרפות הוחלף',
  profile_edited: 'פרופיל נערך',
  profile_claimed: 'פרופיל נתבע',
  walk_completed: 'טיול הושלם',
  spontaneous_walk_added: 'טיול ספונטני נוסף',
  schedule_rule_created: 'שעה קבועה נוספה',
  schedule_rule_edited: 'שעה קבועה נערכה',
  schedule_rule_deleted: 'שעה קבועה נמחקה',
  member_promoted_to_admin: 'בן משפחה קודם למנהל',
  admin_demoted_to_member: 'מנהל שונה לבן משפחה',
  invite_created: 'הזמנה נוצרה',
  invite_revoked: 'הזמנה בוטלה',
  invite_redeemed: 'הזמנה מומשה',
  profile_pin_set: 'קוד PIN הוגדר',
  profile_pin_cleared: 'קוד PIN הוסר',
  profile_claim_transferred: 'הפרופיל הועבר למכשיר אחר',
  member_permission_override_set: 'הרשאת בן משפחה שונתה',
  member_permission_override_cleared: 'הרשאת בן משפחה הוחזרה לברירת המחדל',
  walk_admin_rescheduled: 'שעת הטיול שונתה על ידי מנהל',
  walk_admin_swapped: 'שני טיולים הוחלפו על ידי מנהל',
  impersonation_started: 'בדיקה כבן משפחה התחילה',
  impersonation_ended: 'בדיקה כבן משפחה הסתיימה',
};

const PAGE_SIZE = 50;

/**
 * Admin-only audit trail viewer (requirement 13). Paginated (not an
 * unbounded list) via admin_list_audit_log(limit, offset). This is a
 * server-authored security log, distinct from the user-facing History
 * screen — it exists so an Admin can answer "who did what, when" even for
 * actions History doesn't show (requests, invite rotation, profile edits).
 */
export function AdminAuditLogModal({ visible, onClose }: AdminAuditLogModalProps) {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!visible) {
      setRows([]);
      setPage(0);
      setHasMore(true);
      return;
    }
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function load(pageToLoad: number) {
    setLoading(true);
    setError(null);
    adminListAuditLog(PAGE_SIZE, pageToLoad * PAGE_SIZE)
      .then((newRows) => {
        if (pageToLoad === 0) {
          setRows(newRows);
        } else {
          setRows((prev) => [...prev, ...newRows]);
        }
        setHasMore(newRows.length === PAGE_SIZE);
        setPage(pageToLoad);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה בטעינת יומן הפעילות'))
      .finally(() => setLoading(false));
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="סגירת יומן פעילות"
      >
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title}>יומן פעילות</RtlText>
          {error ? <RtlText style={styles.error}>{error}</RtlText> : null}
          <ScrollView style={styles.list}>
            {rows.map((r) => (
              <View key={r.id} style={styles.row}>
                <RtlText style={styles.rowAction}>{ACTION_LABEL[r.action] ?? r.action}</RtlText>
                <RtlText style={styles.rowMeta}>
                  {r.actor_name ?? 'המערכת'} · {new Date(r.created_at).toLocaleString('he-IL')}
                </RtlText>
              </View>
            ))}
            {loading ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}
          </ScrollView>
          {hasMore && !loading ? (
            <Button label="טען עוד" variant="secondary" onPress={() => load(page + 1)} style={styles.moreButton} />
          ) : null}
          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '85%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 10 },
  error: { color: colors.statusOverdue, textAlign: 'center', marginBottom: 8 },
  list: { maxHeight: '70%' },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowAction: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  rowMeta: { fontSize: 12, color: colors.textSecondary, textAlign: 'right', marginTop: 2 },
  spinner: { marginVertical: 10 },
  moreButton: { marginTop: 10 },
  closeButton: { marginTop: 10 },
});


