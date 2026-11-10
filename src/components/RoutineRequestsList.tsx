import React from 'react';
import { StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';
import type { FamilyUser } from '../types';
import {
  describeRoutineRequest,
  isOpenRoutineRequest,
  routineRequestStatusText,
  type RoutineChangeRequest,
} from '../logic/routineRequests';

interface Props {
  requests: RoutineChangeRequest[];
  usersById: Record<string, FamilyUser | undefined>;
  currentUserId: string;
  isAdmin: boolean;
  busyId: string | null;
  onRespond: (request: RoutineChangeRequest, accept: boolean) => void;
  onDecide: (request: RoutineChangeRequest, approve: boolean) => void;
  onCancel: (request: RoutineChangeRequest) => void;
}

/**
 * Permanent routine change requests under the weekly grid: the other member
 * answers, the admin approves (which updates the routine), the requester can
 * cancel. Everyone in the family sees open requests; decided ones from the
 * last week stay visible to the people involved (and the admin).
 */
export function RoutineRequestsList({ requests, usersById, currentUserId, isAdmin, busyId, onRespond, onDecide, onCancel }: Props) {
  const involved = (r: RoutineChangeRequest) => r.requesterUserId === currentUserId || r.targetUserId === currentUserId;
  const open = requests.filter(isOpenRoutineRequest);
  const recent = requests.filter((r) => !isOpenRoutineRequest(r) && r.status !== 'cancelled' && (isAdmin || involved(r))).slice(0, 4);
  if (open.length === 0 && recent.length === 0) return null;

  const renderRow = (r: RoutineChangeRequest) => {
    const requester = usersById[r.requesterUserId];
    const busy = busyId === r.id;
    const waitingForMe = r.status === 'pending_target' && r.targetUserId === currentUserId;
    const waitingForAdmin = r.status === 'pending_admin' && isAdmin;
    const mineOpen = isOpenRoutineRequest(r) && r.requesterUserId === currentUserId;
    return (
      <View key={r.id} style={[styles.card, (waitingForMe || waitingForAdmin) && styles.cardAction]}>
        <View style={styles.head}>
          <Avatar emoji={requester?.avatar ?? '🙂'} color={requester?.color ?? colors.border} photoUrl={requester?.photoUrl} size={30} />
          <View style={styles.flex}>
            <RtlText style={styles.text}>{describeRoutineRequest(r, usersById)}</RtlText>
            <RtlText style={[styles.status, r.status === 'approved' && styles.statusOk]}>{routineRequestStatusText(r, usersById)}</RtlText>
          </View>
        </View>
        {waitingForMe ? (
          <View style={styles.actions}>
            <Button label="מסכים/ה" compact onPress={() => onRespond(r, true)} loading={busy} disabled={busy} style={styles.flex} />
            <Button label="לא מתאים לי" variant="secondary" compact onPress={() => onRespond(r, false)} disabled={busy} style={styles.flex} />
          </View>
        ) : waitingForAdmin ? (
          <View style={styles.actions}>
            <Button label="אישור ועדכון השגרה" compact onPress={() => onDecide(r, true)} loading={busy} disabled={busy} style={styles.flex} />
            <Button label="דחייה" variant="secondary" compact onPress={() => onDecide(r, false)} disabled={busy} style={styles.flex} />
          </View>
        ) : mineOpen ? (
          <Button label="ביטול הבקשה" variant="secondary" compact onPress={() => onCancel(r)} loading={busy} disabled={busy} style={styles.full} />
        ) : isAdmin && r.status === 'pending_target' ? (
          <Button label="דחייה" variant="secondary" compact onPress={() => onDecide(r, false)} disabled={busy} style={styles.full} />
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      <RtlText style={styles.title} accessibilityRole="header">בקשות לשינוי בשגרה</RtlText>
      {open.map(renderRow)}
      {recent.map(renderRow)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  title: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardAction: { borderColor: '#F08A24', borderWidth: 1.5 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm },
  text: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  status: { fontSize: 12, color: colors.textSecondary, textAlign: 'right', marginTop: 2 },
  statusOk: { color: '#1E6B3E', fontWeight: '700' },
  actions: { flexDirection: 'row-reverse', gap: spacing.sm },
  flex: { flex: 1 },
  full: { width: '100%' },
});
