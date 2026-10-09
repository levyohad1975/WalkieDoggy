import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser, Walk } from '../types';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { SwapWalkPickerModal } from './SwapWalkPickerModal';
import { TimePickerField } from './TimePickerField';
import { is24HourTime } from '../logic/timeInput';
import { ConfirmModal } from './ConfirmModal';

export interface SwappableWalkOption {
  walk: Walk;
  responsible?: FamilyUser;
}

interface EditWalkModalProps {
  visible: boolean;
  walk: Walk | null;
  users: FamilyUser[];
  otherPendingWalks?: SwappableWalkOption[];
  onChangeTime: (newTime: string) => void;
  onChangeResponsible: (newUserId: string) => void;
  onSwapWithWalk?: (otherWalkId: string) => void;
  onCancelWalk: () => void;
  onRemoveRecurringRule?: () => void;
  onClose: () => void;
}

/**
 * Quick-edit sheet opened by tapping any upcoming walk: change its time,
 * hand it to someone else, or cancel it — all as a one-off change to just
 * this occurrence, never touching the rest of the rotation.
 */
export function EditWalkModal({
  visible,
  walk,
  users,
  otherPendingWalks = [],
  onChangeTime,
  onChangeResponsible,
  onSwapWithWalk,
  onCancelWalk,
  onRemoveRecurringRule,
  onClose,
}: EditWalkModalProps) {
  const [time, setTime] = useState(walk?.scheduledTime ?? '');
  const [selectedResponsibleUserId, setSelectedResponsibleUserId] = useState(walk?.responsibleUserId ?? '');
  const [swapMode, setSwapMode] = useState(false);
  const [cancelConfirmVisible, setCancelConfirmVisible] = useState(false);
  const [removeRuleConfirmVisible, setRemoveRuleConfirmVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      setTime(walk?.scheduledTime ?? '');
      setSelectedResponsibleUserId(walk?.responsibleUserId ?? '');
      setSwapMode(false);
    }
  }, [visible, walk?.id]);

  if (!walk) return null;

  // Only track the picker's local value here — do NOT commit on every
  // onChange. On iOS, DateTimePicker's `display="spinner"` fires onChange
  // continuously as the wheel scrolls (there is no "Done" tap in that mode),
  // so committing immediately used to reschedule the walk to whatever
  // intermediate value the wheel passed through first, then close the sheet
  // out from under the user before they reached their intended time. The
  // single "שמור שינויים" button below is the one place the change is
  // actually applied, matching RequestTimeChangeModal/AddUnplannedWalkModal's
  // own explicit-submit pattern for the identical spinner picker.
  const handleTimeChange = (newTime: string) => {
    setTime(newTime);
  };

  const timeChanged = is24HourTime(time) && time !== walk.scheduledTime;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Round 6C1: same KeyboardAvoidingView pattern already proven in
          RequestTimeChangeModal.tsx — wraps the existing backdrop/sheet/
          ScrollView structure unchanged. (The swap-candidate list now lives
          in a separate SwapWalkPickerModal — see Section 8 — so it's no
          longer nested inside this sheet's own ScrollView.) */}
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`סגירת עריכת הטיול — ${walk.scheduledTime}`}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {/* Section 7's original fix here (`scroll: {flex:1}`, to keep
                the "בטל את הטיול"/"סגור" buttons reachable for long content)
                turned out to cause a WORSE bug: it collapsed the sheet
                entirely for short content (see `scroll`'s own doc comment
                below, final-QA-round fix). `flexGrow:0, flexShrink:1` now
                gets both cases right: hugs short content, and still
                shrinks/scrolls rather than pushing the sheet past its
                maxHeight cap for long content. */}
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title} accessibilityRole="header">עריכת הטיול — {walk.scheduledTime}</RtlText>
            <RtlText style={styles.subtitle}>שינוי חד-פעמי, לא משפיע על שאר הסבב</RtlText>

            <RtlText style={styles.label}>שעת הטיול — לחצו על השעה לשינוי</RtlText>
            <TimePickerField value={time} onChange={handleTimeChange} webLabel="בחירת שעת הטיול" />

            <RtlText style={styles.label}>אחראי לטיול הזה</RtlText>
            <View style={styles.userRow}>
              {users.map((u) => (
                <Pressable
                  key={u.id}
                  onPress={async () => {
                    if (u.id === selectedResponsibleUserId) return;
                    setSelectedResponsibleUserId(u.id);
                    await onChangeResponsible(u.id);
                  }}
                  style={[styles.userChip, u.id === selectedResponsibleUserId && styles.userChipActive]}
                >
                  <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={40} />
                  <RtlText style={styles.userChipName} numberOfLines={1}>
                    {u.name}
                  </RtlText>
                </Pressable>
              ))}
            </View>

            {onSwapWithWalk && otherPendingWalks.length > 0 ? (
              <>
                <RtlText style={styles.label}>או להחליף עם טיול אחר לגמרי</RtlText>
                <View style={styles.footerActions}>
               <Button label="שמור שינויים" disabled={!timeChanged} onPress={() => onChangeTime(time)} style={styles.footerButton} />
               <Button label="סגור" variant="secondary" onPress={onClose} style={styles.footerButton} />
             </View>
             <View style={styles.destructiveActions}>
               <Pressable accessibilityRole="button" accessibilityLabel="בטל את הטיול הזה" onPress={() => setCancelConfirmVisible(true)} style={styles.destructiveLink}>
                 <RtlText style={styles.destructiveText}>בטל את הטיול הזה</RtlText>
               </Pressable>
               {onRemoveRecurringRule ? (
                 <Pressable accessibilityRole="button" accessibilityLabel="הסר מהשגרה הקבועה" onPress={() => setRemoveRuleConfirmVisible(true)} style={styles.destructiveLink}>
                   <RtlText style={styles.destructiveText}>הסר מהשגרה הקבועה</RtlText>
                   <RtlText style={styles.destructiveHint}>מפסיק יצירת טיולים עתידיים בשגרה זו</RtlText>
                 </Pressable>
               ) : null}
             </View>
             </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>

      {/* Section 8: the swap candidate list is a dedicated, full-size modal
          rather than a nested ScrollView squeezed into this sheet — avoids
          the cramped 180px box and the nested-scroll gesture conflict, and
          preserves the exact same onSwapWithWalk(otherWalkId) contract. */}
      <SwapWalkPickerModal
        visible={swapMode}
        walk={walk}
        options={otherPendingWalks}
        onSelect={(otherWalkId) => {
          setSwapMode(false);
          onSwapWithWalk?.(otherWalkId);
        }}
        onClose={() => setSwapMode(false)}
      />
      <ConfirmModal
        visible={removeRuleConfirmVisible}
        title="להסיר את הטיול מהשגרה?"
        message={`השגרה הקבועה של ${walk.scheduledTime} תוסר ולא תיצור טיולים עתידיים. טיולים שכבר בוצעו יישמרו. שגרות אחרות באותה שעה לא יימחקו.`}
        confirmLabel="הסר מהשגרה"
        onConfirm={() => { setRemoveRuleConfirmVisible(false); onRemoveRecurringRule?.(); }}
        onCancel={() => setRemoveRuleConfirmVisible(false)}
      />
      <ConfirmModal
        visible={cancelConfirmVisible}
        title="לבטל את הטיול הזה?"
        message={`הטיול של ${walk.scheduledTime} יבוטל רק הפעם. שאר הסבב לא ישתנה.`}
        confirmLabel="בטל טיול"
        onConfirm={() => {
          setCancelConfirmVisible(false);
          onCancelWalk();
        }}
        onCancel={() => setCancelConfirmVisible(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  flexFull: { flex: 1 },
  backdrop: {
  flex: 1,
  backgroundColor: '#00000055',
  justifyContent: 'flex-end',
},
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, maxHeight: '88%' },
  // BUG FIX (app-wide modal-collapse audit, final QA round): this was the
  // SAME `flex: 1`-on-ScrollView-inside-an-auto-height-maxHeight-sheet
  // pattern already found and fixed in DogDetailsModal/RemindersModal/
  // FamilySharingModal/SettingsScreen's management sheet — `flex: 1`
  // overrides ScrollView's own default `{flexGrow:0, flexShrink:1,
  // flexBasis:'auto'}` with `flexBasis: 0`, which has nothing to grow into
  // inside a parent (`sheet`) whose own height is `auto` (only capped by
  // maxHeight, never a definite size) — so the ScrollView, and visually the
  // whole sheet, collapses toward zero height instead of sizing to content.
  // This exact instance was missed in the previous patch (which only
  // covered the Settings sub-modals) and is the confirmed root cause of
  // both "Home 'לערוך' walk edit going gray with no usable editor" and
  // "Schedule tapping a walk going gray" — both Home and Schedule open
  // this SAME component (see HomeScreen.tsx/ScheduleScreen.tsx's own
  // `<EditWalkModal ... />` usage). `flexGrow: 0, flexShrink: 1` restores
  // content-hugging sizing for short edits while still letting the
  // ScrollView shrink/scroll once content exceeds the 88% cap.
  scroll: { flexGrow: 0, flexShrink: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: typography.meta.fontSize, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.sm },
  label: { fontSize: typography.meta.fontSize, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm, textAlign: 'right' },
  userRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  userChip: { alignItems: 'center', minWidth: 68, gap: spacing.xs, opacity: 0.55 },
  userChipActive: { opacity: 1 },
  userChipName: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  footerActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  footerButton: { flex: 1 },
  destructiveActions: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.lg, paddingTop: spacing.xs },
  destructiveLink: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.sm },
  destructiveText: { fontSize: 14, fontWeight: '600', color: colors.statusSkipped },
  destructiveHint: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: 3 },
});
