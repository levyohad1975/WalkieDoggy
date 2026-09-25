import fs from 'fs';
import path from 'path';

/**
 * PRD §11: "ב-Home יש בחירת כלב קלה כאשר יש יותר מכלב אחד" — the same
 * requirement HomeScreen.multiDog.test.ts covers, here for ScheduleScreen.
 * Before this fix, ScheduleScreen's header implied one dog
 * ("לוח הזמנים של {dog?.name}") while `grouped` (the date-grouped walk
 * list) and `sortedRules` mixed every dog's walks/rules into one
 * undifferentiated list, with no way to switch which dog was shown.
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('ScheduleScreen multi-dog wiring (structural)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ScheduleScreen.tsx'), 'utf8');

  it('destructures dogs/selectedDogId/selectDog from familyStore and renders DogSelectorRow only for 2+ dogs', () => {
    expect(source).toContain(
      'const { users, dog, dogs, selectedDogId, selectDog, loading: familyLoading, load: loadFamily } = useFamilyStore();'
    );
    expect(source).toContain("import { DogSelectorRow } from '../components/DogSelectorRow';");
    expect(source).toMatch(/\{dogs\.length > 1 \? \(\s*\n\s*<DogSelectorRow dogs=\{dogs\} selectedDogId=\{selectedDogId\} onSelect=\{\(dogId\) => void selectDog\(dogId\)\} \/>/);
  });

  it('derives dog-filtered visibleWalks/visibleRules and feeds them into grouped/sortedRules, not the raw family-wide walks/rules', () => {
    expect(source).toMatch(
      /const visibleWalks = useMemo\(\s*\n\s*\(\) => \(dogs\.length > 1 && dog \? walks\.filter\(\(w\) => w\.dogId === dog\.id\) : walks\),/
    );
    expect(source).toMatch(
      /const visibleRules = useMemo\(\s*\n\s*\(\) => \(dogs\.length > 1 && dog \? rules\.filter\(\(r\) => r\.dogId === dog\.id\) : rules\),/
    );
    expect(source).toContain('const filtered = visibleWalks.filter((w) => inRange(w.date, range));');
    expect(source).toContain('[...visibleRules].sort((a, b) => a.time.localeCompare(b.time))');
  });

  it('the edit-walk "swap with" candidate list only offers walks belonging to the SAME dog as the one being edited', () => {
    const idx = source.indexOf('const otherPendingWalks = useMemo(');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, source.indexOf('}, [walks, editingWalk, usersById]);', idx));
    expect(block).toContain("w.id !== editingWalk.id && w.status === 'pending' && w.dogId === editingWalk.dogId");
  });
});
