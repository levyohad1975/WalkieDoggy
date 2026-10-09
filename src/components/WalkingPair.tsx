import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

/** Two-frame illustrated walk cycle. Legs and tail change pose independently;
 * the leash is drawn as one continuous line between hand and collar.
 * Honors iOS Reduce Motion and stops updating when the walk ends/unmounts.
 */
export function WalkingPair() {
  const [phase, setPhase] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (mounted) setReduceMotion(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; sub?.remove?.(); };
  }, []);
  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setPhase(p => 1 - p), 280);
    return () => clearInterval(id);
  }, [reduceMotion]);
  const a = phase === 0;
  return (
    <View style={styles.frame} accessibilityLabel="אדם וכלב הולכים יחד עם רצועה">
      <Svg width="142" height="76" viewBox="0 0 142 76">
        <Ellipse cx="38" cy="70" rx="25" ry="3" fill="#6C9D87" opacity={0.18} />
        <Ellipse cx="103" cy="70" rx="31" ry="3" fill="#6C9D87" opacity={0.18} />
        {/* Walker's alternating legs, with distinct foot positions. */}
        <Path d={a ? "M37 42 L30 55 L20 68" : "M37 42 L43 56 L54 68"} stroke="#24405D" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={a ? "M37 42 L44 55 L54 68" : "M37 42 L29 56 L20 68"} stroke="#344F70" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={a ? "M20 68 L13 68 M54 68 L61 68" : "M54 68 L61 68 M20 68 L13 68"} stroke="#1E4055" strokeWidth="4" strokeLinecap="round" />
        {/* Hoodie, head, hair and face. */}
        <Path d="M34 23 Q24 29 29 44 L45 44 Q49 30 40 24Z" fill="#13A7AD" />
        <Path d="M31 30 L23 41 L18 44" stroke="#E9AC80" strokeWidth="4.5" strokeLinecap="round" fill="none" />
        <Path d="M43 30 L52 42 L59 44" stroke="#E9AC80" strokeWidth="4.5" strokeLinecap="round" fill="none" />
        <Circle cx="37" cy="15" r="10" fill="#EFB78B" />
        <Path d="M27 16 Q23 2 38 3 Q49 4 46 17 L42 11 L30 11Z" fill="#69412E" />
        <Circle cx="42" cy="16" r="1.3" fill="#253B4B" />
        {/* The same leash stays connected in both animation frames. */}
        <Path d="M59 44 Q72 60 88 43" stroke="#CB6753" strokeWidth="2.8" strokeLinecap="round" fill="none" />
        {/* Dog's alternating front and rear legs. */}
        <Path d={a ? "M99 57 L93 68 M115 57 L122 68" : "M99 57 L105 68 M115 57 L108 68"} stroke="#A8653B" strokeWidth="5" strokeLinecap="round" fill="none" />
        <Path d={a ? "M91 56 L85 68 M121 56 L127 67" : "M91 56 L96 68 M121 56 L116 68"} stroke="#C18450" strokeWidth="4" strokeLinecap="round" fill="none" />
        <Ellipse cx="108" cy="49" rx="23" ry="13" fill="#C88955" />
        <Ellipse cx="105" cy="51" rx="12" ry="7" fill="#EBCBA6" />
        {/* Wagging tail, independent from the walker's stride. */}
        <Path d={a ? "M127 44 Q139 30 138 39" : "M127 44 Q140 42 139 50"} stroke="#A8683F" strokeWidth="5" strokeLinecap="round" fill="none" />
        <Circle cx="86" cy="39" r="12" fill="#C88955" />
        <Path d="M83 32 Q70 26 75 46 Q80 49 84 40" fill="#91532E" />
        <Ellipse cx="77" cy="43" rx="8" ry="5" fill="#F6E5CE" />
        <Circle cx="76" cy="42" r="2" fill="#322A28" />
        <Circle cx="88" cy="36" r="1.7" fill="#322A28" />
        <Path d="M88 43 L92 47" stroke="#166E74" strokeWidth="3.5" strokeLinecap="round" />
        <Circle cx="88" cy="43" r="2" fill="#166E74" />
      </Svg>
    </View>
  );
}
const styles = StyleSheet.create({ frame: { width: 142, height: 76, alignItems: 'center', justifyContent: 'center', flexShrink: 0 } });
