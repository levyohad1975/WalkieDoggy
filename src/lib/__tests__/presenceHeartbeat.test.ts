/**
 * Structural guard (no RN rendering harness in this repo).
 *
 * Production report 2026-11-01: a member who had just joined showed as
 * offline on the Admin's Family screen while actively using the app.
 * Presence was only written on foreground transitions, so continuous use
 * aged past the 5-minute "פעיל עכשיו" window.
 */
import { PRESENCE_FRESH_MINUTES } from '../../logic/presence';

describe('App presence heartbeat', () => {
  const fs = require('fs');
  const path = require('path');
  const app: string = fs.readFileSync(path.join(__dirname, '../../../App.tsx'), 'utf8');

  it('beats more often than the presence freshness window', () => {
    const match = app.match(/const PRESENCE_HEARTBEAT_MS = (\d+) \* (\d+) \* (\d+);/);
    expect(match).not.toBeNull();
    const ms = Number(match![1]) * Number(match![2]) * Number(match![3]);
    expect(ms).toBeLessThan(PRESENCE_FRESH_MINUTES * 60 * 1000);
  });

  it('runs for every signed-in member, only in front, never for hidden observation', () => {
    expect(app).toContain('if (!isSupabaseConfigured || !currentUserId || systemObserverActive) return;');
    expect(app).toContain("if (AppState.currentState !== 'active') return;");
    expect(app).toContain('if (useAuthStore.getState().systemObserverActive) return;');
    expect(app).toMatch(/const beat = \(\) => \{[\s\S]{0,240}void touchLastSeen\(\)\.catch\(\(\) => undefined\);\n\s*\};/);
    expect(app).toMatch(/const timer = setInterval\(beat, PRESENCE_HEARTBEAT_MS\);\n\s*return \(\) => clearInterval\(timer\);\n\s*\}, \[currentUserId, systemObserverActive\]\);/);
  });

  it('beats immediately once a profile is active, not only after the first interval (Production 2026-11-04)', () => {
    expect(app).toMatch(/\n\s*beat\(\);\n\s*const timer = setInterval\(beat, PRESENCE_HEARTBEAT_MS\);/);
  });
});
