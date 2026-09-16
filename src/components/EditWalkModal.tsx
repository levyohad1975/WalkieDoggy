import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser, Walk } from '../types';
import { colors } from '../theme/colors';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { SwapWalkPickerModal } from './SwapWalkPickerModal';
import { TimePickerField } from './TimePickerField';
import { is24HourTime } from '../logic/timeInput';

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
  onClose,
}: EditWalkModalProps) {
  const [time, setTime] = useState(walk?.scheduledTime ?? '');
  const [swapMode, setSwapMode] = useState(false);

  useEffect(() => {
    if (visible) {
      setTime(walk?.scheduledTime ?? '');
      setSwapMode(false);
    }
  }, [visible, walk?.scheduledTime]);

  if (!walk) return null;

  // This sheet applies a valid selected time immediately, preserving its
  // existing one-off edit contract.
  const handleTimeChange = (newTime: string) => {
    setTime(newTime);
    if (is24HourTime(newTime) && newTime !== walk.scheduledTime) onChangeTime(newTime);
  };

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
              <RtlText style={styles.title}>עריכת הטיול — {walk.scheduledTime}</RtlText>
            <RtlText style={styles.subtitle}>שינוי חד-פעמי, לא משפיע על שאר הסבב</RtlText>

            <RtlText style={styles.label}>שעה</RtlText>
            <TimePickerField value={time} onChange={handleTimeChange} webLabel="בחירת שעת הטיול" />

            <RtlText style={styles.label}>אחראי לטיול הזה</RtlText>
            <View style={styles.userRow}>
              {users.map((u) => (
                <Pressable
                  key={u.id}
                  onPress={() => u.id !== walk.responsibleUserId && onChangeResponsible(u.id)}
                  style={[styles.userChip, u.id === walk.responsibleUserId && styles.userChipActive]}
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
                <Button label="🔁 בחר טיול " variant="secondary" onPress={() => setSwapMode(true)} />
              </>
            ) : null}

            <Button
  label="בטל את הטיול הזה"
  variant="danger"
  accessibilityHint="יוצג אישור לפני ביטול הטיול"
  onPress={() => {
    Alert.alert(
      'לבטל את הטיול הזה?',
      `הטיול של ${walk.scheduledTime} יבוטל רק הפעם. שאר הסבב לא ישתנה.`,
      [
        {
          text: 'חזרה',
          style: 'cancel',
        },
        {
          text: 'בטל טיול',
          style: 'destructive',
          onPress: onCancelWalk,
        },
      ]
    );
  }}
  style={styles.cancelButton}
/>
            <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '88%' },
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
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 16, marginBottom: 8, textAlign: 'right' },
  userRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  userChip: { alignItems: 'center', minWidth: 68, gap: 4, opacity: 0.55 },
  userChipActive: { opacity: 1 },
  userChipName: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  cancelButton: { marginTop: 22 },
  closeButton: { marginTop: 10 },
});
