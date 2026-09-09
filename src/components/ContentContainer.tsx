import React from 'react';
import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { breakpoints, layout, spacing } from '../theme/tokens';

interface ContentContainerProps extends ViewProps {
  /** Forms use a narrow readable column; dashboards may opt into a wider one. */
  width?: 'reading' | 'wide';
  style?: ViewStyle;
}

/** Mobile-first content column shared by future screen work. */
export function ContentContainer({ width = 'reading', style, children, ...props }: ContentContainerProps) {
  return (
    <View
      {...props}
      style={[
        styles.base,
        { maxWidth: width === 'reading' ? breakpoints.readingColumn : breakpoints.desktopContent },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xl,
  },
});
