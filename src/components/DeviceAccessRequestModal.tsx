import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { DEVICE_ACCESS_POLL_MS, getMyDeviceAccessRequest, requestDeviceAccess } from '../lib/deviceAccess';

type Phase = 'ask' | 'sending' | 'waiting' | 'approved' | 'rejected' | 'expired' | 'error';

interface DeviceAccessRequestModalProps {
  visible: boolean;
  /** The profile picked on this device, already signed in elsewhere. */
  userId: string | null;
  userName: string;
  /** Signs this device into the profile once the admin approved (authStore.signIn). */
  onApproved: (userId: string) => Promise<void>;
  /** Opens the old PIN path for a profile that has a PIN. */
  onUsePin: () => void;
  onClose: () => void;
}

/**
 * Owner request 2026-11-03: a family member's new device (typically the
 * iPhone home-screen shortcut, which keeps its own storage) asks the family
 * admin to approve it, instead of needing a profile PIN. The admin gets a
 * push and approves on Home; this device checks every few seconds and signs
 * straight in once approved. The server decides everything
 * (migration 20261103120000_device_access_requests).
 */
export function DeviceAccessRequestModal({ visible, userId, userName, onApproved, onUsePin, onClose }: DeviceAccessRequestModalProps) {
  const [phase, setPhase] = useState<Phase>('ask');
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setPhase('ask');
      setError(null);
      requestIdRef.current = null;
    }
  }, [visible, userId]);

  useEffect(() => {
    if (!visible || phase !== 'waiting' || !userId) return undefined;
    let active = true;
    const timer = setInterval(() => {
      const id = requestIdRef.current;
      if (!id) return;
      getMyDeviceAccessRequest(id)
        .then(async (state) => {
          if (!active || !state) return;
          if (state.status === 'approved') {
            active = false;
            setPhase('approved');
            try {
              await onApproved(userId);
            } catch (e) {
              setError(friendlyErrorMessage(e));
              setPhase('error');
            }
          } else if (state.status === 'rejected' || state.status === 'expired') {
            setPhase(state.status);
          }
        })
        .catch(() => { /* offline for a moment: keep waiting */ });
    }, DEVICE_ACCESS_POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [visible, phase, userId, onApproved]);

  const send = async () => {
    if (!userId) return;
    setPhase('sending');
    setError(null);
    try {
      requestIdRef.current = await requestDeviceAccess(userId);
      setPhase('waiting');
    } catch (e) {
      setError(friendlyErrorMessage(e));
      setPhase('error');
    }
  };

  const waiting = phase === 'waiting' || phase === 'approved';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <RtlText style={styles.title} accessibilityRole="header">
            {waiting ? 'ממתינים לאישור' : `${userName} כבר מחובר/ת במכשיר אחר`}
          </RtlText>

          {waiting ? (
            <>
              <ActivityIndicator color={colors.primary} style={styles.spinner} accessibilityLabel="ממתינים לאישור" />
              <RtlText style={styles.text} accessibilityLiveRegion="polite">
                {phase === 'approved'
                  ? 'אושר! מתחברים…'
                  : 'שלחנו למנהל המשפחה בקשה לאשר את המכשיר הזה. ברגע שיאשר, תיכנסו אוטומטית. אפשר להשאיר את המסך פתוח.'}
              </RtlText>
            </>
          ) : (
            <RtlText style={styles.text}>
              {phase === 'rejected'
                ? 'מנהל המשפחה לא אישר את הבקשה. אם זו טעות, דברו איתו ושלחו שוב.'
                : phase === 'expired'
                  ? 'הבקשה לא אושרה בזמן. אפשר לשלוח אותה שוב.'
                  : 'זה קורה כשמצטרפים בדפדפן ואחר כך פותחים מקיצור הדרך במסך הבית. נשלח למנהל המשפחה בקשה לאשר את המכשיר הזה, ותיכנסו מיד אחרי שיאשר.'}
            </RtlText>
          )}

          {error ? (
            <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</RtlText>
          ) : null}

          {!waiting ? (
            <Button
              label={phase === 'sending' ? 'שולחים…' : phase === 'ask' ? '📲 בקשת אישור ממנהל המשפחה' : '📲 שליחה מחדש'}
              onPress={() => void send()}
              loading={phase === 'sending'}
              disabled={phase === 'sending' || !userId}
              style={styles.button}
            />
          ) : null}
          {!waiting ? (
            <Button label="יש לי קוד PIN" variant="secondary" onPress={onUsePin} disabled={phase === 'sending'} style={styles.button} />
          ) : null}
          <Button label={waiting ? 'ביטול ההמתנה' : 'ביטול'} variant="secondary" onPress={onClose} style={styles.button} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 24, width: '100%', maxWidth: 420 },
  title: { fontSize: 19, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  text: { fontSize: typography.cardTitle.fontSize, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, lineHeight: 21 },
  spinner: { marginTop: spacing.lg },
  error: { color: colors.statusOverdue, fontSize: typography.meta.fontSize, textAlign: 'center', marginTop: 10, fontWeight: '600' },
  button: { width: '100%', marginTop: spacing.md },
});
