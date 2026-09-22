import fs from 'fs';
import path from 'path';

/**
 * PRD §9 gamification, Phase 5 kickoff — HomeScreen is where a walk
 * completion triggers achievement detection + the celebration popup.
 * Source-scan convention: this repo has no render-test harness for
 * screens.
 */
describe('HomeScreen wires achievement-unlock detection + celebration (structural)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('loads the family achievement ledger on mount, alongside family/schedule', () => {
    const idx = source.indexOf('void useAchievementStore.getState().load(familyId);');
    expect(idx).toBeGreaterThan(-1);
    const mountEffectIdx = source.indexOf('loadFamily(familyId);');
    expect(mountEffectIdx).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(mountEffectIdx);
  });

  it('checks for new unlocks in the SAME success-gated branch as both walk-completion celebration call sites', () => {
    const scheduled = source.indexOf('if (completed) {');
    expect(scheduled).toBeGreaterThan(-1);
    const scheduledBlock = source.slice(scheduled, source.indexOf('}}', scheduled));
    expect(scheduledBlock).toContain('checkForNewAchievementUnlocks()');

    const spontaneous = source.indexOf('if (saved) {');
    expect(spontaneous).toBeGreaterThan(-1);
    const spontaneousBlock = source.slice(spontaneous, source.indexOf('}', spontaneous));
    expect(spontaneousBlock).toContain('checkForNewAchievementUnlocks()');
  });

  it('the achievement-unlock check reads the family-wide history read (not the RLS-windowed scheduleStore.walks) in Supabase mode', () => {
    const fnStart = source.indexOf('const fetchAchievementWalks = useCallback');
    expect(fnStart).toBeGreaterThan(-1);
    const fn = source.slice(fnStart, fnStart + 400);
    expect(fn).toMatch(/if \(!isSupabaseConfigured\) return useScheduleStore\.getState\(\)\.walks;/);
    expect(fn).toMatch(/return await fetchHistoryWalks\(\);/);
  });

  it('gates the celebration POPUP (not the underlying unlock persistence) on this member\'s own gamificationEnabled', () => {
    expect(source).toMatch(/const gamificationEnabled = usersById\[effectiveUserId\]\?\.gamificationEnabled \?\? true;/);
    const fnStart = source.indexOf('const showNextAchievementCelebration = useCallback');
    expect(fnStart).toBeGreaterThan(-1);
    const fn = source.slice(fnStart, fnStart + 500);
    expect(fn).toMatch(/if \(!gamificationEnabled\) \{/);
  });

  it('sequences an achievement celebration through the SAME shared celebration state as the walk-completion one, not a second overlay', () => {
    const dismissIdx = source.indexOf('onDismiss={() => {\n          setCelebration(null);\n          showNextAchievementCelebration();');
    expect(dismissIdx).toBeGreaterThan(-1);
    // Only one WalkCompletionCelebration element in the whole file.
    const matches = source.match(/<WalkCompletionCelebration/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('builds the achievement celebration from the catalog definition, reusing an existing CELEBRATION_LIBRARY asset rather than a new one', () => {
    expect(source).toMatch(/import \{ CELEBRATION_LIBRARY, selectWalkCompletionCelebration, type CompletionCelebration \} from '\.\.\/logic\/walkCompletionCelebration';/);
    expect(source).toMatch(/import \{ achievementDefinition, type AchievementProgress \} from '\.\.\/logic\/achievements';/);
    const fnStart = source.indexOf('const buildAchievementCelebration = useCallback');
    expect(fnStart).toBeGreaterThan(-1);
    const fn = source.slice(fnStart, fnStart + 500);
    expect(fn).toMatch(/CELEBRATION_LIBRARY\.find\(\(c\) => c\.id === \(definition\?\.celebrationId \?\? 'trophy-teaser'\)\)/);
  });
});
