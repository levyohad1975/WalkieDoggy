import fs from 'fs';

/**
 * Real-device QA fix — "Schedule save false failure / double-tap bug".
 *
 * Root cause: submit() fired onSave() synchronously with no busy/disabled
 * state on the Save button. Tapping "שמירה" twice before the first
 * addRule() resolved fired TWO independent addRule() calls for the
 * identical time slot (each gets its own fresh rule id from
 * ScheduleScreen.tsx's generateId('rule'), so the id never collides —
 * only the OTHER columns schedule_rules_active_identity_uidx, migration
 * 0099, covers do). The first insert won; the second hit that unique
 * constraint and surfaced the generic "לא הצלחנו להוסיף את שעת הטיול" for
 * a save that had, in truth, already succeeded.
 *
 * Fix: `saving` now gates the Save button (via Button's own `loading`
 * prop, which also disables it) for the whole duration of the awaited
 * onSave() call, so a second tap in that window is impossible. See
 * scheduleStore.addRule()'s own isDuplicateActiveScheduleRuleError()
 * handling (covered in scheduleStore.doubleTapAdd.test.ts) for the
 * defense-in-depth server-response side of this same fix.
 *
 * Source-scan convention: this repo has no render-test harness for
 * components (see DogSelectorRow.structure.test.ts's own doc comment).
 */
describe('RuleFormModal — double-tap "שמירה" guard (structural)', () => {
  const source = fs.readFileSync(require.resolve('../RuleFormModal'), 'utf8').replace(/\r\n/g, '\n');

  it('tracks a `saving` state and resets it whenever the modal becomes visible', () => {
    expect(source).toMatch(/const \[saving, setSaving\] = useState\(false\);/);
    expect(source).toMatch(/setSaving\(false\);/);
  });

  it('submit() is async, re-entrancy-guarded, and awaits onSave() inside a try/finally that always clears `saving`', () => {
    const submitIdx = source.indexOf('const submit = async () => {');
    expect(submitIdx).toBeGreaterThan(-1);
    const submitBody = source.slice(submitIdx, submitIdx + 700);
    expect(submitBody).toContain('if (saving) return;');
    expect(submitBody).toContain('setSaving(true);');
    expect(submitBody).toMatch(/try\s*\{\s*\n\s*await onSave\(/);
    expect(submitBody).toMatch(/finally\s*\{\s*\n\s*setSaving\(false\);/);
  });

  it('the Save button is wired to `saving` via Button\'s own loading prop (disables it AND shows a spinner — Button.tsx: disabled={disabled || loading})', () => {
    expect(source).toMatch(/<Button label="שמירה" onPress=\{submit\} loading=\{saving\}/);
  });

  it('onSave is typed as awaitable (Promise<void>), not fire-and-forget', () => {
    expect(source).toMatch(/onSave: \(result: RuleFormResult\) => Promise<void>;/);
  });
});
