import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { Button } from './Button';

interface FamilySharingModalProps {
  visible: boolean;
  isSupabaseConfigured: boolean;
  inviteCode: string | undefined;
  isAdmin: boolean;
  regenerating: boolean;
  onCopy: () => void;
  onShare: () => void;
  onRegenerate: () => void;
  onClose: () => void;
}

/** Section 12: "👨‍👩‍👧‍👦 שיתוף המשפחה" — connection status + invite-code share/regenerate, moved into its own focused sub-area. */
export function FamilySharingModal({
  visible,
  isSupabaseConfigured,
  inviteCode,
  isAdmin,
  regenerating,
  onCopy,
  onShare,
  onRegenerate,
  onClose,
}: FamilySharingModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <ScrollView style={styles.scroll}>
            <RtlText style={styles.title}>👨‍👩‍👧‍👦 שיתוף המשפחה</RtlText>

            <RtlText style={styles.meta}>
              {isSupabaseConfigured
                ? 'המשפחה מחוברת ✓ — כל בני המשפחה רואים את אותם נתונים.'
                : 'מצב מקומי (ללא Supabase) — הנתונים נשמרים רק במכשיר הזה.'}
            </RtlText>

            {isSupabaseConfigured && inviteCode ? (
              <>
                <RtlText style={styles.meta}>שתפו את הקוד עם בני המשפחה כדי שיוכלו להצטרף, בלי חשבון או סיסמה.</RtlText>
                <View style={styles.codeCard}>
                  <RtlText style={styles.codeText}>{inviteCode}</RtlText>
                </View>
                <View style={styles.actionsRow}>
                  <Button label="העתק קוד" variant="secondary" onPress={onCopy} style={styles.flex} />
                  <Button label="שתף קוד" variant="secondary" onPress={onShare} style={styles.flex} />
                </View>
                {isAdmin ? (
                  <Button
                    label={regenerating ? 'מחליף קוד...' : 'החלפת קוד'}
                    variant="secondary"
                    onPress={onRegenerate}
                    disabled={regenerating}
                    loading={regenerating}
                    style={styles.regenButton}
                  />
                ) : null}
              </>
            ) : null}
          </ScrollView>
          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '80%' },
  // BUG FIX (real-device regression) — see DogDetailsModal.tsx's matching
  // comment for the full mechanism: `flex: 1` forced the ScrollView's
  // flex-basis to 0 inside a `sheet` whose height is auto (capped only by
  // maxHeight, no definite size of its own), collapsing the whole sheet.
  // `flexGrow: 0, flexShrink: 1` restores content-hugging sizing while
  // still letting it scroll/shrink down to the maxHeight cap for longer
  // content (e.g. once the invite-code card + admin actions are showing).
  scroll: { flexGrow: 0, flexShrink: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  meta: { fontSize: 14, color: colors.textSecondary, textAlign: 'right', marginTop: 8 },
  codeCard: { backgroundColor: colors.surfaceMuted, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 12 },
  codeText: { fontSize: 32, fontWeight: '800', color: colors.textPrimary, letterSpacing: 6 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  flex: { flex: 1 },
  regenButton: { marginTop: 10 },
  closeButton: { marginTop: 14 },
});
