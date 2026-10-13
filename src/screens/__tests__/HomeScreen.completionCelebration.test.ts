import fs from 'fs';
import path from 'path';

describe('Home completion celebration integration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('opens the shared celebration only after a scheduled completion succeeds', () => {
    const completion = source.indexOf("const completed = walkBeingCompleted?.status === 'in_progress'");
    const durableFinish = source.indexOf('await finishWalk(walkId, completedByUserId');
    const legacyFinish = source.indexOf('await markDone(walkId, completedByUserId');
    const celebration = source.indexOf('if (completed) {');
    expect(completion).toBeGreaterThan(-1);
    expect(durableFinish).toBeGreaterThan(completion);
    expect(legacyFinish).toBeGreaterThan(completion);
    expect(celebration).toBeGreaterThan(durableFinish);
    // Gamification batch: the success branch now also triggers the
    // achievement-unlock check alongside the celebration — same
    // success-gated `if (completed)` block, not a separate ungated call.
    const block = source.slice(celebration, source.indexOf('}}', celebration));
    expect(block).toContain('showWalkCompletionCelebration(walkBeingCompleted?.durationMinutes)');
    expect(block).toContain('checkForNewAchievementUnlocks()');
  });

  it('uses that same success-gated celebration for a saved spontaneous walk', () => {
    const saved = source.indexOf('const saved = await addUnplannedWalk({');
    const celebration = source.indexOf('if (saved) {');
    expect(saved).toBeGreaterThan(-1);
    expect(celebration).toBeGreaterThan(saved);
    const block = source.slice(celebration, source.indexOf('}', celebration));
    expect(block).toContain('showWalkCompletionCelebration(result.durationMinutes)');
    expect(block).toContain('checkForNewAchievementUnlocks()');
  });

  it('uses the shared dismissible celebration overlay rather than a toast', () => {
    expect(source).toContain('<WalkCompletionCelebration');
    const idx = source.indexOf('<WalkCompletionCelebration');
    const block = source.slice(idx, source.indexOf('/>', idx));
    expect(block).toContain('setCelebration(null)');
  });
});
