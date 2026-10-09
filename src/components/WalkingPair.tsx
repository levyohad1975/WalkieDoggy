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
    const id = setInterval(() => setPhase(p => (p + 1) % 8), 90);
    return () => clearInterval(id);
  }, [reduceMotion]);
  const stride = Math.sin((phase / 8) * Math.PI * 2);
  const opposite = -stride;
  const swing = (base: number, amount: number) => (base + stride * amount).toFixed(1);
  const reverseSwing = (base: number, amount: number) => (base + opposite * amount).toFixed(1);
  return (
    <View style={styles.frame} accessibilityLabel="אדם וכלב הולכים יחד עם רצועה">
      <Svg width="156" height="84" viewBox="0 0 142 76">
        <Ellipse cx="38" cy="70" rx="25" ry="3" fill="#6C9D87" opacity={0.18} />
        <Ellipse cx="103" cy="70" rx="31" ry="3" fill="#6C9D87" opacity={0.18} />
        {/* Walker's alternating legs, with distinct foot positions. */}
        <Path d={`M37 42 L${swing(31, 8)} 55 L${swing(22, 15)} 68`} stroke="#24405D" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={`M37 42 L${reverseSwing(43, 8)} 55 L${reverseSwing(52, 15)} 68`} stroke="#344F70" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={`M${swing(22,15)} 68 l-7 0 M${reverseSwing(52,15)} 68 l7 0`} stroke="#1E4055" strokeWidth="4" strokeLinecap="round" />
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
        <Path d={`M99 57 L${swing(99,7)} 68 M115 57 L${reverseSwing(115,7)} 68`} stroke="#A8653B" strokeWidth="5" strokeLinecap="round" fill="none" />
        <Path d={`M91 56 L${reverseSwing(91,6)} 68 M121 56 L${swing(121,6)} 67`} stroke="#C18450" strokeWidth="4" strokeLinecap="round" fill="none" />
        <Ellipse cx="108" cy="49" rx="23" ry="13" fill="#C88955" />
        <Ellipse cx="105" cy="51" rx="12" ry="7" fill="#EBCBA6" />
        {/* Wagging tail, independent from the walker's stride. */}
        <Path d={`M127 44 Q139 ${35 + Math.sin(phase * Math.PI / 2) * 5} 138 ${41 + Math.sin(phase * Math.PI / 2) * 7}`} stroke="#A8683F" strokeWidth="5" strokeLinecap="round" fill="none" />
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
const styles = StyleSheet.create({ frame: { width: 156, height: 84, alignItems: 'center', justifyContent: 'center', flexShrink: 0 } });
