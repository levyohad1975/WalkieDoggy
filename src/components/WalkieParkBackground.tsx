import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Walkie Park — warm illustrated Home hero scene.
 * The mascot / family dog is rendered by HomeScreen as a separate layer,
 * leaving the right side intentionally open so the dog feels inside the park.
 */
export function WalkieParkBackground() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.sky]} accessibilityElementsHidden>
      <View style={styles.sunGlow} />
      <View style={styles.sun} />

      <View style={styles.cloudLeft}>
        <View style={[styles.cloudPuff, styles.cloudPuffLeft]} />
        <View style={[styles.cloudPuff, styles.cloudPuffMid]} />
        <View style={[styles.cloudPuff, styles.cloudPuffRight]} />
      </View>

      <View style={styles.hillFarLeft} />
      <View style={styles.hillFarRight} />
      <View style={styles.hillNear} />

      <View style={styles.treeLeft}>
        <View style={styles.treeTrunk} />
        <View style={[styles.treeCrown, styles.treeCrownOne]} />
        <View style={[styles.treeCrown, styles.treeCrownTwo]} />
        <View style={[styles.treeCrown, styles.treeCrownThree]} />
      </View>

      <View style={styles.path} />
      <View style={styles.ground} />

      <View style={styles.shrubLeft} />
      <View style={styles.shrubMid} />
      <View style={styles.shrubRight} />

      <View style={styles.flowerOne}><View style={styles.flowerDot} /></View>
      <View style={styles.flowerTwo}><View style={styles.flowerDot} /></View>
      <View style={styles.flowerThree}><View style={styles.flowerDot} /></View>

      <View style={styles.paw}>
        <View style={styles.pawPad} />
        <View style={[styles.pawToe, styles.pawToeOne]} />
        <View style={[styles.pawToe, styles.pawToeTwo]} />
        <View style={[styles.pawToe, styles.pawToeThree]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sky: { backgroundColor: '#FFF8E8', overflow: 'hidden' },
  sunGlow: { position: 'absolute', width: 210, height: 210, borderRadius: 105, right: 42, top: -42, backgroundColor: '#FFF0B8', opacity: 0.5 },
  sun: { position: 'absolute', width: 38, height: 38, borderRadius: 19, right: 92, top: 30, backgroundColor: '#FFD97A', opacity: 0.78 },

  cloudLeft: { position: 'absolute', left: 42, top: 38, width: 82, height: 30, opacity: 0.72 },
  cloudPuff: { position: 'absolute', backgroundColor: '#FFFFFF', borderRadius: 20 },
  cloudPuffLeft: { width: 36, height: 19, left: 0, top: 9 },
  cloudPuffMid: { width: 42, height: 25, left: 22, top: 2 },
  cloudPuffRight: { width: 31, height: 17, left: 51, top: 11 },

  hillFarLeft: { position: 'absolute', left: -72, bottom: 42, width: 300, height: 116, borderRadius: 150, backgroundColor: '#E6F1D7', transform: [{ rotate: '5deg' }] },
  hillFarRight: { position: 'absolute', right: -86, bottom: 44, width: 326, height: 122, borderRadius: 163, backgroundColor: '#DDECCF', transform: [{ rotate: '-5deg' }] },
  hillNear: { position: 'absolute', left: 72, bottom: 16, width: 340, height: 108, borderRadius: 170, backgroundColor: '#CFE6BE', transform: [{ rotate: '2deg' }] },

  treeLeft: { position: 'absolute', left: 18, bottom: 58, width: 82, height: 104 },
  treeTrunk: { position: 'absolute', width: 12, height: 47, left: 31, bottom: 0, borderRadius: 6, backgroundColor: '#B9875D', transform: [{ rotate: '3deg' }] },
  treeCrown: { position: 'absolute', borderRadius: 40, backgroundColor: '#8FCB91' },
  treeCrownOne: { width: 45, height: 45, left: 4, top: 14 },
  treeCrownTwo: { width: 49, height: 49, right: 0, top: 7, backgroundColor: '#7FC486' },
  treeCrownThree: { width: 40, height: 40, left: 18, top: 0, backgroundColor: '#9BD39A' },

  path: { position: 'absolute', width: 270, height: 70, borderRadius: 135, left: 62, bottom: -2, backgroundColor: '#F4DFC0', transform: [{ rotate: '-6deg' }] },
  ground: { position: 'absolute', left: 0, right: 0, bottom: 24, height: 24, backgroundColor: '#D7EBC8', opacity: 0.92 },

  shrubLeft: { position: 'absolute', left: -17, bottom: 39, width: 96, height: 31, borderRadius: 48, backgroundColor: '#AED7A4' },
  shrubMid: { position: 'absolute', left: 96, bottom: 35, width: 82, height: 25, borderRadius: 41, backgroundColor: '#BEDFAF', opacity: 0.9 },
  shrubRight: { position: 'absolute', right: -30, bottom: 37, width: 116, height: 34, borderRadius: 58, backgroundColor: '#A8D39E', opacity: 0.86 },

  flowerOne: { position: 'absolute', left: 104, bottom: 52, width: 8, height: 8, borderRadius: 4, backgroundColor: '#F7A7A0' },
  flowerTwo: { position: 'absolute', left: 130, bottom: 44, width: 7, height: 7, borderRadius: 4, backgroundColor: '#F6C56F' },
  flowerThree: { position: 'absolute', left: 155, bottom: 54, width: 8, height: 8, borderRadius: 4, backgroundColor: '#BCA7E8' },
  flowerDot: { position: 'absolute', width: 3, height: 3, borderRadius: 2, left: 2.5, top: 2.5, backgroundColor: '#FFF8DE' },

  paw: { position: 'absolute', left: 198, top: 28, width: 28, height: 24, opacity: 0.1, transform: [{ rotate: '12deg' }] },
  pawPad: { position: 'absolute', left: 8, top: 11, width: 14, height: 11, borderRadius: 7, backgroundColor: '#4F9B75' },
  pawToe: { position: 'absolute', width: 6, height: 7, borderRadius: 4, backgroundColor: '#4F9B75' },
  pawToeOne: { left: 2, top: 5, transform: [{ rotate: '-22deg' }] },
  pawToeTwo: { left: 11, top: 0 },
  pawToeThree: { right: 2, top: 5, transform: [{ rotate: '22deg' }] },
});
