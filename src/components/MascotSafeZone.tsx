import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, useWindowDimensions } from 'react-native';

interface MascotSafeZoneProps {
  children: React.ReactNode;
  /** Entrance edge alternates naturally without ever covering fixed chrome. */
  from?: 'left' | 'right';
  testID?: string;
}

/**
 * Shared "character lives inside the phone" stage.
 *
 * It starts fully outside the physical viewport, enters horizontally into a
 * bounded central safe zone, and never participates in layout. The vertical
 * band deliberately avoids the header/hero/primary next-walk card above and
 * bottom navigation below. Event overlays can therefore feel playful without
 * obscuring the controls that caused them.
 */
export function MascotSafeZone({ children, from = 'right', testID }: MascotSafeZoneProps) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const { width } = useWindowDimensions();
  const travel = Math.max(260, width * 0.78);
  const translateX = useRef(new Animated.Value(from === 'right' ? travel : -travel)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => mounted && setReducedMotion(!!enabled))
      .catch(() => mounted && setReducedMotion(false));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { mounted = false; subscription?.remove?.(); };
  }, []);

  useEffect(() => {
    translateX.setValue(reducedMotion ? 0 : (from === 'right' ? travel : -travel));
    opacity.setValue(reducedMotion ? 1 : 0);
    if (reducedMotion) return;
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: 850,
        easing: (t) => 1 - Math.pow(1 - t, 3),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [from, opacity, reducedMotion, translateX, travel]);

  return (
    <View pointerEvents="box-none" style={styles.stage} testID={testID}>
      <Animated.View style={[styles.character, { opacity, transform: [{ translateX }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // Keep event animation in the visual center, below the large next-walk
    // card and above the persistent bottom navigation on compact phones.
    // Keep the mascot in its own lower-right lane. Center placement can visually
    // merge with the yellow walk-edit pencil on Home, especially on iPhone.
    // The inset also keeps the character clear of the screen edge while the
    // bottom padding protects the persistent navigation.
    paddingTop: '42%',
    paddingRight: 22,
    paddingBottom: 112,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  character: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 340,
  },
});
