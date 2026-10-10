import { Linking, Platform } from 'react-native';
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_TARGET_BYTES,
  CHAT_IMAGE_TARGET_EDGE,
  chatImageFileName,
  checkChatImageSource,
  checkPreparedChatImage,
  chooseChatImageSaveStrategy,
  fitWithin,
  type ChatImageProblem,
  type ChatImageSaveOutcome,
  type ChatImageSaveStrategy,
} from '../logic/chatImages';

/**
 * Device side of chat image messages: choosing a photo, preparing it for
 * upload, and saving a received one.
 *
 * PREPARATION (web — the deployed product is the PWA): the chosen file is
 * decoded with its EXIF orientation applied, drawn onto a canvas no larger
 * than CHAT_IMAGE_TARGET_EDGE, and re-encoded as JPEG. Re-encoding from
 * pixels is what removes ALL metadata — GPS location, device, timestamps —
 * and bakes the orientation in, so the image looks the same everywhere and
 * when saved.
 *
 * NATIVE builds have no canvas and this project ships no image-manipulation
 * module, so there the picker's own re-compression is used (`quality`,
 * `exif: false`): the file is compressed and checked against the limits, but
 * it is not resized and metadata removal depends on the OS picker.
 */

export type ChatImageSource = 'camera' | 'library';

export interface PreparedChatImage {
  /** Something an <Image> can show right now: a blob: URL on web, a file URI on native. */
  uri: string;
  /** Web only: the exact bytes that will be uploaded. */
  blob?: Blob;
  mime: string;
  width: number;
  height: number;
  size: number;
}

export type PickChatImageResult =
  | { ok: true; image: PreparedChatImage }
  | { ok: false; reason: 'cancelled' | 'permission_denied' | ChatImageProblem };

// ---------------------------------------------------------------------------
// Web
// ---------------------------------------------------------------------------

/**
 * Opens the browser's own picker. MUST be called synchronously from a user
 * gesture (a press handler) or browsers refuse to open it. `capture` asks
 * mobile browsers to go straight to the camera; desktop browsers ignore it
 * and show the file dialog, which is the right fallback there.
 */
function pickFileOnWeb(source: ChatImageSource): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (source === 'camera') input.setAttribute('capture', 'environment');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(file);
    };
    // Browsers without the `cancel` event give no signal when the dialog is
    // dismissed; the window regaining focus with no file chosen is the tell.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish(null);
      }, 800);
    };
    input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => finish(null));
    window.addEventListener('focus', onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

interface DecodedImage {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  release: () => void;
}

async function decodeOnWeb(file: Blob): Promise<DecodedImage> {
  // Preferred: an ImageBitmap with the EXIF orientation applied by the decoder.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, width, height) => ctx.drawImage(bitmap, 0, 0, width, height),
        release: () => bitmap.close?.(),
      };
    } catch {
      // Fall through: some formats decode only through an <img>.
    }
  }
  // Fallback: an <img>. Current browsers honour EXIF orientation for <img>
  // elements (and for drawImage from them) by default.
  const url = URL.createObjectURL(file);
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image could not be decoded'));
      img.src = url;
    });
    return {
      width: element.naturalWidth,
      height: element.naturalHeight,
      draw: (ctx, width, height) => ctx.drawImage(element, 0, 0, width, height),
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality));
}

