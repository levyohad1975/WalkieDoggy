import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import type { ActionablePendingRequest } from '../logic/requestLifecycle';
import type { FamilyUser, Walk } from '../types';

/**
 * Family Lifecycle / request-notifications repair, item B — the Home
 * Dashboard pending-request surface. Previously Home only showed a single
 * generic "N requests waiting" banner (`dashboardRequestAlert`, still used
 * as this card's visual language) with no detail and no inline action —
 * every approve/decline required opening the full RequestsInboxModal
 * first. This renders the actual actionable items (already filtered to
 * exactly what THIS viewer is authorized to act on — see
 * selectActionablePendingRequestsForViewer()'s own doc comment) directly,
 * each with who requested what from/of whom and inline approve/decline —
 * reusing the SAME approveSwap/rejectSwap/approveTimeChange/
 * rejectTimeChange actions HomeScreen already wires into
 * RequestsInboxModal, never a second, parallel action path.
 *
 * Compact-dashboard safety (Option D layout): at most MAX_INLINE items
 * render in full; anything beyond that collapses into a single "+N more"
 * row that opens the full inbox instead of growing this card unboundedly.
 *
 * Gender-aware wording: `users` has no recorded gender for family members
 * (only `dogs.sex` exists — see types/index.ts), so there is no data to
 * resolve a specific pronoun/verb form from. This uses the same
 * gender-neutral slash convention ("מבקש/ת") already established
 * elsewhere in this app for exactly this reason (see supabase/functions/
 * send-request-push/index.ts's own push-body templates) rather than
 * guessing or inventing a new per-member data field.
 */
const MAX_INLINE = 2;

interface PendingRequestsCardProps {
  items: ActionablePendingRequest[];
  usersById: Record<string, FamilyUser>;
  walksById: Record<string, Walk>;
  dogName?: string;
  onApproveSwap: (id: string) => void;
  onRejectSwap: (id: string) => void;
  onApproveTimeChange: (id: string) => void;
  onRejectTimeChange: (id: string) => void;
  onOpenInbox: () => void;
}

function nameOf(usersById: Record<string, FamilyUser>, userId: string): string {
  return usersById[userId]?.name ?? 'בן/בת המשפחה';
}

export function PendingRequestsCard({
  items,
  usersById,
  walksById,
  dogName,
  onApproveSwap,
  onRejectSwap,
  onApproveTimeChange,
  onRejectTimeChange,
  onOpenInbox,
}: PendingRequestsCardProps) {
  if (items.length === 0) return null;

  const inline = items.slice(0, MAX_INLINE);
  const overflowCount = items.length - inline.length;

  return (
    <View style={styles.container} testID="pending-requests-card">
      {inline.map((item) => {
        if (item.kind === 'swap') {
          const requesterName = nameOf(usersById, item.requestedByUserId);
          const requesterTime = walksById[item.walkId]?.scheduledTime;
          const viewerTime = item.targetWalkId ? walksById[item.targetWalkId]?.scheduledTime : undefined;
          return (
            <View key={`swap-${item.id}`} style={styles.card}>
              <RtlText style={styles.title}>בקשת החלפת טיול</RtlText>
              <RtlText style={styles.body}>
                {requesterName} מבקש/ת להחליף את הטיול שלך{viewerTime ? ` (${viewerTime})` : ''} בטיול שלו/ה{requesterTime ? ` (${requesterTime})` : ''}
              </RtlText>
              <View style={styles.actions}>
                <Button label="אשר" compact onPress={() => onApproveSwap(item.id)} style={styles.flex} />
                <Button
                  label="דחה"
                  compact
                  variant="secondary"
                  onPress={() => onRejectSwap(item.id)}
                  style={styles.flex}
                  accessibilityHint="הבקשה תידחה מיידית, ללא אפשרות ביטול"
                />
              </View>
            </View>
          );
        }

        const requesterName = nameOf(usersById, item.requestedByUserId);
        const walkDate = walksById[item.walkId]?.date;
        return (
          <View key={`timeChange-${item.id}`} style={styles.card}>
            <RtlText style={styles.title}>בקשת שינוי שעה</RtlText>
            <RtlText style={styles.body}>
              {requesterName} מבקש/ת לשנות את שעת הטיול{dogName ? ` של ${dogName}` : ''}
              {walkDate ? ` (${walkDate})` : ''} משעה {item.expectedTime} לשעה {item.proposedTime}
            </RtlText>
            <View style={styles.actions}>
              <Button label="אשר" compact onPress={() => onApproveTimeChange(item.id)} style={styles.flex} />
              <Button
                label="דחה"
                compact
                variant="secondary"
                onPress={() => onRejectTimeChange(item.id)}
                style={styles.flex}
                accessibilityHint="הבקשה תידחה מיידית, ללא אפשרות ביטול"
              />
            </View>
          </View>
        );
      })}

      {overflowCount > 0 ? (
        <Pressable
          style={styles.overflow}
          onPress={onOpenInbox}
          accessibilityRole="button"
          accessibilityLabel={`${overflowCount} בקשות נוספות ממתינות לאישור`}
        >
          <RtlText style={styles.overflowText}>{`+${overflowCount} בקשות נוספות`}</RtlText>
          <RtlText style={styles.chevron}>‹</RtlText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  card: {
    borderRadius: 18,
    backgroundColor: '#FFF3DE',
    borderWidth: 1,
    borderColor: '#F1DFC2',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  title: { fontSize: 13, fontWeight: '700', color: '#A65F18', textAlign: 'right' },
  body: { fontSize: typography.meta.fontSize, fontWeight: '500', color: colors.textPrimary, textAlign: 'right', lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  flex: { flex: 1 },
  overflow: {
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: '#FFF3DE',
    borderWidth: 1,
    borderColor: '#F1DFC2',
    paddingHorizontal: spacing.md,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  overflowText: { fontSize: 12, fontWeight: '700', color: '#A65F18', textAlign: 'right' },
  chevron: { fontSize: 18, color: '#B66A20', writingDirection: 'ltr' },
});
