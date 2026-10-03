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
      <View style={styles.cloudOne} />
      <View style={styles.cloudTwo} />

      <View style={styles.distantLawn} />
      <View style={styles.lawn} />
      <View style={styles.path} />
      <View style={styles.pathHighlight} />

      <View style={styles.treeLeft}>
        <View style={styles.trunk} />
        <View style={[styles.crown, styles.crownA]} />
        <View style={[styles.crown, styles.crownB]} />
        <View style={[styles.crown, styles.crownC]} />
      </View>
      <View style={styles.treeFar}>
        <View style={styles.farTrunk} />
        <View style={styles.farCrown} />
      </View>

      <View style={styles.fence}>
        <View style={[styles.fencePost, { left: 0 }]} />
        <View style={[styles.fencePost, { left: 52 }]} />
        <View style={[styles.fencePost, { left: 104 }]} />
        <View style={styles.fenceRailTop} />
        <View style={styles.fenceRailBottom} />
      </View>

      <View style={styles.lamp}>
        <View style={styles.lampPost} />
        <View style={styles.lampArm} />
        <View style={styles.lampHead} />
      </View>

      <View style={styles.bench}>
        <View style={styles.benchBack} />
        <View style={styles.benchSeat} />
        <View style={[styles.benchLeg, { left: 10 }]} />
        <View style={[styles.benchLeg, { right: 10 }]} />
      </View>

      <View style={styles.shrubLeft} />
      <View style={styles.shrubRight} />
      <View style={[styles.flower, styles.flowerA]} />
      <View style={[styles.flower, styles.flowerB]} />
      <View style={[styles.flower, styles.flowerC]} />
      <View style={[styles.paw, styles.pawA]} />
      <View style={[styles.paw, styles.pawB]} />
    </View>
  );
}

const styles = StyleSheet.create({
  sky: { backgroundColor: '#FFF5D9', overflow: 'hidden' },
  sunGlow: { position: 'absolute', width: 230, height: 230, borderRadius: 115, right: 34, top: -76, backgroundColor: '#FFE9A6', opacity: 0.58 },
  sun: { position: 'absolute', width: 42, height: 42, borderRadius: 21, right: 86, top: 42, backgroundColor: '#FFD36A', opacity: 0.9 },
  cloudOne: { position: 'absolute', width: 90, height: 22, borderRadius: 20, left: 30, top: 64, backgroundColor: '#FFFFFF', opacity: 0.58 },
  cloudTwo: { position: 'absolute', width: 64, height: 17, borderRadius: 18, left: 116, top: 92, backgroundColor: '#FFFFFF', opacity: 0.42 },

  distantLawn: { position: 'absolute', left: -80, right: -80, top: 118, height: 155, borderRadius: 120, backgroundColor: '#DDECCB', transform: [{ rotate: '-2deg' }] },
  lawn: { position: 'absolute', left: -40, right: -40, bottom: -18, height: 170, borderRadius: 90, backgroundColor: '#B9DFA8' },
  path: { position: 'absolute', width: 430, height: 112, borderRadius: 210, left: 66, bottom: -42, backgroundColor: '#F2D4AA', transform: [{ rotate: '-10deg' }] },
  pathHighlight: { position: 'absolute', width: 330, height: 38, borderRadius: 170, left: 118, bottom: 17, backgroundColor: '#F8E4C7', opacity: 0.72, transform: [{ rotate: '-10deg' }] },

  treeLeft: { position: 'absolute', left: 20, bottom: 72, width: 112, height: 154 },
  trunk: { position: 'absolute', width: 16, height: 74, left: 46, bottom: 0, borderRadius: 8, backgroundColor: '#A97952' },
  crown: { position: 'absolute', borderRadius: 50, backgroundColor: '#69B979' },
  crownA: { width: 72, height: 72, left: 0, top: 25 },
  crownB: { width: 78, height: 78, right: 0, top: 18, backgroundColor: '#58AD6D' },
  crownC: { width: 66, height: 66, left: 24, top: 0, backgroundColor: '#7BC786' },
  treeFar: { position: 'absolute', left: 154, bottom: 101, width: 54, height: 88, opacity: 0.78 },
  farTrunk: { position: 'absolute', width: 8, height: 42, left: 23, bottom: 0, borderRadius: 4, backgroundColor: '#AE805C' },
  farCrown: { position: 'absolute', width: 54, height: 54, borderRadius: 27, top: 0, backgroundColor: '#8BCB8D' },

  fence: { position: 'absolute', left: 12, bottom: 38, width: 124, height: 48, opacity: 0.78 },
  fencePost: { position: 'absolute', bottom: 0, width: 7, height: 46, borderRadius: 4, backgroundColor: '#FFF4DE' },
  fenceRailTop: { position: 'absolute', left: 0, right: 0, top: 12, height: 7, borderRadius: 4, backgroundColor: '#FFF4DE' },
  fenceRailBottom: { position: 'absolute', left: 0, right: 0, top: 30, height: 7, borderRadius: 4, backgroundColor: '#FFF4DE' },

  lamp: { position: 'absolute', left: 218, bottom: 92, width: 32, height: 98, opacity: 0.82 },
  lampPost: { position: 'absolute', width: 5, height: 78, left: 13, bottom: 0, borderRadius: 3, backgroundColor: '#365F5C' },
  lampArm: { position: 'absolute', width: 19, height: 5, left: 13, top: 17, borderRadius: 3, backgroundColor: '#365F5C' },
  lampHead: { position: 'absolute', width: 18, height: 16, right: 0, top: 18, borderRadius: 7, backgroundColor: '#FFD97A', borderWidth: 3, borderColor: '#365F5C' },

  bench: { position: 'absolute', left: 148, bottom: 54, width: 86, height: 48, opacity: 0.9 },
  benchBack: { position: 'absolute', left: 0, right: 0, top: 4, height: 17, borderRadius: 6, backgroundColor: '#C98D58' },
  benchSeat: { position: 'absolute', left: 2, right: 2, top: 25, height: 9, borderRadius: 5, backgroundColor: '#B97B49' },
  benchLeg: { position: 'absolute', top: 31, width: 6, height: 16, borderRadius: 3, backgroundColor: '#365F5C' },

  shrubLeft: { position: 'absolute', left: -20, bottom: 23, width: 116, height: 40, borderRadius: 58, backgroundColor: '#7FC487' },
  shrubRight: { position: 'absolute', right: -26, bottom: 18, width: 132, height: 43, borderRadius: 66, backgroundColor: '#76BD80', opacity: 0.92 },
  flower: { position: 'absolute', width: 9, height: 9, borderRadius: 5, backgroundColor: '#F08E88', borderWidth: 2, borderColor: '#FFF2C7' },
  flowerA: { left: 108, bottom: 48 },
  flowerB: { left: 137, bottom: 39, backgroundColor: '#A88ADD' },
  flowerC: { left: 260, bottom: 62, backgroundColor: '#F1B85D' },

  paw: { position: 'absolute', width: 18, height: 13, borderRadius: 8, backgroundColor: '#D2A878', opacity: 0.22, transform: [{ rotate: '-18deg' }] },
  pawA: { left: 278, bottom: 40 },
  pawB: { left: 310, bottom: 28, opacity: 0.16 },
});

