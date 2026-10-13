import fs from 'fs';
import path from 'path';

/**
 * P0 notification-delivery investigation — Staging security review item 3
 * ("confirm the custom cron secret is securely validated"). The cron
 * secret is the ONLY credential supabase/functions/send-walk-reminders
 * trusts (see that file's own header), so comparing it with a plain `!==`
 * is a timing side-channel: V8/Deno's string comparison returns as soon as
 * it finds a differing byte, so response latency leaks how many leading
 * bytes of a guess were correct. Source-scan convention: this Edge
 * Function runs only under Deno (`@ts-nocheck`), so this repo has no
 * execution harness for it — same convention as
 * sendRequestPushNoDestination.test.ts / migration0101/0102's own
 * source-scan tests for SQL.
 */
describe('supabase/functions/send-walk-reminders — cron secret comparison is constant-time (structural)', () => {
  const source = fs
    .readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'functions', 'send-walk-reminders', 'index.ts'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('never compares the provided secret to the real one with a plain !== or ===', () => {
    const checkIdx = source.indexOf('const providedSecret =');
    expect(checkIdx).toBeGreaterThan(-1);
    const block = source.slice(checkIdx, checkIdx + 200);
    expect(block).not.toMatch(/providedSecret\s*!==\s*CRON_SECRET/);
    expect(block).not.toMatch(/providedSecret\s*===\s*CRON_SECRET/);
    expect(block).toContain('timingSafeEqual(providedSecret, CRON_SECRET)');
  });

  it('timingSafeEqual walks the full (max) length and never returns/branches inside the loop — only the accumulated mismatch is inspected at the end', () => {
    const fnIdx = source.indexOf('function timingSafeEqual(');
    expect(fnIdx).toBeGreaterThan(-1);
    const nextFnIdx = source.indexOf('function ', fnIdx + 1);
    const block = source.slice(fnIdx, nextFnIdx > -1 ? nextFnIdx : fnIdx + 800);
    expect(block).toMatch(/for\s*\(let i = 0; i < maxLen; i\+\+\)\s*\{/);
    // No early return/break inside the loop body — the whole point is that
    // every call takes the same number of iterations regardless of input.
    const loopStart = block.indexOf('for (');
    const loopBody = block.slice(loopStart, block.indexOf('}', loopStart));
    expect(loopBody).not.toMatch(/\breturn\b/);
    expect(loopBody).not.toMatch(/\bbreak\b/);
    // The length mismatch is folded into the accumulator (via the initial
    // XOR of the two lengths), never checked separately/early.
    expect(block).toMatch(/mismatch = aBytes\.length \^ bBytes\.length/);
  });
});
