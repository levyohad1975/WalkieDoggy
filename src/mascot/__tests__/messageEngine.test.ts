import { renderMessageTemplate, selectMessage, createAntiRepetitionHistory, ANTI_REPETITION_WINDOW } from '../messageEngine';
import { MESSAGE_LIBRARY, MESSAGE_COUNT_BY_CATEGORY, type MessageCategory } from '../messageLibrary';

/**
 * BATCH 4 CORRECTION #1 (item 2) — REQUIRED regression guard: a rendered
 * production message must never contain a slash-gender pattern
 * ("מוכן/ה", "הוא/היא", "כלב/ה", ...). Matches two Hebrew letters joined by
 * a slash, which is the shape of every example the review flagged and is
 * not a pattern that occurs in genuine Hebrew punctuation/prose.
 */
const SLASH_GENDER_PATTERN = /[א-ת]\/[א-ת]/;

/**
 * BATCH 4 (C5/C6) — direct behavioral tests of the message engine, per the
 * brief's own instruction ("do not write brittle tests that merely search
 * for arbitrary source text when behavior can reasonably be tested
 * directly"): every test here imports the real function and asserts on its
 * actual return value — no source-text scanning, since this module has zero
 * React Native dependency and is trivially importable in plain Jest.
 */

describe('mascot/messageLibrary — MESSAGE_LIBRARY', () => {
  it('has at least 100 curated variants total (Batch 4 target: 100-150)', () => {
    expect(MESSAGE_LIBRARY.length).toBeGreaterThanOrEqual(100);
    expect(MESSAGE_LIBRARY.length).toBeLessThanOrEqual(200);
  });

  it('covers every required category with at least a handful of variants each', () => {
    const required: MessageCategory[] = [
      'excited',
      'ready',
      'waiting',
      'concerned',
      'success',
      'earlyCompletion',
      'lateCompletion',
      'morning',
      'evening',
      'weekend',
      'encouragement',
    ];
    for (const category of required) {
      expect(MESSAGE_COUNT_BY_CATEGORY[category]).toBeGreaterThanOrEqual(4);
    }
  });

  it('every template id is unique (anti-repetition history keys on id)', () => {
    const ids = MESSAGE_LIBRARY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * BATCH 4 CORRECTION #1 (item 2) — the explicitly required regression
   * test: every message, rendered under EVERY dogSex a real family could
   * have (male/female/unset), and with every other variable also missing
   * (the worst case for slash-language, since fallback text is substituted
   * too), must never contain a slash-gender pattern. This exercises both
   * plain-string and GenderedText templates identically, since
   * renderMessageTemplate() resolves the branch before returning.
   */
  it('no rendered message, under any dogSex, ever contains a slash-gender pattern', () => {
    const dogSexes: Array<'male' | 'female' | null | undefined> = ['male', 'female', null, undefined];
    const offenders: string[] = [];
    for (const template of MESSAGE_LIBRARY) {
      for (const dogSex of dogSexes) {
        const rendered = renderMessageTemplate(template.text, { dogSex });
        if (SLASH_GENDER_PATTERN.test(rendered)) {
          offenders.push(`${template.id} (dogSex=${dogSex}): ${rendered}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no rendered message contains a slash-gender pattern even with a fully empty context (dogName/responsibleName/etc. all missing, the fallback text\'s own worst case)', () => {
    const offenders: string[] = [];
    for (const template of MESSAGE_LIBRARY) {
      const rendered = renderMessageTemplate(template.text, {});
      if (SLASH_GENDER_PATTERN.test(rendered)) {
        offenders.push(`${template.id}: ${rendered}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('mascot/messageEngine — renderMessageTemplate (C5 template variables)', () => {
  it('substitutes dogName/responsibleName/scheduledTime/completionTime plainly', () => {
    const out = renderMessageTemplate('{dogName} ו{responsibleName}, {scheduledTime} / {completionTime}', {
      dogName: 'רקסי',
      responsibleName: 'דנה',
      scheduledTime: '18:00',
      completionTime: '18:07',
    });
    expect(out).toBe('רקסי ודנה, 18:00 / 18:07');
  });

  it('{dogNoun} renders the correct male/female/unknown Hebrew form (reusing reminderMessages.ts dogNoun)', () => {
    expect(renderMessageTemplate('{dogNoun}', { dogName: 'רקסי', dogSex: 'male' })).toBe('הכלב רקסי');
    expect(renderMessageTemplate('{dogNoun}', { dogName: 'לונה', dogSex: 'female' })).toBe('הכלבה לונה');
    expect(renderMessageTemplate('{dogNoun}', { dogName: 'מקס' })).toBe('מקס');
    expect(renderMessageTemplate('{dogNoun}', { dogName: 'מקס', dogSex: null })).toBe('מקס');
  });

  /**
   * BATCH 4 CORRECTION #1 (item 2). {dogNoun} with NO real name at all must
   * fall back to the same natural fallback phrase directly, never double up
   * dogNoun()'s "הכלב "/"הכלבה " prefix onto a fallback phrase that already
   * reads as a full noun phrase on its own.
   */
  it('{dogNoun} with no dogName falls back to the natural fallback phrase, unprefixed (no "הכלב הכלב..." doubling)', () => {
    expect(renderMessageTemplate('{dogNoun}', { dogSex: 'male' })).toBe('הכלב או הכלבה שלכם');
    expect(renderMessageTemplate('{dogNoun}', { dogSex: 'female' })).toBe('הכלב או הכלבה שלכם');
    expect(renderMessageTemplate('{dogNoun}', {})).toBe('הכלב או הכלבה שלכם');
  });

  /**
   * BATCH 4 CORRECTION #1 (item 2): the {wentOut} token (reusing
   * reminderMessages.ts's wentOutForm()) was removed — its unknown-sex case
   * could only ever produce a slash form ("יצא/ה"), since a bare Hebrew
   * past-tense verb has no natural gender-neutral single-word form the way
   * {dogNoun} does. It's no longer substituted at all; a template using it
   * now renders the literal "{wentOut}" text unchanged, which itself proves
   * nothing recognizes/expands it as a token anymore.
   */
  it('{wentOut} is no longer a recognized token — it renders through literally, unexpanded', () => {
    expect(renderMessageTemplate('{wentOut}', { dogSex: 'male' })).toBe('{wentOut}');
  });

  it('missing variables render a safe, grammatical, slash-free Hebrew fallback — never "undefined" or a blank gap', () => {
    const out = renderMessageTemplate('{dogName} · {responsibleName} · {scheduledTime} · {completionTime}', {});
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('null');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toMatch(SLASH_GENDER_PATTERN);
    expect(out).toBe('הכלב או הכלבה שלכם · מישהו מהמשפחה · השעה הקרובה · עכשיו');
  });

  it('an empty-string variable is treated as missing (falls back), not rendered as an empty gap', () => {
    const out = renderMessageTemplate('{dogName}', { dogName: '   ' });
    expect(out).toBe('הכלב או הכלבה שלכם');
  });

  /**
   * BATCH 4 CORRECTION #1 (item 2) — GenderedText branch selection: the
   * three branches are genuinely independent, natural sentences (not one
   * text with an ending mechanically swapped), and 'neutral' is used for
   * any dogSex other than exactly 'male'/'female'.
   */
  describe('GenderedText branch selection', () => {
    const gendered = {
      male: 'הכלב מוכן לצאת',
      female: 'הכלבה מוכנה לצאת',
      neutral: 'הגיע הזמן לצאת לטיול',
    };

    it('male dogSex renders the male branch', () => {
      expect(renderMessageTemplate(gendered, { dogSex: 'male' })).toBe('הכלב מוכן לצאת');
    });

    it('female dogSex renders the female branch', () => {
      expect(renderMessageTemplate(gendered, { dogSex: 'female' })).toBe('הכלבה מוכנה לצאת');
    });

    it('missing/null/unrecognized dogSex renders the neutral branch', () => {
      expect(renderMessageTemplate(gendered, {})).toBe('הגיע הזמן לצאת לטיול');
      expect(renderMessageTemplate(gendered, { dogSex: null })).toBe('הגיע הזמן לצאת לטיול');
      expect(renderMessageTemplate(gendered, { dogSex: 'unknown' as never })).toBe('הגיע הזמן לצאת לטיול');
    });
  });
});

describe('mascot/messageEngine — selectMessage (C5/C6/C7)', () => {
  it('only ever selects from the requested category — never bleeds into another stage', () => {
    const history = createAntiRepetitionHistory();
    for (let i = 0; i < 20; i += 1) {
      const picked = selectMessage('concerned', {}, { history, random: () => i / 20 });
      expect(picked.id.startsWith('concerned:')).toBe(true);
    }
  });

  it('anti-repetition: with a deterministic incrementing random, the immediately next pick in the same category differs from the previous one while candidates remain', () => {
    const history = createAntiRepetitionHistory();
    const category = 'success';
    const first = selectMessage(category, {}, { history, random: () => 0 });
    // Forcing random() => 0 again would normally reselect the SAME
    // (now-excluded) top candidate — anti-repetition must route around it
    // to the next one in the filtered pool instead.
    const second = selectMessage(category, {}, { history, random: () => 0 });
    expect(second.id).not.toBe(first.id);
  });

  it('anti-repetition window is bounded: once the whole category has been exhausted, selection still returns a valid message rather than failing', () => {
    const history = createAntiRepetitionHistory();
    const category = 'morning';
    const total = MESSAGE_COUNT_BY_CATEGORY[category];
    // Exhaust well past the category's own size — must never throw/return
    // undefined, even once every id has been "recently used".
    for (let i = 0; i < total + ANTI_REPETITION_WINDOW + 5; i += 1) {
      const picked = selectMessage(category, {}, { history, random: () => (i % 7) / 7 });
      expect(picked.id.startsWith(`${category}:`)).toBe(true);
      expect(typeof picked.text).toBe('string');
      expect(picked.text.length).toBeGreaterThan(0);
    }
  });

  it('with a window at least as large as the whole category, genuinely exhausts the pool and falls back to the full candidate list rather than an empty one', () => {
    const history = createAntiRepetitionHistory();
    const category = 'morning';
    const total = MESSAGE_COUNT_BY_CATEGORY[category];
    // A windowSize >= the category's own size means recentIds() never evicts
    // — unlike the default-window test above, this genuinely drives pool to
    // empty (every id is "recent") once a full pass has been made, forcing
    // selectMessage() to fall back from the (now-empty) pool to the raw
    // candidates list. random: () => 0 always picks the filtered pool's
    // first remaining element, walking the category in order with no
    // repeats until it wraps.
    for (let i = 0; i < total + 1; i += 1) {
      const picked = selectMessage(category, {}, { history, windowSize: total, random: () => 0 });
      expect(picked.id.startsWith(`${category}:`)).toBe(true);
    }
  });

  it('tolerates a random() implementation that returns an out-of-range value (contract violation) without returning undefined', () => {
    const history = createAntiRepetitionHistory();
    const picked = selectMessage('excited', {}, { history, random: () => 1 });
    expect(picked.id.startsWith('excited:')).toBe(true);
    expect(typeof picked.text).toBe('string');
  });

  it('renders the selected template with the given context (integration of selection + substitution)', () => {
    const history = createAntiRepetitionHistory();
    const picked = selectMessage(
      'excited',
      { dogName: 'רקסי', dogSex: 'male', responsibleName: 'עומר', scheduledTime: '17:45' },
      { history, random: () => 0 }
    );
    expect(picked.text).not.toContain('{');
    expect(picked.text).not.toContain('}');
  });

  it('uses the documented defaults (ctx, options, history, preset, random) when the caller supplies only a category', () => {
    const picked = selectMessage('encouragement');
    expect(picked.id.startsWith('encouragement:')).toBe(true);
    expect(typeof picked.text).toBe('string');
    expect(picked.text.length).toBeGreaterThan(0);
  });

  it('an unfiltered (default) preset sees the full category pool — every template in this batch is preset-agnostic', () => {
    const history = createAntiRepetitionHistory();
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const picked = selectMessage('waiting', {}, { history, random: () => i / 50 });
      seen.add(picked.id);
    }
    // Should be able to reach more than just a couple of ids given 50 draws
    // across a 16-variant category with only a window-3 exclusion.
    expect(seen.size).toBeGreaterThan(3);
  });
});
