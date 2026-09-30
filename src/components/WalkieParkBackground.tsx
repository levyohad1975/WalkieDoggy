import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

/**
 * Walkie Park — branded default Home hero scene.
 * Kept as vectors so it is crisp on iPhone/Android/Web without another
 * heavyweight raster asset. The live WalkieMascot remains layered above it.
 */
export function WalkieParkBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
      <Svg width="100%" height="100%" viewBox="0 0 800 304" preserveAspectRatio="xMidYMid slice">
        <Rect width="800" height="304" fill="#EAF7F6" />
        <Circle cx="545" cy="64" r="38" fill="#FFE08A" opacity={0.92} />
        <Path d="M0 126 C110 72 210 118 302 100 C410 80 490 120 800 70 L800 304 L0 304 Z" fill="#D8EED7" />
        <Path d="M0 174 C105 124 214 178 324 142 C456 100 576 158 800 126 L800 304 L0 304 Z" fill="#B9DEB8" />
        <Path d="M315 304 C345 244 414 211 501 190 C595 168 690 169 800 180 L800 304 Z" fill="#F5DDA7" />
        <Path d="M358 304 C392 250 455 221 526 202 C608 180 690 183 800 193" fill="none" stroke="#FFF1CC" strokeWidth="38" strokeLinecap="round" />
        <G opacity={0.92}>
          <Circle cx="76" cy="92" r="58" fill="#73B879" />
          <Circle cx="132" cy="74" r="49" fill="#8AC983" />
          <Rect x="91" y="116" width="14" height="88" rx="7" fill="#9B6A45" />
          <Circle cx="710" cy="102" r="56" fill="#79BC7C" />
          <Circle cx="758" cy="86" r="43" fill="#93CD86" />
          <Rect x="730" y="126" width="13" height="76" rx="6" fill="#9B6A45" />
        </G>
        <G fill="#9B6A45" opacity={0.92}>
          <Rect x="155" y="182" width="170" height="8" rx="4" />
          <Rect x="162" y="159" width="8" height="58" rx="4" />
          <Rect x="232" y="163" width="8" height="48" rx="4" />
          <Rect x="309" y="166" width="8" height="43" rx="4" />
        </G>
        <G fill="#A9825B" opacity={0.72} transform="translate(510 234) rotate(-12)">
          <Ellipse cx="0" cy="0" rx="13" ry="10" />
          <Circle cx="-13" cy="-14" r="5" />
          <Circle cx="-3" cy="-18" r="5" />
          <Circle cx="8" cy="-17" r="5" />
          <Circle cx="17" cy="-10" r="5" />
        </G>
        <G fill="#A9825B" opacity={0.64} transform="translate(603 214) rotate(10) scale(.72)">
          <Ellipse cx="0" cy="0" rx="13" ry="10" />
          <Circle cx="-13" cy="-14" r="5" />
          <Circle cx="-3" cy="-18" r="5" />
          <Circle cx="8" cy="-17" r="5" />
          <Circle cx="17" cy="-10" r="5" />
        </G>
        <Path d="M0 260 C84 236 126 244 206 265 C265 280 304 279 352 263 L352 304 L0 304 Z" fill="#4E9E68" opacity={0.72} />
      </Svg>
    </View>
  );
}
