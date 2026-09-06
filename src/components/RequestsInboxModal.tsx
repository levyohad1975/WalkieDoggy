import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyRole } from '../lib/supabase';
import type { SwapRequestRow, TimeChangeRequestRow } from '../lib/requests';
import type { FamilyUser, Walk } from '../types';
import { colors } from '../theme/colors';
import { Button } from './Button';
import { computeRequestLifecycle, isRequestVisible } from '../logic/requestLifecycle';

interface RequestsInboxModalProps {
  visible: boolean;
  /**
   * The DISPLAY identity to filter/highlight by — the simulated member's id
   * while Admin Test Mode is active, the real signed-in user's id otherwise
   * (see authStore.useEffectiveUserId). Deliberately not named
   * "currentUserId": this value decides what the inbox SHOWS (which pending
   * swap request "belongs" to the viewer), never what gets sent to a
   * mutating call — approveSwap/rejectSwap/etc. always resolve the real
   * actor server-side from auth.uid(), regardless of this prop.
   */
  effectiveUserId: string;
  familyRole: FamilyRole | null;
  usersById: Record<string, FamilyUser>;
  walksById: Record<string, Walk>;
  swapRequests: SwapRequestRow[];
  timeChangeRequests: TimeChangeRequestRow[];
  onApproveSwap: (id: string) => void;
  onRejectSwap: (id: string) => void;
  onApproveTimeChange: (id: string) => void;
  onRejectTimeChange: (id: string) => void;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'ממתין לאישור',
  approved: 'אושר',
  rejected: 'נדחה',
  expired: 'פג תוקף',
};

function StatusBadge({ status, expired }: { status: string; expired?: boolean }) {
  const label = expired ? STATUS_LABEL.expired : STATUS_LABEL[status] ?? status;
  return (
    <View
      style={[
        styles.badge,
        status === 'approved' && !expired && styles.badgeApproved,
        (status === 'rejected' || expired) && styles.badgeRejected,
      ]}
    >
      <RtlText style={styles.badgeText}>{label}</RtlText>
    </View>
  );
}

/**
 * Combined inbox for both approval workflows added in migration 0005:
 * swap requests (Member -> Member) and time-change requests (Member ->
 * Admin). What each row shows and which actions are offered depends on the
 * viewer: the requester always sees the current status; only the actual
 * approver (the target member for a swap, an Admin for a time change) sees
 * approve/reject buttons — this mirrors the server-side authorization in
 * the RPCs themselves (this UI hiding is a convenience, not the security
 * boundary; approve/reject still re-checks on the server).
 */
export function RequestsInboxModal({
  visible,
  effectiveUserId,
  familyRole,
  usersById,
  walksById,
  swapRequests,
  timeChangeRequests,
  onApproveSwap,
  onRejectSwap,
  onApproveTimeChange,
  onRejectTimeChange,
  onClose,
}: RequestsInboxModalProps) {
  const walkLabel = (walkId: string) => {
    const w = walksById[walkId];
    if (!w) return 'טיול';
    return `${w.date} · ${w.scheduledTime}`;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title}>בקשות</RtlText>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            <RtlText style={styles.sectionTitle}>בקשות החלפה</RtlText>
            {(() => {
              // Pending stays actionable while the walk is still pending.
              // Approved/rejected stays visible for ~24 hours for awareness,
              // then drops out of this active inbox. Expired pending requests
              // are also hidden here rather than lingering forever.
              const visibleSwaps = swapRequests
                .map((r) => ({ r, state: computeRequestLifecycle(r, walksById) }))
                .filter(({ state }) => isRequestVisible(state));
              if (visibleSwaps.length === 0) return <RtlText style={styles.empty}>אין בקשות החלפה</RtlText>;
              return visibleSwaps.map(({ r, state }) => {
                const canApprove = state === 'active' && r.target_user_id === effectiveUserId;
                return (
                  <View key={r.id} style={styles.row}>
                    <View style={styles.rowHeader}>
                      <RtlText style={styles.rowText}>
                        {usersById[r.requested_by_user_id]?.name ?? '—'} · {walkLabel(r.walk_id)} ↔ {usersById[r.target_user_id]?.name ?? '—'} · {r.target_walk_id ? walkLabel(r.target_walk_id) : 'טיול יעד לא זמין'}
                      </RtlText>
                      <StatusBadge status={r.status} expired={state === 'expired'} />
                    </View>
                    {canApprove ? (
                      <View style={styles.rowActions}>
                        <Button label="אשר" onPress={() => onApproveSwap(r.id)} style={styles.flex} />
                        <Button label="דחה" variant="secondary" onPress={() => onRejectSwap(r.id)} style={styles.flex} />
                      </View>
                    ) : null}
                  </View>
                );
              });
            })()}

            <RtlText style={[styles.sectionTitle, styles.sectionTitleSpaced]}>בקשות שינוי שעה</RtlText>
            {(() => {
              const visibleTimeChanges = timeChangeRequests
                .map((r) => ({ r, state: computeRequestLifecycle(r, walksById) }))
                .filter(({ state }) => isRequestVisible(state));
              if (visibleTimeChanges.length === 0) return <RtlText style={styles.empty}>אין בקשות שינוי שעה</RtlText>;
              return visibleTimeChanges.map(({ r, state }) => {
                const canApprove = state === 'active' && familyRole === 'admin';
                return (
                  <View key={r.id} style={styles.row}>
                    <View style={styles.rowHeader}>
                      <RtlText style={styles.rowText}>
                        {usersById[r.requested_by_user_id]?.name ?? '—'} · {walkLabel(r.walk_id)} ← {r.proposed_time}
                      </RtlText>
                      <StatusBadge status={r.status} expired={state === 'expired'} />
                    </View>
                    {canApprove ? (
                      <View style={styles.rowActions}>
                        <Button label="אשר" onPress={() => onApproveTimeChange(r.id)} style={styles.flex} />
                        <Button label="דחה" variant="secondary" onPress={() => onRejectTimeChange(r.id)} style={styles.flex} />
                      </View>
                    ) : null}
                  </View>
                );
              });
            })()}
          </ScrollView>
          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '85%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  list: { maxHeight: '85%' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textSecondary, textAlign: 'right', marginBottom: 8 },
  sectionTitleSpaced: { marginTop: 18 },
  empty: { textAlign: 'center', color: colors.textSecondary, paddingVertical: 10, fontSize: 13 },
  row: { backgroundColor: colors.surfaceMuted, borderRadius: 14, padding: 12, marginBottom: 8, gap: 8 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary, textAlign: 'right' },
  rowActions: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.statusCurrentBg },
  badgeApproved: { backgroundColor: '#E8F7F1' },
  badgeRejected: { backgroundColor: colors.statusSkippedBg },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.textPrimary },
  closeButton: { marginTop: 14 },
});
