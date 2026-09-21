import fs from 'fs';
import path from 'path';

describe('Home completion celebration integration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('opens the shared celebration only after a scheduled completion succeeds', () => {
    const completion = source.indexOf("const completed = walkBeingCompleted?.status === 'in_progress'");
    const durableFinish = source.indexOf('await finishWalk(walkId, completedByUserId');
    const legacyFinish = source.indexOf('await markDone(walkId, completedByUserId');
    const celebration = source.indexOf('if (completed) showWalkCompletionCelebration');
    expect(completion).toBeGreaterThan(-1);
    expect(durableFinish).toBeGreaterThan(completion);
    expect(legacyFinish).toBeGreaterThan(completion);
    expect(celebration).toBeGreaterThan(durableFinish);
  });

  it('uses that same success-gated celebration for a saved spontaneous walk', () => {
    const saved = source.indexOf('const saved = await addUnplannedWalk({');
    const celebration = source.indexOf('if (saved) showWalkCompletionCelebration(result.durationMinutes)');
    expect(saved).toBeGreaterThan(-1);
    expect(celebration).toBeGreaterThan(saved);
  });

  it('uses the shared dismissible celebration overlay rather than a toast', () => {
    expect(source).toContain('<WalkCompletionCelebration');
    expect(source).toContain('onDismiss={() => setCelebration(null)}');
  });
});
