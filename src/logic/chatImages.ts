/**
 * Pure rules for chat image messages — no DOM, no native modules — mirrored
 * by the server (migration 0109: the chat-attachments bucket limits and
 * chat_post_message()'s checks). The server is the authority; these exist so
 * the app can prepare a compliant file and explain a problem before uploading.
 */

export const CHAT_ATTACHMENT_BUCKET = 'chat-attachments';
/** Server hard limit (bucket file_size_limit and the chat_messages constraint). */
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Server hard limit per side. */
export const CHAT_IMAGE_MAX_DIMENSION = 4096;
/** What the app resizes to: plenty for a phone screen, a fraction of a camera original. */
export const CHAT_IMAGE_TARGET_EDGE = 1600;
/** What the app aims for after compression; quality is stepped down until it fits. */
export const CHAT_IMAGE_TARGET_BYTES = 1024 * 1024;
/** Largest original the app will even try to open (a 48MP phone photo is ~15MB). */
export const CHAT_IMAGE_MAX_SOURCE_BYTES = 40 * 1024 * 1024;
export const CHAT_IMAGE_MIN_EDGE = 8;
export const CHAT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ChatImageMime = (typeof CHAT_IMAGE_MIME_TYPES)[number];

export type ChatImageProblem =
  | 'not_an_image'
  | 'unsupported_type'
  | 'source_too_large'
  | 'too_small'
  | 'too_large'
  | 'dimensions_too_large'
  | 'unreadable';

const PROBLEM_MESSAGES: Record<ChatImageProblem, string> = {
  not_an_image: 'אפשר לשלוח רק תמונות.',
  unsupported_type: 'סוג התמונה הזה אינו נתמך. נסו תמונת JPEG, PNG או WebP.',
  source_too_large: 'התמונה גדולה מדי לשליחה.',
  too_small: 'התמונה קטנה מדי.',
  too_large: 'גם אחרי כיווץ התמונה גדולה מדי לשליחה. נסו תמונה אחרת.',
  dimensions_too_large: 'ממדי התמונה גדולים מדי לשליחה.',
  unreadable: 'לא הצלחנו לקרוא את התמונה. נסו תמונה אחרת.',
};

export function chatImageProblemMessage(problem: ChatImageProblem): string {
  return PROBLEM_MESSAGES[problem];
}

/** Checks a file BEFORE decoding it. Anything `image/*` may be decodable (e.g. HEIC on Safari); the decode step has the final say. */
export function checkChatImageSource(source: { mime?: string | null; size?: number | null }): ChatImageProblem | null {
  const mime = (source.mime ?? '').toLowerCase();
  if (mime && !mime.startsWith('image/')) return 'not_an_image';
  if (mime === 'image/svg+xml') return 'unsupported_type';
  if (typeof source.size === 'number' && source.size > CHAT_IMAGE_MAX_SOURCE_BYTES) return 'source_too_large';
  return null;
}

/** Scales (never enlarges) to fit a square of `maxEdge`, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Checks the file that is about to be uploaded against the server's limits. */
export function checkPreparedChatImage(image: { mime: string; width: number; height: number; size: number }): ChatImageProblem | null {
  if (!(CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(image.mime)) return 'unsupported_type';
  if (image.width < CHAT_IMAGE_MIN_EDGE || image.height < CHAT_IMAGE_MIN_EDGE) return 'too_small';
  if (image.width > CHAT_IMAGE_MAX_DIMENSION || image.height > CHAT_IMAGE_MAX_DIMENSION) return 'dimensions_too_large';
  if (!(image.size > 0)) return 'unreadable';
  if (image.size > CHAT_IMAGE_MAX_BYTES) return 'too_large';
  return null;
}

export function chatImageExtension(mime: string): 'jpg' | 'png' | 'webp' {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}

/**
 * Storage path of a message's image:
 *   <conversation id>/<sender profile id>/<message id>.<ext>
 * The server re-derives and checks every segment (0109), so this is a naming
 * convention, not an authorization claim.
 */
export function chatAttachmentPath(conversationId: string, senderUserId: string, messageId: string, mime: string): string {
  return `${conversationId}/${senderUserId}/${messageId}.${chatImageExtension(mime)}`.toLowerCase();
}

/** Size a bubble's image box: fits the available width, capped in height, never upscaled past its pixels. */
export function chatImageDisplaySize(
  attachment: { width: number; height: number },
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const width = Math.max(1, attachment.width);
  const height = Math.max(1, attachment.height);
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: Math.max(96, Math.round(width * scale)), height: Math.max(72, Math.round(height * scale)) };
}

export function formatChatImageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------------------------------------------------------------------------
// Saving a received image to the device
// ---------------------------------------------------------------------------

/**
 *  share    — hand the file to the OS share sheet (iPhone/iPad: the only route
 *             to "Save Image"; a web page cannot write to Photos itself).
 *  download — a normal browser download (desktop, Android: lands in Downloads
 *             and shows up in the gallery).
 *  open     — last resort: show the image on its own so the person can
 *             long-press / right-click and save it.
 */
export type ChatImageSaveStrategy = 'share' | 'download' | 'open';

export function chooseChatImageSaveStrategy(env: {
  isIOS: boolean;
  canShareFiles: boolean;
  supportsDownload: boolean;
}): ChatImageSaveStrategy {
  if (env.isIOS) return env.canShareFiles ? 'share' : 'open';
  if (env.supportsDownload) return 'download';
  return env.canShareFiles ? 'share' : 'open';
}

export type ChatImageSaveOutcome = 'shared' | 'downloaded' | 'opened' | 'cancelled' | 'failed';

/**
 * What to tell the person afterwards. Deliberately never claims "saved": in
 * every one of these flows the operating system performs the final step and
 * does not report back to the page.
 */
export function chatImageSaveMessage(outcome: ChatImageSaveOutcome): string | null {
  switch (outcome) {
    case 'shared':
      return 'חלון השיתוף נפתח. התמונה נשמרת רק אם בחרתם בו ״שמור תמונה״.';
    case 'downloaded':
      return 'ההורדה התחילה. התמונה תופיע בתיקיית ההורדות של המכשיר.';
    case 'opened':
      return 'התמונה נפתחה בנפרד. לחצו עליה לחיצה ארוכה (או קליק ימני) ובחרו ״שמירת תמונה״.';
    case 'failed':
      return 'לא הצלחנו להכין את התמונה לשמירה. בדקו את החיבור ונסו שוב.';
    case 'cancelled':
      return null;
  }
}

/** Shown BEFORE saving, where the OS needs an extra step from the person. */
export function chatImageSaveHint(strategy: ChatImageSaveStrategy): string | null {
  if (strategy === 'share') return 'ייפתח חלון השיתוף של המכשיר — בחרו בו ״שמור תמונה״.';
  if (strategy === 'open') return 'התמונה תיפתח בנפרד — לחצו עליה לחיצה ארוכה ובחרו ״שמירת תמונה״.';
  return null;
}

export function chatImageFileName(createdAt: string, mime: string): string {
  const date = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = Number.isNaN(date.getTime())
    ? 'image'
    : `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `walkie-doggy-${stamp}.${chatImageExtension(mime)}`;
}
