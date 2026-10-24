import fs from 'fs';
import path from 'path';

/**
 * Wiring guards for the tutorial entry points (source-level, same pattern as
 * the repo's other *.structure tests):
 *  - the overlay is mounted only in the claimed-profile RootNavigator branch,
 *    so OTP / family onboarding / profile entry are never interrupted;
 *  - "סרטון הדרכה" is reachable from Settings and from Family (Settings is
 *    permission-gated for members, Family is not);
 *  - the tutorial code never touches auth, SyncQueue or migrations.
 */

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('tutorial entry points', () => {
  it('mounts the overlay beside RootNavigator only', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/<RootNavigator \/>\s*<TutorialOverlay \/>/);
    expect(app.match(/<TutorialOverlay \/>/g)).toHaveLength(1);
    expect(app).toContain('useFirstRunTutorial({ familySetupWizardVisible, competingOverlayVisible: showIosInstallPrompt })');
    const onboardingBranch = app.slice(app.indexOf('<FamilyOnboardingScreen'), app.indexOf('<RootNavigator />'));
    expect(onboardingBranch).not.toContain('TutorialOverlay');
  });

  it('offers "סרטון הדרכה" in Settings → עזרה and Family → עזרה', () => {
    for (const rel of ['src/screens/SettingsScreen.tsx', 'src/screens/FamilyScreen.tsx']) {
      const src = read(rel);
      expect(src).toContain('❓ עזרה');
      expect(src).toContain('▶ סרטון הדרכה');
      expect(src).toContain('openTutorialFromHelp()');
      expect(src).toContain('accessibilityLabel="סרטון הדרכה"');
    }
  });

  it('keeps tutorial code away from auth writes, SyncQueue and Supabase', () => {
    const files = [
      'src/lib/tutorialConfig.ts',
      'src/lib/tutorialProgress.ts',
      'src/logic/tutorialGate.ts',
      'src/logic/tutorialPlayerState.ts',
      'src/store/tutorialStore.ts',
      'src/components/tutorial/TutorialVideoPlayer.tsx',
      'src/components/tutorial/TutorialOverlay.tsx',
      'src/components/tutorial/useFirstRunTutorial.ts',
    ];
    for (const rel of files) {
      const src = read(rel);
      expect(src).not.toMatch(/syncQueue|SyncQueue|from '..\/..\/data'|from '..\/data'|supabase\.(from|rpc)/);
      expect(src).not.toMatch(/\.(signIn|signOut|setFamilyId|signInWithPin)\(/);
    }
  });

  it('never hard-codes a tutorial video URL', () => {
    for (const rel of ['src/lib/tutorialConfig.ts', 'src/components/tutorial/TutorialVideoPlayer.tsx', 'src/components/tutorial/TutorialOverlay.tsx']) {
      expect(read(rel)).not.toMatch(/https?:\/\/[^\s'"`]+\.(mp4|webm|m3u8|mov)/i);
    }
  });

  it('keeps the draft server schema out of the migrations folder', () => {
    const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'));
    expect(migrations.some((name) => /tutorial/i.test(name))).toBe(false);
  });
});
