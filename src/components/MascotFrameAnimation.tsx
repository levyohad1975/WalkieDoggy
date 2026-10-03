import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Image, View, type ImageSourcePropType } from 'react-native';

export interface MascotFrameAnimationProps {
  frames: ImageSourcePropType[];
  fallback: ImageSourcePropType;
  fps: number;
  size: number;
  accessibilityLabel: string;
  testID?: string;
}

/**
 * Bounded local frame playback for real character art. It deliberately does
 * not transform a flattened fallback bitmap: when a pack has no drawn frames
 * yet, it shows its polished hero fallback instead.
 */
export function MascotFrameAnimation({ frames, fallback, fps, size, accessibilityLabel, testID }: MascotFrameAnimationProps) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);
  const finished = useRef(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => active && setReducedMotion(!!enabled)).catch(() => active && setReducedMotion(false));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { active = false; subscription?.remove?.(); };
  }, []);

  useEffect(() => {
    setFrameIndex(0);
    finished.current = false;
    if (reducedMotion || frames.length < 2) return;
    const timer = setInterval(() => {
      setFrameIndex((current) => {
        if (current >= frames.length - 1) {
          finished.current = true;
          clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, Math.max(50, Math.round(1000 / fps)));
    return () => clearInterval(timer);
  }, [frames, fps, reducedMotion]);

  const source = reducedMotion || frames.length < 2 ? fallback : frames[Math.min(frameIndex, frames.length - 1)];
  return <Image testID={testID} source={source} accessibilityLabel={accessibilityLabel} style={{ width: size, height: size }} resizeMode="contain" />;
}


export interface MascotSpriteAnimationProps {
  source: ImageSourcePropType;
  columns: number;
  rows: number;
  frameSize: number;
  frameCount: number;
  fps: number;
  size: number;
  fallback: ImageSourcePropType;
  accessibilityLabel: string;
  testID?: string;
}

/** Plays a compact transparent sprite sheet without a video/runtime dependency. */
export function MascotSpriteAnimation({ source, columns, rows, frameSize, frameCount, fps, size, fallback, accessibilityLabel, testID }: MascotSpriteAnimationProps) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => active && setReducedMotion(!!enabled)).catch(() => active && setReducedMotion(false));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { active = false; subscription?.remove?.(); };
  }, []);

  useEffect(() => {
    setFrameIndex(0);
    if (reducedMotion || frameCount < 2) return;
    const timer = setInterval(() => {
      setFrameIndex((current) => {
        if (current >= frameCount - 1) {
          clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, Math.max(50, Math.round(1000 / fps)));
    return () => clearInterval(timer);
  }, [fps, frameCount, reducedMotion]);

  if (reducedMotion) {
    return <Image testID={testID} source={fallback} accessibilityLabel={accessibilityLabel} style={{ width: size, height: size }} resizeMode="contain" />;
  }

  const column = frameIndex % columns;
  const row = Math.floor(frameIndex / columns);
  return (
    <View testID={testID} accessibilityLabel={accessibilityLabel} style={{ width: size, height: size, overflow: 'hidden', backgroundColor: 'transparent' }}>
      <Image
        source={source}
        resizeMode="stretch"
        style={{
          position: 'absolute',
          width: columns * size,
          height: rows * size,
          left: -column * size,
          top: -row * size,
          backgroundColor: 'transparent',
        }}
      />
    </View>
  );
}
