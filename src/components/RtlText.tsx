import React from 'react';
import { StyleSheet, Text as RNText, type TextProps } from 'react-native';

/**
 * App-wide Hebrew text primitive.
 *
 * React Native's RTL layout direction does not guarantee that every Text
 * node gets a useful full Hebrew paragraph direction/alignment (especially
 * inside rows/cards with mixed numbers/emoji).  Keep the app's default
 * explicit here instead of relying on dozens of one-off screen fixes.
 * Callers can still override textAlign/writingDirection in `style` for
 * intentionally centred or LTR content (times, URLs, PINs, etc.).
 */
export function RtlText({ style, ...props }: TextProps) {
  return <RNText {...props} style={[styles.rtl, style]} />;
}

const styles = StyleSheet.create({
  rtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
