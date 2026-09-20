import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { useAuthStore } from '../store/authStore';
import { useFamilyStore } from '../store/familyStore';
import { colors } from '../theme/colors';

/**
 * QA/UX round, Part F2 fix: the real-impersonation banner ("בדיקה אמיתית:
 * מחובר כ-X" / "חזור למנהל") used to be rendered ONLY inside HomeScreen —
 * so navigating to any other tab (Schedule/Family/History/Statistics/
 * Settings) while impersonating made it disappear entirely, even though
 * impersonation was still fully active and every mutation on those screens
 * was still being performed for real as the selected member. That's not
 * "a persistent visible banner while active" as required — a member could
 * easily lose track of which mode they were in on any screen but Home.
 *
 * Extracted here (same visual design, same text, same exit action as
 * before) and rendered ONCE at the navigator root (see RootNavigator.tsx)
 * so it now stays visible across every tab for as long as
 * `impersonatingUserId` is set, not just on Home. HomeScreen no longer
 * renders its own copy.
 */
export function ImpersonationBanner() {
  const impersonatingUserId = useAuthStore((s) => s.impersonatingUserId);
  const endImpersonation = useAuthStore((s) => s.endImpersonation);
  const users = useFamilyStore((s) => s.users);
  const [endingImpersonation, setEndingImpersonation] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  if (!impersonatingUserId) return null;
  const impersonatingUser = users.find((u) => u.id === impersonatingUserId);

  return (
    <View style={styles.banner}>
      <View style={styles.textWrap}>
        <RtlText style={styles.text}>בדיקה אמיתית: מחובר כ-{impersonatingUser?.name ?? '—'}</RtlText>
        {bannerError ? (
          <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {bannerError}
          </RtlText>
        ) : null}
      </View>
      <Pressable
        onPress={async () => {
          setBannerError(null);
          setEndingImpersonation(true);
          try {
            await endImpersonation();
          } catch {
            setBannerError('אין חיבור לאינטרנט — נסו שוב');
          } finally {
            setEndingImpersonation(false);
          }
        }}
        style={styles.button}
        disabled={endingImpersonation}
      >
        <RtlText style={styles.buttonText}>{endingImpersonation ? '...' : 'חזור למנהל'}</RtlText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: colors.primaryDark,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  textWrap: { flex: 1, gap: 2 },
  text: { color: '#fff', fontWeight: '700', fontSize: 13, textAlign: 'right' },
  error: { color: '#fff', fontWeight: '600', fontSize: 11, textAlign: 'right' },
  button: { backgroundColor: '#ffffff33', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
