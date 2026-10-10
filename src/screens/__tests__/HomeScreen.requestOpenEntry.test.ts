import fs from 'fs';
import path from 'path';

/**
 * Mascot-notification-experiences round — a tapped swap/time-change push
 * must always open the requests inbox (never a dead end), and only an
 * 'approved' outcome also shows the happy-confirmation mascot moment (a
 * 'created'/'rejected' tap must never look celebratory). Source-scan
 * convention (same as HomeScreen.reminderEntry.test.ts): this repo has no
 * render harness for HomeScreen.
 */
describe('Home request-open notification integration (structural)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('subscribes to request-open events and always navigates Home + opens the inbox', () => {
    const subIdx = source.indexOf('subscribeToRequestOpens((event) => {');
    expect(subIdx).toBeGreaterThan(-1);
    const block = source.slice(subIdx, subIdx + 300);
    expect(block).toContain("navigation.navigate('Home');");
    expect(block).toContain('openRequestsInbox();');
  });

  it('shows the happy-confirmation mascot moment ONLY for an approved event, never created/rejected', () => {
    const subIdx = source.indexOf('subscribeToRequestOpens((event) => {');
    const block = source.slice(subIdx, subIdx + 300);
    expect(block).toMatch(/if \(event\.event === 'approved'\) setRequestPrompt\(event\);/);
  });

  it('the request-prompt message is a fixed, always-available celebratory string per request kind — never a lookup that could fail for a stale/not-yet-loaded request', () => {
    expect(source).toContain("requestPrompt.kind === 'swap' ? 'בקשת ההחלפה אושרה! 🎉' : 'בקשת שינוי השעה אושרה! 🎉'");
  });

  it('renders a second ReminderMascotPrompt instance for the request confirmation, reusing the identical approved mascot component and a fixed happy animationId', () => {
    const renderIdx = source.indexOf('visible={!!requestPromptMessage}');
    expect(renderIdx).toBeGreaterThan(-1);
    const block = source.slice(renderIdx - 40, renderIdx + 200);
    expect(block).toContain('animationId="high-five"');
    expect(block).toContain('onDismiss={() => setRequestPrompt(null)}');
  });

  it('initializes the web notification-click entry point (URL param consume + service-worker message subscription) once on mount', () => {
    expect(source).toContain('consumeInitialWebNotificationParam();');
    expect(source).toContain('return subscribeToWebNotificationClicks();');
  });
});
