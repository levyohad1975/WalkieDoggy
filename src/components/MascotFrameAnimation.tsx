import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Image, Platform, StyleSheet, View, type ImageSourcePropType } from 'react-native';

export interface MascotFrameAnimationProps {
  frames: ImageSourcePropType[];
  fallback: ImageSourcePropType;
  fps: number;
  size: number;
  accessibilityLabel: string;
  testID?: string;
  /**
   * Real-device QA fix — fires exactly once, the moment playback is about
   * to actually begin (every frame preloaded) or, when there is nothing to
   * preload (Reduced Motion, or fewer than two frames), immediately. A
   * caller that needs to know "the mascot is visibly rendered and
   * animating" (e.g. to reveal a speech bubble only after that point)
   * should use this instead of an arbitrary timer — see its own call site
   * for why an arbitrary timer previously raced the real paint.
   */
  onReady?: () => void;
}

/**
 * Bounded local frame playback for real character art. It deliberately does
 * not transform a flattened fallback bitmap: when a pack has no drawn frames
 * yet, it shows its polished hero fallback instead.
 *
 * Real-device QA fix — each frame is now its own separate asset file (see
 * celebrationAnimationManifest.ts's MASCOT_FRAME_SETS doc comment for why).
 * Unlike a single already-loaded sprite sheet, each of the ~24 distinct
 * frame files needs its own network fetch/decode the first time it is
 * shown — e.g. right after a fresh deploy, before a PWA has cached them.
 * react-native-web's Image always re-triggers a real load on every
 * `source` change (see node_modules/react-native-web/src/exports/Image —
 * it never skips straight to an already-decoded fast path), so swapping
 * `source` on a timer before a frame had actually finished loading left a
 * real window where the browser could paint that frame's slot as solid
 * black instead of transparent while it was still pending. Preloading
 * every frame off-screen before the first tick, and only starting
 * playback once every one has fired `onLoad`/`onError`, removes that
 * window entirely — playback never swaps to a frame that has not already
 * finished loading.
 */
export function MascotFrameAnimation({ frames, fallback, fps, size, accessibilityLabel, testID, onReady }: MascotFrameAnimationProps) {
  const [reducedMotion, setReducedMotion] = useState(true);
  // Fail-safe-default-true above means `reducedMotion` briefly reads "on"
  // before the real async check resolves. Gating onReady on this too —
  // not just on `reducedMotion` itself — stops that default from ever
  // being mistaken for a real "nothing to preload" answer and firing
  // onReady (and so revealing a caller's speech bubble) before Reduced
  // Motion is actually known.
  const [motionChecked, setMotionChecked] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);
  const finished = useRef(false);
  const mountedRef = useRef(true);
  const onReadyRef = useRef(onReady);
  const readyFiredRef = useRef(false);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (active) { setReducedMotion(!!enabled); setMotionChecked(true); } })
      .catch(() => { if (active) { setReducedMotion(false); setMotionChecked(true); } });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { active = false; subscription?.remove?.(); };
  }, []);

  const canAnimate = !reducedMotion && frames.length >= 2;

  // Reset preload progress whenever a genuinely new frame set arrives (by
  // reference — same convention the playback effect below already uses).
  useEffect(() => {
    setLoadedCount(0);
    readyFiredRef.current = false;
  }, [frames]);

  const framesReady = canAnimate && loadedCount >= frames.length;

  useEffect(() => {
    if (readyFiredRef.current || !motionChecked) return;
    // Nothing to preload: fire immediately so a caller waiting on onReady
    // (e.g. to reveal a speech bubble) is never blocked forever.
    if (!canAnimate || framesReady) {
      readyFiredRef.current = true;
      onReadyRef.current?.();
    }
  }, [canAnimate, framesReady, motionChecked]);

  useEffect(() => {
    setFrameIndex(0);
    finished.current = false;
    if (!framesReady) return;
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
  }, [frames, fps, framesReady]);

  const source = framesReady ? frames[Math.min(frameIndex, frames.length - 1)] : fallback;

  // Root cause (real-device QA round 3) — this used to be a fresh closure
  // created inline inside the frames.map() below, so every preload <Image>
  // got a BRAND NEW onLoad/onError function identity on every re-render of
  // this component (including the very re-renders its own setLoadedCount
  // calls triggered). react-native-web's own Image implementation
  // (node_modules/react-native-web/src/exports/Image) keys its internal
  // load-tracking useEffect on `[uri, ..., onError, onLoad, ...]` — i.e. on
  // the callback's IDENTITY, not just the source URI — so a changing
  // onLoad/onError prop makes it abort whatever request was in flight and
  // start a brand new one. The result was a cascading restart loop: frame 1
  // finishing preload re-rendered this component, which hands EVERY one of
  // the ~24 preload Images (including frame 1 itself, and every other frame
  // still mid-flight) a new onLoad/onError, aborting and restarting their
  // loads. On a real iPhone, where each image's fetch/decode genuinely spans
  // multiple event-loop turns (unlike a synchronous test mock), this loop
  // could burn through most or all of WalkCompletionCelebration's 2.6s
  // auto-dismiss window before `framesReady` ever turned true — the mascot
  // sat on the static fallback for virtually the whole celebration, with
  // the speech bubble (gated on this same onReady) appearing late and the
  // High-Five frames barely getting a chance to play, if at all, before
  // dismissal. Using ONE stable callback (identical reference across every
  // render) for every preload Image's onLoad/onError removes the one thing
  // that was triggering react-native-web's effect to restart: each frame
  // now loads exactly once, and `loadedCount` advances by exactly one per
  // frame instead of being inflated/delayed by repeated restarts.
  const handleFrameLoaded = useCallback(() => {
    if (!mountedRef.current) return;
    setLoadedCount((count) => count + 1);
  }, []);

  return (
    <>
      <Image testID={testID} source={source} accessibilityLabel={accessibilityLabel} style={{ width: size, height: size, backgroundColor: 'transparent' }} resizeMode="contain" />
      {canAnimate && !framesReady
        ? frames.map((frame, index) => (
            <Image
              key={index}
              source={frame}
              onLoad={handleFrameLoaded}
              onError={handleFrameLoaded}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={preloadStyles.hidden}
            />
          ))
        : null}
    </>
  );
}

const preloadStyles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});


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
        fadeDuration={0}
        style={{
          position: 'absolute',
          width: columns * size,
          height: rows * size,
          left: -column * size,
          top: -row * size,
          backgroundColor: 'transparent',
          ...(Platform.OS === 'web' ? { imageRendering: 'auto' as const } : {}),
        }}
      />
    </View>
  );
}
