import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

/**
 * Walkie Park — approved default Home hero artwork.
 * The live WalkieMascot remains layered above this background by HomeScreen.
 */
export function WalkieParkBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
      <Image
        source={require('../../assets/walkie-park-default.jpg')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
