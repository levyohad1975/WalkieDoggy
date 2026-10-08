import fs from 'fs';

/**
 * Real-device QA fix — a scheduled walk/rule must have exactly ONE
 * responsible family member. Real-iPhone QA found this screen's member
 * picker was multi-select: tapping a second member ADDED them to
 * `rotation` instead of replacing the first. That was not an accidental
 * UI-state bug — rotation.ts's resolveResponsibleForDate() has always
 * deliberately cycled through MULTIPLE ids across different days when
 * more than one is present (a real "family rotation" feature; the demo
 * seed's four default rules all ship with every family member in
 * rotationUserIds). This fix retires that authoring UI in favor of
 * single-select, WITHOUT touching the data model: `rotationUserIds`
 * stays a string array (now always written as exactly one element by
 * this screen), and rotation.ts's own multi-member logic is untouched —
 * it already special-cases a length-1 array as a fixed single assignee
 * (see rotation.test.ts's "returns a fixed single responsible user for
 * every date when rotation has one member" — covers requirement 6, no
 * duplicate entries/walks for a single-assignee rule, so not repeated
 * here).
 *
 * Source-scan convention: this repo has no render-test harness for
 * components (see DogSelectorRow.structure.test.ts's own doc comment).
 */
describe('RuleFormModal — single-select responsible member (structural)', () => {
  const source = fs.readFileSync(require.resolve('../RuleFormModal'), 'utf8').replace(/\r\n/g, '\n');

  // Requirements 1-2-3: selecting A selects A; selecting B immediately
  // deselects A and selects B; only B is ever in the array submitted.
  // All three are structurally guaranteed by selectResponsibleUser()
  // unconditionally REPLACING the array (never appending/toggling) —
  // there is no code path in this function that can produce more than
  // one id, or keep a previous one around after a different tap.
  it('selectResponsibleUser() always REPLACES the selection with exactly the tapped member — never appends, never toggles', () => {
    expect(source).toMatch(/const selectResponsibleUser = \(id: string\) => setRotation\(\[id\]\);/);
    expect(source).not.toMatch(/const toggleRotationUser/);
    expect(source).not.toMatch(/setRotation\(\(prev\) => \(prev\.includes/);
  });

  it('the member picker is wired to selectResponsibleUser, never a toggle, and visually marks AT MOST one chip as selected', () => {
    expect(source).toMatch(/onPress=\{\(\) => selectResponsibleUser\(u\.id\)\}/);
    expect(source).toMatch(/const isSelected = rotation\[0\] === u\.id;/);
    // The old numeric "position in rotation" badge made no sense once at
    // most one member can ever be selected — confirms it was actually
    // removed, not just visually hidden.
    expect(source).not.toMatch(/rotationBadge/);
    expect(source).not.toMatch(/מספר \$\{idx \+ 1\} בסבב/);
  });

  // Requirement 4: editing an existing rule shows exactly its current
  // assignee — including a pre-existing multi-member rotation rule
  // (saved before this fix, or the demo seed's own default rules), which
  // must show only ONE (the first), never all of them.
  it('loading an existing rule for editing takes only the FIRST id from rotationUserIds, even if it has more than one (a pre-existing rotation rule)', () => {
    expect(source).toMatch(/setRotation\(editingRule \? \(editingRule\.rotationUserIds\?\.slice\(0, 1\) \?\? \[\]\) : \(users\.length === 1 \? \[users\[0\]\.id\] : \[\]\)\);/);
  });

  // Requirement 5: changing assignee replaces, never appends — same
  // guarantee as the first assertion above, re-asserted here against the
  // validation/submit path specifically: whatever is in `rotation` at
  // submit time is exactly what gets persisted, and it can never hold
  // more than one id by construction.
  it('submit() persists exactly the single selected id in rotationUserIds, and requires one to be selected', () => {
    expect(source).toMatch(/rotationUserIds: rotation/);
    expect(source).toMatch(/if \(rotation\.length === 0\) return setError\('יש לבחור אחראי\/ת לטיול'\);/);
  });

  it('never imports previewRotation — there is nothing left to preview once at most one member can be selected', () => {
    expect(source).not.toMatch(/previewRotation/);
  });
});
