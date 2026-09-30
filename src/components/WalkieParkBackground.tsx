import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

/**
 * Walkie Park — approved default Home hero artwork.
 * The source artwork is landscape while the mobile hero is intentionally
 * shallow. A slightly oversized image anchored toward its lower half keeps
 * the path/flowers visible instead of showing mostly sky and treetops.
 */
export function WalkieParkBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
      <Image
        source={require('../../assets/walkie-park-default.jpg')}
        style={styles.artwork}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  artwork: {
    position: 'absolute',
    left: 0,
    right: 0,
    width: '100%',
    height: '178%',
    bottom: '-24%',
  },
});
