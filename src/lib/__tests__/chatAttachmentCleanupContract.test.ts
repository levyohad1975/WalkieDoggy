import fs from 'fs';
import path from 'path';

/**
 * Structural contract for supabase/functions/chat-attachment-cleanup (Deno —
 * not executed by this repo's Jest run) and for the client's image transport.
 */
describe('chat image storage — cleanup function and client transport (structural)', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const fn = fs.readFileSync(path.join(root, 'supabase', 'functions', 'chat-attachment-cleanup', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
  const code = fn.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  const client = fs.readFileSync(path.join(root, 'src', 'lib', 'chat.ts'), 'utf8');

  it('accepts nothing from the request that could choose what to delete', () => {
    expect(code).not.toMatch(/req\.json\(\)/);
    expect(code).not.toMatch(/searchParams/);
    expect(code).toContain("serviceClient.rpc('chat_attachment_cleanup_batch'");
  });

  it('requires a signed-in caller or the scheduler secret', () => {
    expect(code).toContain("const isScheduler = cronSecret.length > 0 && presentedSecret === cronSecret;");
    const guard = code.slice(code.indexOf('if (!isScheduler) {'), code.indexOf('const serviceClient'));
    expect(guard).toContain('await userClient.auth.getUser()');
    expect(guard).toContain("return json({ ok: false, error: 'invalid or expired session' }, 401);");
  });

  it('removes files through the Storage API, then records them as removed', () => {
    const remove = code.indexOf('serviceClient.storage.from(BUCKET).remove(paths)');
    const mark = code.indexOf("serviceClient.rpc('chat_attachment_mark_removed'");
    expect(remove).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(remove);
    expect(code).toContain("const BUCKET = 'chat-attachments';");
  });

  it('never logs or returns a storage path', () => {
    for (const line of code.split('\n').filter((l) => l.includes('console.') || l.includes('return json('))) {
      expect(line).not.toMatch(/\bpaths\b(?!\.length)/);
    }
  });

  it('client: images are addressed by private path and read through short-lived signed URLs only', () => {
    expect(client).toContain('.createSignedUrl(path, SIGNED_URL_TTL_SECONDS)');
    expect(client).toMatch(/const SIGNED_URL_TTL_SECONDS = (\d+);/);
    expect(Number(client.match(/const SIGNED_URL_TTL_SECONDS = (\d+);/)![1])).toBeLessThanOrEqual(900);
    expect(client).not.toContain('getPublicUrl');
    // Signed URLs live in memory only.
    expect(client).not.toMatch(/AsyncStorage|localStorage/);
  });

  it('client: the upload is an authenticated request to the private bucket, never an upsert', () => {
    expect(client).toContain("xhr.setRequestHeader('Authorization', `Bearer ${token}`);");
    expect(client).toContain("xhr.setRequestHeader('x-upsert', 'false');");
    expect(client).toContain('/storage/v1/object/${CHAT_ATTACHMENT_BUCKET}/');
    expect(client).toContain('xhr.upload.onprogress');
    expect(client).toContain('xhr.abort();');
  });

  it('client: does not log message text, paths or URLs', () => {
    for (const line of client.split('\n').filter((l) => l.includes('console.'))) {
      expect(line).not.toMatch(/path|url|body|signed/i);
    }
  });

  it('client: the image pipeline re-encodes from pixels (which strips EXIF/GPS) and applies orientation', () => {
    const images = fs.readFileSync(path.join(root, 'src', 'lib', 'chatImages.ts'), 'utf8');
    expect(images).toContain("imageOrientation: 'from-image'");
    expect(images).toContain("canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)");
    expect(images).toContain('fitWithin(decoded.width, decoded.height, CHAT_IMAGE_TARGET_EDGE)');
    expect(images).toContain('exif: false');
    // Saving uses the share sheet / a download — never a claim of direct Photos access.
    expect(images).toContain('await navigator.share({ files: [file] });');
    expect(images).toContain('anchor.download = fileName;');
  });
});
