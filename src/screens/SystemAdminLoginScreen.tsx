import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RtlText } from '../components/RtlText';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { supabase } from '../lib/supabase';
import { useSystemAdminStore } from '../store/systemAdminStore';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Standalone platform-admin login. Authentication uses Supabase password
 * auth; authorization remains server-side through am_i_system_admin().
 * A valid ordinary account therefore cannot gain platform-admin access.
 */
export function SystemAdminLoginScreen({ visible, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshSystemAdmin = useSystemAdminStore((s) => s.refresh);

  const signIn = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@') || !password) {
      setError('יש להזין אימייל וסיסמה.');
      return;
    }
    if (!supabase) {
      setError('החיבור לשרת אינו זמין כרגע.');
      return;
    }

    setSigningIn(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: normalized,
        password,
      });
      if (authError) throw authError;

      // Authentication alone is never enough: refresh() asks the backend
      // whether this authenticated identity is actually a System Admin.
      await refreshSystemAdmin();
      if (!useSystemAdminStore.getState().isSystemAdmin) {
        await supabase.auth.signOut();
        setPassword('');
        setError('פרטי הכניסה אינם מורשים לניהול המערכת.');
        return;
      }

      setPassword('');
      onClose();
    } catch {
      setPassword('');
      setError('אימייל או סיסמה שגויים, או שאין לחשבון הרשאת מנהל מערכת.');
    } finally {
      setSigningIn(false);
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
            הכניסה מיועדת למנהל המערכת בלבד.
          </RtlText>

          <TextInput
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="אימייל מנהל המערכת"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            textAlign="right"
            accessibilityLabel="אימייל מנהל המערכת"
          />

          <View style={styles.passwordRow}>
            <TextInput
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setError(null);
              }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="סיסמה"
              placeholderTextColor={colors.textSecondary}
              style={styles.passwordInput}
              textAlign="right"
              accessibilityLabel="סיסמה"
              onSubmitEditing={() => void signIn()}
            />
            <Pressable
              onPress={() => setShowPassword((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'הסתרת סיסמה' : 'הצגת סיסמה'}
              style={styles.showPassword}
            >
              <RtlText style={styles.showPasswordText}>{showPassword ? 'הסתר' : 'הצג'}</RtlText>
            </Pressable>
          </View>

          {error ? <RtlText style={styles.error} accessibilityRole="alert">{error}</RtlText> : null}
          <Button
            label={signingIn ? 'מתחבר…' : 'כניסה למערכת'}
            onPress={() => void signIn()}
            loading={signingIn}
            disabled={signingIn || !email.trim() || !password}
          />
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
  passwordRow: { minHeight: 50, flexDirection: 'row-reverse', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.background, overflow: 'hidden' },
  passwordInput: { flex: 1, minHeight: 50, paddingHorizontal: spacing.md, color: colors.textPrimary, fontSize: 16 },
  showPassword: { minHeight: 50, justifyContent: 'center', paddingHorizontal: spacing.md },
  showPasswordText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13 },
  error: { color: colors.statusOverdue, fontWeight: '700', textAlign: 'right' },
});
