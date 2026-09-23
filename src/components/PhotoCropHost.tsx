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

  return <PhotoCropModal visible={uri !== null} uri={uri} onConfirm={handleConfirm} onCancel={handleCancel} />;
}
