import fs from 'fs';

/**
 * Phase 1B batch 2 (user-facing multi-dog foundation): SettingsScreen is
 * where a dog's profile has always been edited (the dog card, opening
 * DogDetailsModal) — this adds the selector strip that lets an arbitrary N
 * dogs coexist: tapping a chip makes that dog ACTIVE (familyStore.selectDog,
 * persisted), which the existing dog card immediately reflects since it
 * still just reads `dog` from the store, unchanged. "Add dog" creates a new
 * dog, selects it, and opens the same edit sheet.
 * Source-scan convention: this repo has no render-test harness for screens.
 */
describe('SettingsScreen keeps multi-dog support secondary to the common single-dog case (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('destructures dogs/selectedDogId/selectDog from familyStore alongside the existing dog/saveDog', () => {
    expect(source).toMatch(/const \{ family, users, dog, dogs, selectedDogId, load: loadFamily, setReminderEnabled, setGamificationEnabled, saveDog, selectDog \} = useFamilyStore\(\);/);
  });

  it('does not render the prominent multi-dog selector strip on the main Settings screen', () => {
    expect(source).not.toContain('dogs.map((d)');
    expect(source).not.toContain('{dogs.length > 0 ?');
  });

  it('keeps add-dog capability but exposes it through DogDetailsModal as a secondary action', () => {
    const handlerStart = source.indexOf('const handleAddDog');
    expect(handlerStart).toBeGreaterThan(-1);
    const handler = source.slice(handlerStart, handlerStart + 700);
    expect(handler).toMatch(/await saveDog\(newDog\)/);
    expect(handler).toMatch(/await selectDog\(newDog\.id\)/);
    expect(source).toContain('onAddDog={() => void handleAddDog()}');
  });

  it('the existing dog card (tap-to-edit) is untouched and still reads `dog` from the store — no regression for the single-dog case', () => {
    const cardIdx = source.indexOf('style={styles.dogCard}');
    expect(cardIdx).toBeGreaterThan(-1);
    const card = source.slice(cardIdx, cardIdx + 400);
    expect(card).toMatch(/onPress=\{\(\) => setDogModalVisible\(true\)\}/);
    expect(card).toMatch(/פרטי \$\{dog\.name\}, לעריכה/);
  });


});
