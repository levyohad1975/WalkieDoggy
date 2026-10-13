import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { RtlText } from './RtlText';

export type SyncDiagnosticsFeedback = {
  kind: 'loading' | 'success' | 'error';
  message: string;
};

type Props = {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  onPressIn?: () => void;
  disabled?: boolean;
  busy?: boolean;
  loadingLabel?: string;
  feedback?: SyncDiagnosticsFeedback | null;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function SyncDiagnosticsActionButton({
  label,
  accessibilityLabel,
  onPress,
  onPressIn,
  disabled = false,
  busy = false,
  loadingLabel,
  feedback,
  testID,
  style,
}: Props) {
  return (
    <View>
      {feedback ? (
        <RtlText
          style={feedback.kind === 'error' ? styles.error : feedback.kind === 'success' ? styles.success : styles.message}
          accessibilityRole={feedback.kind === 'error' ? 'alert' : undefined}
          accessibilityLiveRegion="polite"
        >
          {feedback.message}
        </RtlText>
      ) : null}
      <Pressable
        style={[styles.button, style]}
        onPressIn={onPressIn}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled, busy }}
        testID={testID}
      >
        <RtlText style={styles.buttonText}>{busy && loadingLabel ? loadingLabel : label}</RtlText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  message: { fontSize: 13, color: '#46536A', textAlign: 'right', writingDirection: 'rtl', lineHeight: 20, marginBottom: 4 },
  success: { fontSize: 13, color: '#176B56', textAlign: 'right', writingDirection: 'rtl', lineHeight: 20, marginBottom: 4 },
  error: { fontSize: 13, color: '#9B2C2C', textAlign: 'right', writingDirection: 'rtl', lineHeight: 20, marginBottom: 4 },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#167D79', paddingHorizontal: 12 },
  buttonText: { color: '#126A66', fontWeight: '700', textAlign: 'center' },
});
