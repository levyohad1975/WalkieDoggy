import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_DIMENSION,
  CHAT_IMAGE_TARGET_EDGE,
  chatAttachmentPath,
  chatImageDisplaySize,
  chatImageExtension,
  chatImageFileName,
  chatImageProblemMessage,
  chatImageSaveHint,
  chatImageSaveMessage,
  checkChatImageSource,
  checkPreparedChatImage,
  chooseChatImageSaveStrategy,
  fitWithin,
  formatChatImageBytes,
} from '../chatImages';

describe('chat image rules', () => {
  it('matches the server limits (migration 0109)', () => {
    expect(CHAT_IMAGE_MAX_BYTES).toBe(5242880);
    expect(CHAT_IMAGE_MAX_DIMENSION).toBe(4096);
    expect(CHAT_IMAGE_TARGET_EDGE).toBeLessThanOrEqual(CHAT_IMAGE_MAX_DIMENSION);
  });

  it('screens a chosen file before decoding it', () => {
    expect(checkChatImageSource({ mime: 'image/jpeg', size: 4_000_000 })).toBeNull();
    // HEIC from an iPhone is still an image; the decoder decides if it can be read.
    expect(checkChatImageSource({ mime: 'image/heic', size: 2_000_000 })).toBeNull();
    expect(checkChatImageSource({ mime: '', size: 10 })).toBeNull();
    expect(checkChatImageSource({ mime: 'application/pdf', size: 10 })).toBe('not_an_image');
    expect(checkChatImageSource({ mime: 'video/mp4', size: 10 })).toBe('not_an_image');
    // SVG can carry scripts: never accepted.
    expect(checkChatImageSource({ mime: 'image/svg+xml', size: 10 })).toBe('unsupported_type');
    expect(checkChatImageSource({ mime: 'image/jpeg', size: 80 * 1024 * 1024 })).toBe('source_too_large');
  });

  it('resizes to fit without enlarging or distorting', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10000, 10, 1600)).toEqual({ width: 1600, height: 2 });
    expect(fitWithin(0, 100, 1600)).toEqual({ width: 0, height: 0 });
  });

  it('checks the prepared file against type, dimension and size limits', () => {
    const ok = { mime: 'image/jpeg', width: 1600, height: 1200, size: 300_000 };
    expect(checkPreparedChatImage(ok)).toBeNull();
    expect(checkPreparedChatImage({ ...ok, mime: 'image/png' })).toBeNull();
    expect(checkPreparedChatImage({ ...ok, mime: 'image/webp' })).toBeNull();
    expect(checkPreparedChatImage({ ...ok, mime: 'image/gif' })).toBe('unsupported_type');
    expect(checkPreparedChatImage({ ...ok, mime: 'image/heic' })).toBe('unsupported_type');
    expect(checkPreparedChatImage({ ...ok, width: 4097 })).toBe('dimensions_too_large');
    expect(checkPreparedChatImage({ ...ok, height: 4 })).toBe('too_small');
    expect(checkPreparedChatImage({ ...ok, size: CHAT_IMAGE_MAX_BYTES })).toBeNull();
    expect(checkPreparedChatImage({ ...ok, size: CHAT_IMAGE_MAX_BYTES + 1 })).toBe('too_large');
    expect(checkPreparedChatImage({ ...ok, size: 0 })).toBe('unreadable');
  });

  it('has a Hebrew explanation for every problem', () => {
    for (const problem of ['not_an_image', 'unsupported_type', 'source_too_large', 'too_small', 'too_large', 'dimensions_too_large', 'unreadable'] as const) {
      expect(chatImageProblemMessage(problem)).toMatch(/[֐-׿]/);
    }
  });

  it('names the file after its message, in the sender\'s folder of the conversation', () => {
    expect(chatAttachmentPath('CONV-1', 'USER-2', 'MSG-3', 'image/jpeg')).toBe('conv-1/user-2/msg-3.jpg');
    expect(chatAttachmentPath('c', 'u', 'm', 'image/png')).toBe('c/u/m.png');
    expect(chatAttachmentPath('c', 'u', 'm', 'image/webp')).toBe('c/u/m.webp');
    expect(chatImageExtension('image/anything-else')).toBe('jpg');
  });

  it('sizes a bubble image from its stored dimensions, so the list does not jump when it loads', () => {
    expect(chatImageDisplaySize({ width: 1200, height: 900 }, 240, 320)).toEqual({ width: 240, height: 180 });
    expect(chatImageDisplaySize({ width: 900, height: 1600 }, 240, 320)).toEqual({ width: 180, height: 320 });
    // Never upscaled beyond its own pixels (but never a sliver either).
    expect(chatImageDisplaySize({ width: 120, height: 90 }, 240, 320)).toEqual({ width: 120, height: 90 });
    expect(chatImageDisplaySize({ width: 2000, height: 20 }, 240, 320)).toEqual({ width: 240, height: 72 });
  });

  it('formats sizes', () => {
    expect(formatChatImageBytes(240_000)).toBe('234 KB');
    expect(formatChatImageBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

describe('saving a received image', () => {
  it('iPhone/iPad: the share sheet, because a web page cannot write to Photos itself', () => {
    expect(chooseChatImageSaveStrategy({ isIOS: true, canShareFiles: true, supportsDownload: true })).toBe('share');
    // An old iOS without file sharing: show the image so it can be long-pressed.
    expect(chooseChatImageSaveStrategy({ isIOS: true, canShareFiles: false, supportsDownload: true })).toBe('open');
  });

  it('Android and desktop: a normal download', () => {
    expect(chooseChatImageSaveStrategy({ isIOS: false, canShareFiles: true, supportsDownload: true })).toBe('download');
    expect(chooseChatImageSaveStrategy({ isIOS: false, canShareFiles: false, supportsDownload: true })).toBe('download');
  });

  it('falls back to sharing, then to opening the image', () => {
    expect(chooseChatImageSaveStrategy({ isIOS: false, canShareFiles: true, supportsDownload: false })).toBe('share');
    expect(chooseChatImageSaveStrategy({ isIOS: false, canShareFiles: false, supportsDownload: false })).toBe('open');
  });

  it('tells the person about the extra step BEFORE saving where the OS needs one', () => {
    expect(chatImageSaveHint('share')).toContain('שמור תמונה');
    expect(chatImageSaveHint('open')).toContain('לחיצה ארוכה');
    expect(chatImageSaveHint('download')).toBeNull();
  });

  it('never claims the image was saved — the OS performs the last step', () => {
    for (const outcome of ['shared', 'downloaded', 'opened', 'failed'] as const) {
      const text = chatImageSaveMessage(outcome)!;
      expect(text).toMatch(/[֐-׿]/);
      expect(text).not.toMatch(/נשמרה בהצלחה|התמונה נשמרה\./);
    }
    expect(chatImageSaveMessage('shared')).toContain('רק אם בחרתם');
    expect(chatImageSaveMessage('cancelled')).toBeNull();
  });

  it('gives the saved file a readable, safe name with the right extension', () => {
    const name = chatImageFileName(new Date(2026, 9, 9, 17, 5, 3).toISOString(), 'image/jpeg');
    expect(name).toBe('walkie-doggy-20261009-170503.jpg');
    expect(chatImageFileName('not a date', 'image/png')).toBe('walkie-doggy-image.png');
  });
});
