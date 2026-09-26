import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { PhotoCropModal } from './PhotoCropModal';
import { registerPhotoCropHandler } from '../lib/photoCropHost';

/**
 * Mounted once near App.tsx's root, alongside the isSystemAdmin corner
 * button (same "always rendered outside the branching tree" precedent).
 * Bridges the imperative requestPhotoCrop() calls in uploadImage.ts to a
 * real Modal: pickAndUploadImage() has no JSX tree of its own to render
 * one from, so it calls into the module-level handler registered here
 * instead — see photoCropHost.ts's doc comment. No-op on native: native
 * never calls requestPhotoCrop() (it already has OS-native crop via
 * expo-image-picker's allowsEditing), and this component renders null
 * off-web regardless.
 */
export function PhotoCropHost() {
  const [uri, setUri] = useState<string | null>(null);
  const resolverRef = useRef<((result: string | null) => void) | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    registerPhotoCropHandler(
      (requestedUri) =>
        new Promise((resolve) => {
          resolverRef.current = resolve;
          setUri(requestedUri);
        }),
    );
    return () => registerPhotoCropHandler(null);
  }, []);

  if (Platform.OS !== 'web') return null;

  const handleConfirm = (croppedUri: string) => {
    setUri(null);
    resolverRef.current?.(croppedUri);
    resolverRef.current = null;
  };

  const handleCancel = () => {
    setUri(null);
    resolverRef.current?.(null);
    resolverRef.current = null;
  };

  // Mount PhotoCropModal's <Modal> (and thus create its DOM portal) only
  // once a crop is actually requested, not unconditionally at app start.
  // react-native-web's Modal always applies the SAME fixed z-index to
  // every instance (react-native-web's ModalAnimation component — not
  // configurable from here), so two simultaneously-open Modals stack by
  // plain DOM order: whichever one's underlying <div> was appended to
  // document.body LAST wins. PhotoCropHost lives near App.tsx's root, so
  // an unconditionally-rendered <PhotoCropModal> would create its portal
  // at app startup — permanently EARLIER in the DOM than any screen-level
  // Modal (e.g. DogDetailsModal) opened later — leaving the crop step
  // rendered behind an already-open modal, completely unreachable, with
  // the photo upload stuck forever at "מעלה תמונה...". Rendering nothing
  // until uri is set means the Modal (and its portal) is only created
  // AFTER whichever screen modal triggered the photo picker is already
  // open, so it's always later in DOM order and correctly renders on top.
  if (uri === null) return null;
  return <PhotoCropModal visible uri={uri} onConfirm={handleConfirm} onCancel={handleCancel} />;
}
