import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RtlText } from '../components/RtlText';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { supabase } from '../lib/supabase';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Desktop/web entry for the platform administrator.
 * Authentication is Supabase email OTP/magic-link; authorization remains
 * entirely server-side through am_i_system_admin() and the admin RPCs.
 */
export function SystemAdminLoginScreen({ visible, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendLink = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      setError('יש להזין כתובת אימייל תקינה.');
      return;
    }
    if (!supabase) {
      setError('החיבור לשרת אינו זמין כרגע.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const redirectTo =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? window.location.origin
          : undefined;
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });
      if (authError) throw authError;
      setSent(true);
    } catch {
      setError('לא הצלחנו לשלוח קישור כניסה. ודאו שזהו אימייל מנהל המערכת ונסו שוב.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.card}>
          <View style={styles.header}>
            <RtlText style={styles.title} accessibilityRole="header">🛡️ כניסת מנהל מערכת</RtlText>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת כניסת מנהל מערכת">
              <RtlText style={styles.close}>סגירה</RtlText>
            </Pressable>
          </View>
          <RtlText style={styles.copy}>
            הכניסה מיועדת למנהל המערכת ואינה דורשת הצטרפות למשפחה. נשלח קישור מאובטח לאימייל המורשה.
          </RtlText>
          {sent ? (
            <View style={styles.success}>
              <RtlText style={styles.successText}>קישור הכניסה נשלח. פתחו אותו במחשב הזה כדי להיכנס לדשבורד הניהול.</RtlText>
            </View>
          ) : (
            <>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="אימייל מנהל המערכת"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                textAlign="right"
                accessibilityLabel="אימייל מנהל המערכת"
                onSubmitEditing={() => void sendLink()}
              />
              {error ? <RtlText style={styles.error} accessibilityRole="alert">{error}</RtlText> : null}
              <Button label="שליחת קישור כניסה" onPress={() => void sendLink()} loading={sending} disabled={sending} />
            </>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,39,48,0.42)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 520, backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.xl, gap: spacing.lg },
  header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { ...typography.screenTitle, fontSize: 22, color: colors.textPrimary, textAlign: 'right' },
  close: { color: colors.primaryDark, fontWeight: '800' },
  copy: { ...typography.body, color: colors.textSecondary, textAlign: 'right', lineHeight: 24 },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.background, paddingHorizontal: spacing.md, color: colors.textPrimary, fontSize: 16 },
  error: { color: colors.statusOverdue, fontWeight: '700', textAlign: 'right' },
  success: { backgroundColor: colors.primarySoft, borderRadius: radii.lg, padding: spacing.lg },
  successText: { color: colors.textPrimary, fontWeight: '700', textAlign: 'right', lineHeight: 22 },
});
