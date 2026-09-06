import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';

interface DogPhotoProps {
  photoUrl?: string;
  size?: number;
}

/** Dog's photo, falling back to a paw emoji placeholder if there's no photo or it fails to load. */
export function DogPhoto({ photoUrl, size = 56 }: DogPhotoProps) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(photoUrl) && !failed;

  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      {showPhoto ? (
        <Image
          source={{ uri: photoUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <RtlText style={{ fontSize: size * 0.5 }}>🐶</RtlText>
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
