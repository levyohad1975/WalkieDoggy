import fs from 'fs';
import path from 'path';

/**
 * PRD §11: "ב-Home יש בחירת כלב קלה כאשר יש יותר מכלב אחד" — Home
 * previously had no dog picker at all, and every "pick from the pool"
 * computation (next/last/upcoming/overdue walk) read the unfiltered,
 * family-wide `walks` store — a multi-dog family's central card could pick
 * the wrong dog's walk entirely, and label it with the wrong dog's name.
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('HomeScreen multi-dog wiring (structural)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('destructures dogs/selectedDogId/selectDog from familyStore and renders DogSelectorRow only for 2+ dogs', () => {
    expect(source).toContain(
      "const { family, users, dog, dogs, selectedDogId, selectDog, loading: familyLoading, error: familyError, load: loadFamily } = useFamilyStore();"
    );
    expect(source).toContain("import { DogSelectorRow } from '../components/DogSelectorRow';");
    expect(source).toMatch(/\{dogs\.length > 1 \? \(\s*\n\s*<DogSelectorRow dogs=\{dogs\} selectedDogId=\{selectedDogId\} onSelect=\{\(dogId\) => void selectDog\(dogId\)\} \/>/);
  });

  it('derives visibleWalks (dog-filtered when there is more than one dog) and feeds it into next/last/upcoming/overdue, not the raw family-wide walks', () => {
    expect(source).toMatch(
      /const visibleWalks = useMemo\(\s*\n\s*\(\) => \(dogs\.length > 1 && dog \? walks\.filter\(\(w\) => w\.dogId === dog\.id\) : walks\),/
    );
    expect(source).toContain('const nextWalk = useMemo(() => computeNextWalk(visibleWalks)');
    expect(source).toContain('const resolvedToday = computeLastWalk(visibleWalks);');
    expect(source).toContain('() => upcomingWalks(visibleWalks).filter((w) => w.id !== nextWalk?.id)');
    expect(source).toContain('visibleWalks\n        .filter(');
  });

  it('a walk-swap candidate list only ever offers walks belonging to the SAME dog as the one being edited/swapped', () => {
    // The two SwapWalkPickerModal call sites already filtered by dogId
    // before this pass (unaffected) — this asserts the THIRD, previously
    // ungated list (the edit-walk "swap with" picker) now does too.
    const idx = source.indexOf('const otherPendingWalks = useMemo(');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, source.indexOf('}, [walks, editingWalk, usersById]);', idx));
    expect(block).toContain("w.id !== editingWalk.id && w.dogId === editingWalk.dogId");
  });
});
