import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { WalkieMascot } from './WalkieMascot';

interface DogPhotoProps {
  photoUrl?: string;
  photoCutoutUrl?: string;
  size?: number;
}

/** Dog's photo, falling back to the approved Walkie Doggy mascot if there's no photo or it fails to load. */
export function DogPhoto({ photoUrl, photoCutoutUrl, size = 56 }: DogPhotoProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const preferredUrl = photoCutoutUrl || photoUrl;
  const fallbackUrl = preferredUrl === photoCutoutUrl ? photoUrl : undefined;
  const sourceUrl = preferredUrl && preferredUrl !== failedUrl ? preferredUrl : fallbackUrl && fallbackUrl !== failedUrl ? fallbackUrl : undefined;
  const showPhoto = Boolean(sourceUrl);

  return (
    // Decorative: same reasoning as Avatar.tsx — no `name` prop here, and
    // every caller already shows the dog's name as adjacent text.
    <View accessible={false} style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      {showPhoto ? (
        <Image
          source={{ uri: sourceUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode={sourceUrl === photoCutoutUrl ? 'contain' : 'cover'}
          onError={() => setFailedUrl(sourceUrl ?? null)}
        />
      ) : (
        <WalkieMascot state="idle" size={size * 0.82} testID="dog-photo-mascot-fallback" />
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
