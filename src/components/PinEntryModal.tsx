import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { Button } from './Button';

interface PinEntryModalProps {
  visible: boolean;
  /** Display name of the profile being reclaimed — used for the title/copy (7D wording). */
  userName: string;
  /**
   * NARROW CLIENT-FLOW FIX: optional override for the explanatory line
   * under the title. Defaults to the original 7D reclaim-from-another-
   * device wording (still exactly right for LoginScreen's callers, which
   * only ever reach this modal because a claim was rejected as already
   * held elsewhere). SettingsScreen's "החלף משתמש" flow passes its own
   * copy, because there the target profile may be currently UNCLAIMED —
   * "this profile is active on another device" would be factually wrong
   * in that case.
   */
  subtitle?: string;
  onSubmit: (pin: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * COMPLETION PASS — 7B/7D. Collects a PIN and calls authStore.signInWithPin()
 * (via `onSubmit`) to reclaim a profile currently claimed by another device.
 * Used both from LoginScreen (7D: "הפרופיל X הופעל במכשיר אחר" -> "התחבר
 * מחדש כ-X") and, in principle, anywhere else a claim-conflict is surfaced.
 *
 * PRIVACY: the entered PIN lives ONLY in this component's own local `pin`
 * state, for exactly as long as the modal is open. It is never written to
 * AsyncStorage, never logged (a failure surfaces only the friendly Hebrew
 * error from errorMessages.ts, never the raw error containing... nothing PIN
 * related anyway, since the RPC never echoes it back), and is discarded
 * (`setPin('')`) the moment the modal closes for any reason — success,
 * cancel, or unmount via `visible` toggling false.
 */
export function PinEntryModal({ visible, userName, subtitle, onSubmit, onCancel }: PinEntryModalProps) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPin('');
    setError(null);
    setSubmitting(false);
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleSubmit = async () => {
    if (pin.length < 4) {
      setError('קוד ה-PIN חייב להיות בן 4 עד 6 ספרות.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(pin);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא ניתן היה להתחבר. נסו שוב.');
      setPin('');
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      {/* Same KeyboardAvoidingView pattern already proven in
          DogDetailsModal.tsx/AddUnplannedWalkModal.tsx — without it, the
          number-pad keyboard can cover this centered card's PIN input and
          action buttons on shorter devices. */}
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <RtlText style={styles.title}>התחברות מחדש כ{userName}</RtlText>
            <RtlText style={styles.subtitle}>
              {subtitle ?? 'הפרופיל הזה פעיל כרגע במכשיר אחר. הזינו את קוד ה-PIN כדי להעביר אותו למכשיר הזה.'}
            </RtlText>
            <TextInput
              style={styles.input}
              value={pin}
              onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              placeholder="••••"
              placeholderTextColor={colors.textSecondary}
              textAlign="center"
              autoFocus
            />
            {error ? <RtlText style={styles.error}>{error}</RtlText> : null}
            <View style={styles.actions}>
              <Button label="התחבר" onPress={handleSubmit} loading={submitting} style={styles.flex} compact />
              <Button label="ביטול" onPress={handleCancel} variant="secondary" style={styles.flex} compact disabled={submitting} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flexFull: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#00000055', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 400 },
  title: { fontSize: 19, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  input: {
    marginTop: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 14,
    fontSize: 24,
    letterSpacing: 8,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  error: { color: colors.statusOverdue, fontSize: 13, textAlign: 'center', marginTop: 10, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  flex: { flex: 1 },
});
