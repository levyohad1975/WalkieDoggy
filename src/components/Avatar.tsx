import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';

interface AvatarProps {
  emoji: string;
  color: string;
  photoUrl?: string;
  size?: number;
}

/** Shows a real photo when available (family member / dog), falling back to the emoji if there's no photo or it fails to load. */
export function Avatar({ emoji, color, photoUrl, size = 44 }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  // An earlier URL may have failed because it was stale or still propagating
  // through Storage. A replacement URL is a new resource and must get a new
  // load attempt instead of leaving this avatar stuck on its emoji fallback.
  useEffect(() => setFailed(false), [photoUrl]);
  const showPhoto = Boolean(photoUrl) && !failed;

  return (
    // Decorative: this component has no `name` prop, so it can't build a
    // meaningful accessibilityLabel, and every caller already shows the
    // person's/dog's name as adjacent text (or as an interactive parent's
    // own label). Without `accessible={false}`, the bare photo (or emoji
    // fallback Text) becomes its own untitled screen-reader stop.
    <View
      accessible={false}
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color + '26', borderColor: color },
      ]}
    >
      {showPhoto ? (
        <Image
          source={{ uri: photoUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <RtlText style={{ fontSize: size * 0.5 }}>{emoji}</RtlText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
  },
});
