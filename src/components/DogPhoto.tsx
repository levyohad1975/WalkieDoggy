import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';

interface DogPhotoProps {
  photoUrl?: string;
  size?: number;
}

/** Dog photo is optional. Without one (or if it fails), show the Walkie Doggy app/logo artwork. */
export function DogPhoto({ photoUrl, size = 56 }: DogPhotoProps) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(photoUrl) && !failed;

  return (
    // Decorative: same reasoning as Avatar.tsx — no `name` prop here, and
    // every caller already shows the dog's name as adjacent text.
    <View accessible={false} style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      {showPhoto ? (
        <Image
          source={{ uri: photoUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Image
          source={require('../../assets/icon.png')}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
  },
});
