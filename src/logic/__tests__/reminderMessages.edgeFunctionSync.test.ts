import fs from 'fs';
import path from 'path';

/**
 * P0 notification-delivery investigation — reminderMessages.ts's own doc
 * comment says supabase/functions/send-walk-reminders/index.ts keeps an
 * inlined copy of buildWalkReminderMessage/buildWalkAttentionEscalationMessage
 * ("Deno can't import an RN-project file at deploy time... keep both in
 * sync"), but nothing ever enforced that. The two had drifted: every
 * buildWalkReminderMessage variant's word order differed between the
 * canonical file ("{name} — באחריות ...") and the Edge Function's copy
 * ("... — באחריות {name}") — a real responsible-member reminder sent via
 * the live scheduler would have read differently from what this repo's own
 * unit tests (reminderMessages.test.ts) verify. Fixed by reconciling the
 * Edge Function's copy to the canonical wording; this is a structural
 * source-text scan (not a rendered/executed comparison) because the Edge
 * Function is Deno-only and has no execution harness in this repo — same
 * convention as sendRequestPushNoDestination.test.ts.
 */
describe('reminderMessages.ts stays in sync with its inlined Edge Function copy (structural)', () => {
  const canonicalSource = fs
    .readFileSync(path.join(__dirname, '..', 'reminderMessages.ts'), 'utf8')
    .replace(/\r\n/g, '\n');
  const edgeSource = fs
    .readFileSync(
      path.join(__dirname, '..', '..', '..', 'supabase', 'functions', 'send-walk-reminders', 'index.ts'),
      'utf8'
    )
    .replace(/\r\n/g, '\n');

  function extractTemplateLiterals(source: string, fnName: string): string[] {
    const start = source.indexOf(`function ${fnName}(`);
    expect(start).toBeGreaterThan(-1);
    const nextFnIdx = source.indexOf('function ', start + 1);
    const block = nextFnIdx > -1 ? source.slice(start, nextFnIdx) : source.slice(start);
    const matches = block.match(/`[^`]*`/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    return matches;
  }

  it('buildWalkReminderMessage: every template literal (title and body, all 4 stages) matches word-for-word', () => {
    const canonical = extractTemplateLiterals(canonicalSource, 'buildWalkReminderMessage');
    const edge = extractTemplateLiterals(edgeSource, 'buildWalkReminderMessage');
    expect(edge).toEqual(canonical);
  });

  it('buildWalkAttentionEscalationMessage: every template literal matches word-for-word', () => {
    const canonical = extractTemplateLiterals(canonicalSource, 'buildWalkAttentionEscalationMessage');
    const edge = extractTemplateLiterals(edgeSource, 'buildWalkAttentionEscalationMessage');
    expect(edge).toEqual(canonical);
  });
});
