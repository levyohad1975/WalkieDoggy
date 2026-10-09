import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';

/** Compact illustrated walking pair for the active-walk banner.
 * The leash is one continuous SVG path from the walker's hand to the dog's collar,
 * so it cannot drift apart during the shared walking animation.
 */
export function WalkingPair({ bob }: { bob: Animated.Value }) {
  return (
    <View style={styles.frame} accessibilityLabel="אדם וכלב הולכים יחד, מחוברים ברצועה">
      <Animated.View style={{ transform: [{ translateY: bob }] }}>
        <Svg width={120} height={65} viewBox="0 0 120 65">
          {/* Soft ground shadows */}
          <Ellipse cx="87" cy="60" rx="28" ry="3" fill="#8BB9A5" opacity={0.28} />
          <Ellipse cx="30" cy="60" rx="18" ry="3" fill="#8BB9A5" opacity={0.28} />
          {/* Walking person, full body */}
          <Path d="M29 34 L24 46 L16 57" stroke="#253C56" strokeWidth="5" strokeLinecap="round" fill="none" />
          <Path d="M29 34 L36 46 L44 56" stroke="#253C56" strokeWidth="5" strokeLinecap="round" fill="none" />
          <Path d="M15 57 L10 57 M44 56 L49 56" stroke="#1E4658" strokeWidth="4" strokeLinecap="round" />
          <Path d="M28 17 Q19 23 26 36 L37 36 Q39 25 33 18Z" fill="#18A6AB" />
          <Path d="M26 22 L19 33 L14 38" stroke="#E7AA7B" strokeWidth="4" strokeLinecap="round" fill="none" />
          <Path d="M34 23 L41 32 L49 35" stroke="#E7AA7B" strokeWidth="4" strokeLinecap="round" fill="none" />
          <Circle cx="29" cy="10" r="8" fill="#F1BD90" />
          <Path d="M21 10 Q19 -1 29 1 Q40 0 37 11 L33 6 L24 7Z" fill="#583A2B" />
          <Circle cx="33" cy="11" r="1" fill="#28354B" />
          {/* Leash: attached at hand (49,35) and dog collar (80,36) */}
          <Path d="M49 35 Q63 51 80 36" stroke="#CF654F" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          {/* Dog legs in alternating stride */}
          <Path d="M82 49 L75 59 M91 49 L97 59 M102 48 L107 57" stroke="#9C6038" strokeWidth="4" strokeLinecap="round" fill="none" />
          <Ellipse cx="91" cy="43" rx="19" ry="11" fill="#C98852" />
          <Path d="M106 39 Q115 26 117 35" stroke="#A96B40" strokeWidth="4" strokeLinecap="round" fill="none" />
          <Circle cx="77" cy="33" r="10" fill="#C98852" />
          <Path d="M74 27 Q65 22 67 39 Q72 42 75 35" fill="#91532E" />
          <Ellipse cx="69" cy="36" rx="7" ry="5" fill="#F6E5CE" />
          <Circle cx="68" cy="35" r="1.8" fill="#2A2929" />
          <Circle cx="78" cy="31" r="1.5" fill="#2A2929" />
          <Path d="M80 36 L83 40" stroke="#166E74" strokeWidth="3" strokeLinecap="round" />
          <Circle cx="80" cy="36" r="2" fill="#166E74" />
        </Svg>
      </Animated.View>
    </View>
  );
}
const styles = StyleSheet.create({ frame: { width: 120, height: 65, alignItems: 'center', justifyContent: 'center' } });
