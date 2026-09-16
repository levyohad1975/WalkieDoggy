import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { Button } from './Button';

interface PinSetupModalProps {
  visible: boolean;
  /** Display name of the profile whose PIN is being set/changed — for the title copy. */
  userName: string;
  /** True when this profile already has a PIN (changes copy/labels from "set" to "change"). Purely cosmetic — the RPC itself doesn't need to know. */
  hasExistingPin?: boolean;
  onSave: (pin: string) => Promise<void>;
  onClose: () => void;
}

/**
 * COMPLETION PASS — 7C (first-time PIN setup). Reached from FamilyScreen's
 * member row (self, or admin-for-a-non-admin-member — set_profile_pin()
 * enforces the actual authorization server-side; this UI does not attempt
 * to duplicate that check, it just surfaces whatever the RPC decides via
 * errorMessages.ts, e.g. "רק המנהל/ת עצמו/ה יכולים להגדיר..." if a caller
 * who shouldn't be allowed tries anyway) and from SettingsScreen for the
 * signed-in device's own profile.
 *
 * Requires typing the PIN twice (explicit confirmation, per the coordinator's
 * requirement) before enabling save. PRIVACY: identical guarantee to
 * PinEntryModal — the PIN lives only in local state for as long as the modal
 * is open, is never logged/persisted, and both fields are cleared on any
 * exit path (save, cancel, or close).
 */
export function PinSetupModal({ visible, userName, hasExistingPin, onSave, onClose }: PinSetupModalProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on every open so a previous attempt's leftover digits never
  // survive into a re-open (also doubles as the "never persist" guarantee
  // for the in-memory fields once the modal is dismissed).
  useEffect(() => {
    if (visible) {
      setPin('');
      setConfirmPin('');
      setError(null);
      setSaving(false);
    }
  }, [visible]);

  const handleClose = () => {
    setPin('');
    setConfirmPin('');
    onClose();
  };

  const handleSave = async () => {
    if (pin.length < 4 || pin.length > 6) {
      setError('קוד ה-PIN חייב להיות בן 4 עד 6 ספרות.');
      return;
    }
    if (pin !== confirmPin) {
      setError('הקודים שהוזנו אינם תואמים. נסו שוב.');
      setConfirmPin('');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(pin);
      setPin('');
      setConfirmPin('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא ניתן היה לשמור את קוד ה-PIN. נסו שוב.');
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      {/* Same KeyboardAvoidingView pattern already proven in
          DogDetailsModal.tsx/PinEntryModal.tsx — without it, the number-pad
          keyboard can cover this centered card's second PIN field and
          action buttons on shorter devices, worse here than PinEntryModal
          since this card has two PIN inputs instead of one. */}
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <RtlText style={styles.title}>{hasExistingPin ? `שינוי קוד PIN ל${userName}` : `הגדרת קוד PIN ל${userName}`}</RtlText>
            <RtlText style={styles.subtitle}>
              קוד ה-PIN ישמש כדי לאמת מעבר של הפרופיל הזה למכשיר אחר. בחרו 4 עד 6 ספרות.
            </RtlText>
            <RtlText style={styles.label}>קוד PIN חדש</RtlText>
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
              accessibilityLabel="קוד PIN חדש"
            />
            <RtlText style={styles.label}>אימות קוד PIN</RtlText>
            <TextInput
              style={styles.input}
              value={confirmPin}
              onChangeText={(t) => setConfirmPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              placeholder="••••"
              placeholderTextColor={colors.textSecondary}
              textAlign="center"
              accessibilityLabel="אימות קוד PIN"
            />
            {error ? (
              <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </RtlText>
            ) : null}
            <View style={styles.actions}>
              <Button label="שמירה" onPress={handleSave} loading={saving} style={styles.flex} compact />
              <Button label="ביטול" onPress={handleClose} variant="secondary" style={styles.flex} compact disabled={saving} />
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
  label: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', marginTop: 16, textAlign: 'right' },
  input: {
    marginTop: 8,
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
