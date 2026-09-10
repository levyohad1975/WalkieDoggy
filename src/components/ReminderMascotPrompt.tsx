import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { RtlText } from './RtlText';
import { MascotFrameAnimation } from './MascotFrameAnimation';

interface ReminderMascotPromptProps {
  visible: boolean;
  message: string;
  onDismiss: () => void;
}

/** A notification-open prompt, intentionally distinct from completion gratitude. */
export function ReminderMascotPrompt({ visible, message, onDismiss }: ReminderMascotPromptProps) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, 3200);
    return () => clearTimeout(timer);
  }, [visible, onDismiss]);
  const fallback = require('../../assets/branding/walkie-doggy-mascot-transparent.png');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="סגירת תזכורת הקמע של Walkie Doggy Link">
        <View style={styles.moment} accessibilityRole="alert">
          <View style={styles.bubble}><RtlText style={styles.message} numberOfLines={2}>{message}</RtlText></View>
          <View style={styles.tail} />
          <MascotFrameAnimation frames={[]} fallback={fallback} fps={10} size={190} accessibilityLabel="הקמע של Walkie Doggy Link מזכיר שהגיע זמן הטיול" />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11, 39, 48, 0.28)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  moment: { alignItems: 'center', maxWidth: 340 },
  bubble: { backgroundColor: colors.surface, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12 },
  message: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  tail: { width: 18, height: 18, backgroundColor: colors.surface, transform: [{ rotate: '45deg' }, { translateY: -9 }], marginBottom: -10 },
});
