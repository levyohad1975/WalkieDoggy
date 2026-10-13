import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';

interface ScreenRecoveryBoundaryProps {
  children: React.ReactNode;
  screenName: string;
}

interface ScreenRecoveryBoundaryState {
  hasError: boolean;
}

/**
 * Keeps a failure isolated to one tab instead of leaving the app as a blank
 * page. Retrying only remounts the failed screen and never clears family data.
 */
export class ScreenRecoveryBoundary extends React.Component<ScreenRecoveryBoundaryProps, ScreenRecoveryBoundaryState> {
  state: ScreenRecoveryBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ScreenRecoveryBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`Screen recovery boundary: ${this.props.screenName}`, error);
  }

  private retry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container} accessibilityRole="alert">
        <View style={styles.card}>
          <RtlText style={styles.title}>לא הצלחנו לפתוח את המסך</RtlText>
          <RtlText style={styles.message}>
            הנתונים שלכם נשמרו. אפשר לנסות שוב בלי להתנתק ובלי ליצור משפחה חדשה.
          </RtlText>
          <Pressable
            style={styles.button}
            onPress={this.retry}
            accessibilityRole="button"
            accessibilityLabel={`נסה שוב לפתוח ${this.props.screenName}`}
          >
            <RtlText style={styles.buttonText}>נסו שוב</RtlText>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'center' },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  button: { backgroundColor: colors.primary, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: 'center' },
  buttonText: { ...typography.body, color: colors.surface, fontWeight: '700' },
});
