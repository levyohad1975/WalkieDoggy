import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { buildWalkAttentionEscalationMessage, buildWalkReminderMessage, REMINDER_STAGES } from '../../logic/reminderMessages';

/**
 * Real-iPhone QA regression — "the push arrived, but showed a small generic
 * dog instead of the approved Walkie Doggy mascot".
 *
 * Root cause: the T-15 push TITLE began with a dog-face emoji, which iOS
 * draws with Apple's own generic emoji artwork. It was not an image asset:
 * iOS Home Screen Web Push ignores showNotification()'s `icon`/`badge` and
 * always draws the installed Home Screen app icon, which already is the
 * approved mascot icon.
 *
 * So the guards here are (1) no dog-face emoji in any push text, and (2)
 * every icon a platform can actually pick up is the approved artwork, at
 * the size it is declared as.
 */
const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const sha256 = (...p: string[]) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, ...p))).digest('hex');
function pngSize(...p: string[]): { width: number; height: number } {
  const buf = fs.readFileSync(path.join(ROOT, ...p));
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// 🐶 dog face, 🐕 dog, 🦮 guide dog, 🐩 poodle (🐕‍🦺 service dog is 🐕 + ZWJ).
const DOG_EMOJI = /[\u{1F436}\u{1F415}\u{1F9AE}\u{1F429}]/u;

describe('push notification text never draws a generic emoji dog', () => {
  const base = { dogName: 'רקסי', dogSex: 'male' as const, responsibleName: 'אוהד', scheduledTime: '18:40' };
  const seeds = Array.from({ length: 40 }, (_, i) => `walk-${i}`);

  it('walk reminders: no dog emoji in any title/body, for every stage and variant', () => {
    for (const stage of REMINDER_STAGES) {
      for (const varietySeed of seeds) {
        const m = buildWalkReminderMessage({ ...base, stage, varietySeed });
        expect(m.title).not.toMatch(DOG_EMOJI);
        expect(m.body).not.toMatch(DOG_EMOJI);
      }
    }
  });

  it('admin escalation: no dog emoji', () => {
    for (const varietySeed of seeds) {
      const m = buildWalkAttentionEscalationMessage({ ...base, varietySeed });
      expect(`${m.title}${m.body}`).not.toMatch(DOG_EMOJI);
    }
  });

  it('every T-15 push variant states the 15 minutes explicitly', () => {
    const texts = new Set(seeds.map((varietySeed) => {
      const m = buildWalkReminderMessage({ ...base, stage: 'T-15', varietySeed });
      return `${m.title}|${m.body}`;
    }));
    expect(texts.size).toBe(2);
    for (const t of texts) {
      expect(t).toContain('15 דקות');
      // "הגיע הזמן" is the due-stage (T) wording; a T-15 push must not use it.
      expect(t).not.toContain('הגיע הזמן');
    }
  });

  it('the deployed senders (Edge Functions) and the service worker carry no dog emoji either', () => {
    expect(read('supabase', 'functions', 'send-walk-reminders', 'index.ts')).not.toMatch(DOG_EMOJI);
    expect(read('supabase', 'functions', 'send-request-push', 'index.ts')).not.toMatch(DOG_EMOJI);
    expect(read('public', 'sw.js')).not.toMatch(DOG_EMOJI);
  });
});

describe('notification and install icons are the approved Walkie Doggy Link artwork', () => {
  const sw = read('public', 'sw.js');
  const manifest = JSON.parse(read('public', 'manifest.json')) as { name: string; icons: { src: string; sizes: string; type: string }[] };
  const html = read('public', 'index.html');

  it('the service worker always uses the bundled brand icon and badge, never one supplied by a push payload', () => {
    expect(sw).toContain("icon: '/icon-192.png'");
    expect(sw).toContain("badge: '/notification-badge.png'");
    expect(sw).not.toMatch(/payload\.(icon|badge|image)/);
    expect(fs.existsSync(path.join(ROOT, 'public', 'notification-badge.png'))).toBe(true);
  });

  it('every manifest icon exists and really has the pixel size it declares', () => {
    expect(manifest.name).toBe('Walkie Doggy Link');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      const file = icon.src.replace(/^\//, '');
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize('public', file)).toEqual({ width: w, height: h });
    }
  });

  it('iOS Home Screen icon (apple-touch-icon — the only image iOS shows on a web push) points at the approved icon', () => {
    const href = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/)?.[1];
    expect(href).toBe('/icon-192.png');
    expect(html).toContain('<link rel="manifest" href="/manifest.json" />');
  });

  // Pinned so a regenerated/substituted "similar-looking dog" fails loudly.
  // Update these ONLY together with an explicitly approved artwork change.
  it('icon files are byte-for-byte the approved artwork', () => {
    expect(sha256('assets', 'icon.png')).toBe('2bd61236f01a864031bb692edd0e3d2e798fb6fb2eef194f8856b7b01b9d19bb');
    expect(sha256('public', 'icon-192.png')).toBe('cea159a7fe9c6889dee10c1aad9c6d477edeff62aba326bad84f08cf7da3aa49');
    // 512px Lanczos downscale of assets/icon.png (no redraw).
    expect(sha256('public', 'icon-512.png')).toBe('261bd03d2ff7449c3ca437cf4c1d043f197005581f4f14880761526ecf038376');
  });
});
