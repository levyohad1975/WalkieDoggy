import fs from 'fs';

/**
 * Phase 3 kickoff (Health & Grooming, PRD §10) — SettingsScreen is where the
 * PRD explicitly places this ("Settings includes: ... health/grooming").
 * The entry point is scoped to the currently ACTIVE dog (familyStore's
 * multi-dog selection, see FamilyOnboarding's selector strip) and hidden
 * entirely when no dog is loaded, rather than showing a family-wide or
 * dog-less list. Source-scan convention: this repo has no render-test
 * harness for screens.
 */
describe('SettingsScreen wires the Health & Grooming entry point to the active dog (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('imports useHealthStore and HealthGroomingModal', () => {
    expect(source).toMatch(/import \{ useHealthStore \} from '\.\.\/store\/healthStore';/);
    expect(source).toMatch(/import \{ HealthGroomingModal \} from '\.\.\/components\/HealthGroomingModal';/);
  });

  it('the entry row is gated on `dog` (hidden entirely with no active dog) and opens healthModalVisible', () => {
    const rowStart = source.indexOf('בריאות וטיפוח');
    expect(rowStart).toBeGreaterThan(-1);
    const rowBlock = source.slice(Math.max(0, rowStart - 300), rowStart + 100);
    expect(rowBlock).toMatch(/\{dog \? \(/);
    expect(rowBlock).toMatch(/onPress=\{\(\) => setHealthModalVisible\(true\)\}/);
  });

  it('loads health tasks for the active dog only while the modal is open, and reloads if the active dog changes', () => {
    const effectStart = source.indexOf('void loadHealthTasks(dog.id)');
    expect(effectStart).toBeGreaterThan(-1);
    const effectBlock = source.slice(Math.max(0, effectStart - 300), effectStart + 100);
    expect(effectBlock).toMatch(/if \(healthModalVisible && dog\)/);
    expect(source).toMatch(/\}, \[healthModalVisible, dog\?\.id, loadHealthTasks\]\);/);
  });

  it('consumes the cross-tab pendingOpenRequest signal on focus (from Home\'s badge), opening the sheet exactly once per request', () => {
    expect(source).toMatch(/import \{ useFocusEffect \} from '@react-navigation\/native';/);
    const focusIdx = source.indexOf('useFocusEffect(');
    expect(focusIdx).toBeGreaterThan(-1);
    const block = source.slice(focusIdx, focusIdx + 400);
    expect(block).toMatch(/useHealthStore\.getState\(\)\.consumePendingOpenRequest\(\)/);
    expect(block).toMatch(/setHealthModalVisible\(true\)/);
  });

  it('passes the active dog, its tasks, and save/complete handlers into HealthGroomingModal', () => {
    const modalStart = source.indexOf('<HealthGroomingModal');
    expect(modalStart).toBeGreaterThan(-1);
    const modalBlock = source.slice(modalStart, modalStart + 400);
    expect(modalBlock).toMatch(/dog=\{dog \?\? null\}/);
    expect(modalBlock).toMatch(/tasks=\{healthTasks\}/);
    expect(modalBlock).toMatch(/users=\{users\}/);
    expect(modalBlock).toMatch(/onSave=\{saveHealthTask\}/);
    expect(modalBlock).toMatch(/onComplete=\{\(taskId\) => completeHealthTask\(taskId, currentUserId \?\? ''\)\}/);
  });
});
