import React, { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { copyToClipboard } from '../lib/clipboard';

interface WalkPipelineDiagnosticsModalProps {
  visible: boolean;
  /** The full report text from buildWalkPipelineReport, or undefined while it's being gathered. */
  report: string | undefined;
  onClose: () => void;
}

/**
 * TEMPORARY P0 DIAGNOSTIC (real-device QA round 5) — see
 * walkPipelineDiagnostics.ts's own doc comment for the full context. Shows
 * the generated pipeline-trace report as selectable (long-press to copy
 * manually) plain text, plus a "Copy" button using the same clipboard
 * helper every other copy action in the app already uses. Not real
 * user-facing copy — this is diagnostic plumbing, left in English/raw
 * field names on purpose so it stays exact and unambiguous.
 *
 * Remove this component and its call site in HomeScreen.tsx once the
 * round-5 symptom is root-caused and fixed.
 */
export function WalkPipelineDiagnosticsModal({ visible, report, onClose }: WalkPipelineDiagnosticsModalProps) {
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'success' | 'error'>('idle');

  const handleCopy = async () => {
    if (!report) return;
    const ok = await copyToClipboard(report);
    setCopyFeedback(ok ? 'success' : 'error');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setCopyFeedback('idle')}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close diagnostics">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title} accessibilityRole="header">
            🔍 Walk pipeline diagnostic (temporary)
          </RtlText>
          <RtlText style={styles.subtitle}>
            Internal P0 instrumentation — not user-facing. Long-press the text below to select/copy manually, or use the Copy button.
          </RtlText>

          {copyFeedback !== 'idle' ? (
            <RtlText style={[styles.copyFeedback, copyFeedback === 'error' && styles.copyFeedbackError]}>
              {copyFeedback === 'success' ? '✓ Copied' : '⚠ Copy failed — select the text below manually'}
            </RtlText>
          ) : null}

          <ScrollView style={styles.scroll}>
            <View style={styles.reportBox}>
              <RtlText style={styles.reportText} selectable>
                {report ?? 'Gathering diagnostic data…'}
              </RtlText>
            </View>
          </ScrollView>

          <View style={styles.actionsRow}>
            <Button label="Copy" variant="secondary" onPress={handleCopy} style={styles.flex} disabled={!report} />
            <Button label="Close" variant="secondary" onPress={onClose} style={styles.flex} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, maxHeight: '88%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: { ...typography.meta, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm },
  copyFeedback: { ...typography.meta, color: colors.success, textAlign: 'center', marginBottom: spacing.xs },
  copyFeedbackError: { color: colors.danger },
  scroll: { flexGrow: 0, flexShrink: 1, marginBottom: spacing.sm },
  reportBox: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.sm },
  reportText: { fontSize: 11, lineHeight: 15, color: colors.textPrimary, textAlign: 'left', writingDirection: 'ltr', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
