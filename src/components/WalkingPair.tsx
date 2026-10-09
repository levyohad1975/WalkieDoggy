import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, G, Defs, LinearGradient, Stop } from 'react-native-svg';

/**
 * Compact illustrated walking scene, designed for the active-walk card.
 * Continuous eight-phase stride, independent tail and arm motion, a leash
 * visibly connected to the walker's hand and the dog's harness.
 */
export function WalkingPair() {
  const [phase, setPhase] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (mounted) setReduceMotion(value); })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription?.remove?.(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(() => setPhase(value => (value + 1) % 16), 75);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  const cycle = phase * Math.PI / 8;
  const stride = Math.sin(cycle);
  const bob = Math.abs(Math.sin(cycle)) * 1.1;
  const wag = Math.sin(cycle * 2) * 5;
  const foot = (x: number, magnitude: number) => (x + stride * magnitude).toFixed(1);
  const backFoot = (x: number, magnitude: number) => (x - stride * magnitude).toFixed(1);

  return (
    <View style={styles.frame} accessible accessibilityLabel="אדם מטייל עם כלב שמח ברצועה">
      <Svg width="164" height="92" viewBox="0 0 164 92">
        <Defs>
          <LinearGradient id="hoodie" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#65CED4" />
            <Stop offset="1" stopColor="#159CA7" />
          </LinearGradient>
          <LinearGradient id="fur" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F5C487" />
            <Stop offset="1" stopColor="#CF8A4E" />
          </LinearGradient>
        </Defs>
        <Ellipse cx="44" cy="86" rx="35" ry="3" fill="#47685E" opacity={0.14} />
        <Ellipse cx="119" cy="86" rx="38" ry="3" fill="#47685E" opacity={0.14} />

        {/* Person: articulated trousers and two separate sneakers. */}
        <Path d={`M42 55 Q${foot(37, 4)} 68 ${foot(27, 13)} 81`}
          stroke="#405A68" strokeWidth="9" strokeLinecap="round" fill="none" />
        <Path d={`M45 55 Q${backFoot(49, 4)} 68 ${backFoot(58, 13)} 81`}
          stroke="#293F52" strokeWidth="9" strokeLinecap="round" fill="none" />
        <Path d={`M${foot(27, 13)} 81 l-9 2 q-2 3 2 3 h14`}
          stroke="#FFFFFF" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={`M${backFoot(58, 13)} 81 l6 2 q3 3 -2 3 h-13`}
          stroke="#FFFFFF" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d="M35 32 Q29 37 32 54 Q42 60 53 54 L51 37 Q46 30 35 32Z"
          fill="url(#hoodie)" />
        <Path d="M38 33 Q43 40 49 34" stroke="#C3F1E9" strokeWidth="2" fill="none" opacity={0.75} />
        <Path d="M32 39 Q24 48 20 51" stroke="#F0B58D" strokeWidth="5.5" strokeLinecap="round" fill="none" />
        <Path d={`M50 39 Q58 ${49 + stride * 2} 66 54`}
          stroke="#E5A77F" strokeWidth="5.5" strokeLinecap="round" fill="none" />
        <Circle cx="66" cy="54" r="3.4" fill="#E5A77F" />
        <Path d="M38 28 L39 34 L47 34 L47 28" fill="#E8A67E" />
        <Ellipse cx="43" cy="20" rx="12" ry="14" fill="#F0BA93" />
        <Path d="M31 20 Q28 5 41 5 Q52 1 56 13 Q51 12 49 9 Q42 16 31 15Z" fill="#574038" />
        <Path d="M32 15 Q30 10 34 8" stroke="#7B5140" strokeWidth="3" strokeLinecap="round" />
        <Circle cx="51" cy="20" r="1.3" fill="#303C46" />
        <Path d="M49 25 Q53 27 55 23" stroke="#9B6156" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <Path d="M33 29 Q43 34 53 29" stroke="#F0BA93" strokeWidth="1.5" fill="none" />

        {/* Dog: four independently moving paws, full fluffy silhouette. */}
        <G transform={`translate(0 ${-bob.toFixed(1)})`}>
          <Path d={`M143 57 Q155 ${44 + wag} 158 ${48 + wag}`}
            stroke="#CB874C" strokeWidth="9" strokeLinecap="round" fill="none" />
          <Path d={`M115 70 L${foot(109, 6)} 83`} stroke="#D3995C" strokeWidth="6.5" strokeLinecap="round" />
          <Path d={`M140 69 L${backFoot(145, 6)} 83`} stroke="#BD7C45" strokeWidth="6.5" strokeLinecap="round" />
          <Path d={`M108 68 L${backFoot(103, 6)} 83`} stroke="#BD7C45" strokeWidth="5.5" strokeLinecap="round" />
          <Path d={`M136 69 L${foot(132, 6)} 83`} stroke="#E5B076" strokeWidth="5.5" strokeLinecap="round" />
          <Ellipse cx="126" cy="59" rx="26" ry="17" fill="url(#fur)" />
          <Path d="M109 60 Q124 77 142 62 Q129 72 115 67Z" fill="#F6D8B3" />
          <Path d="M108 48 Q114 53 114 63" stroke="#8C5E43" strokeWidth="3.5" fill="none" />
          <Path d="M109 49 Q118 44 128 45" stroke="#246F7D" strokeWidth="3.8" fill="none" />
          <Path d="M120 45 L124 62" stroke="#246F7D" strokeWidth="3.6" />
          <Circle cx="112" cy="48" r="2.8" fill="#246F7D" />
          <Path d="M110 49 Q100 45 95 47" stroke="#F3C184" strokeWidth="11" strokeLinecap="round" fill="none" />
          <Ellipse cx="96" cy="44" rx="15" ry="13" fill="url(#fur)" />
          <Path d="M94 34 Q79 28 85 49 Q91 53 95 44Z" fill="#B77745" />
          <Ellipse cx="85" cy="49" rx="11" ry="7" fill="#F7DBB5" />
          <Circle cx="79" cy="47" r="2.5" fill="#3B3432" />
          <Circle cx="99" cy="40" r="2" fill="#302D2B" />
          <Path d="M79 53 Q87 60 92 52" stroke="#9C5C54" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <Path d="M86 55 Q89 65 93 60 Q95 55 90 55Z" fill="#E88186" />
        </G>

        {/* Leash is drawn on top, terminating at the harness ring. */}
        <Path d={`M66 54 Q81 ${69 + stride * 1.5} 112 ${48 - bob}`}
          stroke="#3E6475" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <Circle cx="112" cy={48 - bob} r="2.5" fill="#F4D6A7" stroke="#3E6475" strokeWidth="1.5" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: 164, height: 92, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