/** Resizes, strips metadata and compresses. Exported for the web tests. */
export async function prepareChatImageOnWeb(file: Blob): Promise<PickChatImageResult> {
  const sourceProblem = checkChatImageSource({ mime: file.type, size: file.size });
  if (sourceProblem) return { ok: false, reason: sourceProblem };

  let decoded: DecodedImage;
  try {
    decoded = await decodeOnWeb(file);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  try {
    if (!(decoded.width > 0) || !(decoded.height > 0)) return { ok: false, reason: 'unreadable' };
    const target = fitWithin(decoded.width, decoded.height, CHAT_IMAGE_TARGET_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'unreadable' };
    // JPEG has no transparency: flatten onto white rather than black.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, target.width, target.height);
    decoded.draw(ctx, target.width, target.height);

    let blob: Blob | null = null;
    for (const quality of [0.82, 0.72, 0.6, 0.45]) {
      blob = await canvasToJpeg(canvas, quality);
      if (blob && blob.size <= CHAT_IMAGE_TARGET_BYTES) break;
    }
    if (!blob) return { ok: false, reason: 'unreadable' };

    const prepared = { mime: 'image/jpeg', width: target.width, height: target.height, size: blob.size };
    const problem = checkPreparedChatImage(prepared);
    if (problem) return { ok: false, reason: problem };
    return { ok: true, image: { ...prepared, blob, uri: URL.createObjectURL(blob) } };
  } finally {
    decoded.release();
  }
}

// ---------------------------------------------------------------------------
// Native
// ---------------------------------------------------------------------------

async function pickOnNative(source: ChatImageSource): Promise<PickChatImageResult> {
  // Loaded lazily: the module is not needed (and its camera permission is
  // never requested) until someone actually attaches a photo.
  const ImagePicker = await import('expo-image-picker');
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  const granted =
    permission.granted ||
    (permission as { accessPrivileges?: string }).accessPrivileges === 'all' ||
    (permission as { accessPrivileges?: string }).accessPrivileges === 'limited';
  if (!granted) return { ok: false, reason: 'permission_denied' };

  const options = { mediaTypes: ['images'] as ('images')[], quality: 0.7, exif: false, allowsEditing: false };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || result.assets.length === 0) return { ok: false, reason: 'cancelled' };

  const asset = result.assets[0];
  const mime = (asset.mimeType ?? 'image/jpeg').toLowerCase();
  let size = asset.fileSize ?? 0;
  if (!size) {
    try {
      size = (await (await fetch(asset.uri)).blob()).size;
    } catch {
      size = 0;
    }
  }
  const prepared = { mime, width: asset.width, height: asset.height, size };
  const problem = checkPreparedChatImage(prepared);
  if (problem) return { ok: false, reason: problem === 'too_large' ? 'source_too_large' : problem };
  return { ok: true, image: { ...prepared, uri: asset.uri } };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Call directly from a press handler (see pickFileOnWeb). */
export async function pickChatImage(source: ChatImageSource): Promise<PickChatImageResult> {
  if (Platform.OS !== 'web') {
    try {
      return await pickOnNative(source);
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  }
  if (typeof document === 'undefined') return { ok: false, reason: 'unreadable' };
  const file = await pickFileOnWeb(source);
  if (!file) return { ok: false, reason: 'cancelled' };
  return prepareChatImageOnWeb(file);
}

/** Frees the local preview of an image that will not be shown again. */
export function releasePreparedChatImage(image: Pick<PreparedChatImage, 'uri'> | undefined | null): void {
  if (!image || Platform.OS !== 'web') return;
  if (image.uri.startsWith('blob:') && typeof URL !== 'undefined') {
    try {
      URL.revokeObjectURL(image.uri);
    } catch {
      // Already released.
    }
  }
}

/** The bytes to upload for a prepared image. */
export async function chatImageUploadBody(image: PreparedChatImage): Promise<Blob> {
  if (image.blob) return image.blob;
  const response = await fetch(image.uri);
  return response.blob();
}

// ---------------------------------------------------------------------------
// Saving a received image
// ---------------------------------------------------------------------------

function isIOSBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { maxTouchPoints?: number };
  return /iphone|ipad|ipod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

function fileFor(blob: Blob, fileName: string, mime: string): File | null {
  try {
    return new File([blob], fileName, { type: mime });
  } catch {
    return null;
  }
}

/** Which save flow this device will use for this image — also drives the hint shown before saving. */
export function chatImageSaveStrategyFor(blob: Blob | null, fileName: string, mime: string): ChatImageSaveStrategy {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || typeof document === 'undefined') return 'open';
  let canShareFiles = false;
  if (blob && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
    const file = fileFor(blob, fileName, mime);
    try {
      canShareFiles = Boolean(file && navigator.canShare({ files: [file] }));
    } catch {
      canShareFiles = false;
    }
  }
  const supportsDownload = Boolean(blob) && 'download' in document.createElement('a');
  return chooseChatImageSaveStrategy({ isIOS: isIOSBrowser(), canShareFiles, supportsDownload });
}

/**
 * Starts the device's save flow for an image the caller is authorised to
 * see. `blob` must already be in memory (the viewer loads it up front) so
 * that the share sheet opens within the user's tap — browsers refuse
 * navigator.share() after an awaited download.
 *
 * Returns what actually happened; it never reports "saved", because the OS
 * performs the final step and does not tell the page.
 */
export async function saveChatImage(input: {
  blob: Blob | null;
  url: string | null;
  createdAt: string;
  mime: string;
}): Promise<ChatImageSaveOutcome> {
  const fileName = chatImageFileName(input.createdAt, input.mime);

  if (Platform.OS !== 'web') {
    if (!input.url) return 'failed';
    try {
      await Linking.openURL(input.url);
      return 'opened';
    } catch {
      return 'failed';
    }
  }

  const strategy = chatImageSaveStrategyFor(input.blob, fileName, input.mime);

  if (strategy === 'share' && input.blob) {
    const file = fileFor(input.blob, fileName, input.mime);
    if (!file) return 'failed';
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      // The person closed the sheet: not an error, and nothing was saved.
      if ((error as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
      return 'failed';
    }
  }

  if (strategy === 'download' && input.blob) {
    const objectUrl = URL.createObjectURL(input.blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return 'downloaded';
    } catch {
      return 'failed';
    } finally {
      // Give the browser time to start reading the blob before releasing it.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }
  }

  const target = input.blob ? URL.createObjectURL(input.blob) : input.url;
  if (!target) return 'failed';
  // The return value says nothing useful here (it is null whenever the new
  // tab is isolated from this page), so the outcome is reported as "opened"
  // together with instructions, never as "saved".
  window.open(target, '_blank', 'noopener');
  return 'opened';
}

export { CHAT_IMAGE_MAX_BYTES };
