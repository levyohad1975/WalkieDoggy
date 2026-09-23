import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { WalkieMascot } from './WalkieMascot';

interface DogPhotoProps {
  photoUrl?: string;
  size?: number;
}

/** Dog's photo, falling back to the animated Walkie mascot if there is no photo. */
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
        <WalkieMascot state="idle" size={Math.round(size * 0.82)} />
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
