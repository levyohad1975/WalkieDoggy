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
describe('SettingsScreen offers a multi-dog selector above the existing dog card (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('destructures dogs/selectedDogId/selectDog from familyStore alongside the existing dog/saveDog', () => {
    expect(source).toMatch(/const \{ family, users, dog, dogs, selectedDogId, load: loadFamily, setReminderEnabled, setGamificationEnabled, saveDog, selectDog \} = useFamilyStore\(\);/);
  });

  it('renders one selectable chip per dog, each calling selectDog(d.id)', () => {
    const blockStart = source.indexOf('dogs.map((d)');
    expect(blockStart).toBeGreaterThan(-1);
    const block = source.slice(blockStart, blockStart + 800);
    expect(block).toMatch(/onPress=\{\(\) => void selectDog\(d\.id\)\}/);
    expect(block).toMatch(/accessibilityState=\{\{ selected: isActive \}\}/);
  });

  it('offers an "add dog" chip that creates, selects, and opens the edit sheet for a new dog', () => {
    const handlerStart = source.indexOf('const handleAddDog');
    expect(handlerStart).toBeGreaterThan(-1);
    const handler = source.slice(handlerStart, handlerStart + 700);
    expect(handler).toMatch(/id: generateId\('dog'\)/);
    expect(handler).toMatch(/await saveDog\(newDog\)/);
    expect(handler).toMatch(/await selectDog\(newDog\.id\)/);
    expect(handler).toMatch(/setDogModalVisible\(true\)/);

    const jsxCallIdx = source.indexOf('onPress={() => void handleAddDog()}');
    expect(jsxCallIdx).toBeGreaterThan(-1);
  });

  it('the existing dog card (tap-to-edit) is untouched and still reads `dog` from the store — no regression for the single-dog case', () => {
    const cardIdx = source.indexOf('style={styles.dogCard}');
    expect(cardIdx).toBeGreaterThan(-1);
    const card = source.slice(cardIdx, cardIdx + 400);
    expect(card).toMatch(/onPress=\{\(\) => setDogModalVisible\(true\)\}/);
    expect(card).toMatch(/פרטי \$\{dog\.name\}, לעריכה/);
  });

  it('the selector strip is guarded on dogs.length, never rendered for zero dogs', () => {
    const guardIdx = source.indexOf('{dogs.length > 0 ?');
    expect(guardIdx).toBeGreaterThan(-1);
  });
});
