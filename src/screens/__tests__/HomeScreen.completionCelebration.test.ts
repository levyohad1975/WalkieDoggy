import fs from 'fs';
import path from 'path';

describe('Home completion celebration integration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('opens the UI-only celebration only after the completion mutation resolves', () => {
    const completion = source.indexOf('await markDone(walkId, completedByUserId');
    const celebration = source.indexOf('setCelebration(selectWalkCompletionCelebration())');
    expect(completion).toBeGreaterThan(-1);
    expect(celebration).toBeGreaterThan(completion);
  });

  it('uses the shared dismissible celebration overlay rather than a toast', () => {
    expect(source).toContain('<WalkCompletionCelebration');
    expect(source).toContain('onDismiss={() => setCelebration(null)}');
  });
});
