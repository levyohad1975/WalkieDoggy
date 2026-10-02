import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Walkie hills — lightweight default Home hero background.
 * Deliberately calm: the official mascot is rendered separately by HomeScreen,
 * so this scene never replaces or competes with the product mascot.
 */
export function WalkieParkBackground() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.sky]} accessibilityElementsHidden>
      <View style={styles.sunGlow} />
      <View style={styles.hillBack} />
      <View style={styles.hillMid} />
      <View style={styles.hillFront} />
      <View style={styles.shrubLeft} />
      <View style={styles.shrubLeftSmall} />
      <View style={styles.shrubRight} />
      <View style={styles.ground} />
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
  sky: { backgroundColor: '#FFF9EA', overflow: 'hidden' },
  sunGlow: { position: 'absolute', width: 190, height: 190, borderRadius: 95, backgroundColor: '#FFF2C8', right: 76, top: -108, opacity: 0.62 },
  hillBack: { position: 'absolute', left: -70, right: 250, height: 92, bottom: 18, borderRadius: 90, backgroundColor: '#E7F2D8', transform: [{ rotate: '5deg' }] },
  hillMid: { position: 'absolute', left: 150, right: -80, height: 84, bottom: 12, borderRadius: 88, backgroundColor: '#DDEFD3', transform: [{ rotate: '-5deg' }] },
  hillFront: { position: 'absolute', left: -90, right: 320, height: 62, bottom: -8, borderRadius: 70, backgroundColor: '#D3E9C4' },
  shrubLeft: { position: 'absolute', left: -18, bottom: 4, width: 92, height: 34, borderRadius: 46, backgroundColor: '#C5E2B7', opacity: 0.72 },
  shrubLeftSmall: { position: 'absolute', left: 46, bottom: 8, width: 52, height: 24, borderRadius: 28, backgroundColor: '#D6EBC8', opacity: 0.8 },
  shrubRight: { position: 'absolute', right: -28, bottom: 3, width: 104, height: 38, borderRadius: 52, backgroundColor: '#CBE5BC', opacity: 0.7 },
  ground: { position: 'absolute', left: 0, right: 0, height: 16, bottom: 0, backgroundColor: '#F3E5C5', opacity: 0.68 },
  paw: { position: 'absolute', left: 78, top: 72, width: 30, height: 26, opacity: 0.16 },
  pawPad: { position: 'absolute', left: 8, top: 11, width: 15, height: 12, borderRadius: 8, backgroundColor: '#77B98B' },
  pawToe: { position: 'absolute', width: 7, height: 8, borderRadius: 5, backgroundColor: '#77B98B' },
  pawToeOne: { left: 2, top: 4, transform: [{ rotate: '-22deg' }] },
  pawToeTwo: { left: 11, top: 0 },
  pawToeThree: { right: 2, top: 4, transform: [{ rotate: '22deg' }] },
});
