import fs from 'fs';

/**
 * PRD §9 gamification, Phase 5 kickoff — SettingsScreen is where the
 * achievements/progress view + off-switch is entered from (📱 החשבון שלי
 * section, alongside 🔁 החלף משתמש). Source-scan convention: this repo has
 * no render-test harness for screens.
 */
describe('SettingsScreen wires the Achievements entry point (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('imports useAchievementStore and AchievementsModal', () => {
    expect(source).toMatch(/import \{ useAchievementStore \} from '\.\.\/store\/achievementStore';/);
    expect(source).toMatch(/import \{ AchievementsModal \} from '\.\.\/components\/AchievementsModal';/);
  });

  it('the entry row opens achievementsModalVisible and sits in the ordinary (non-admin-gated) section', () => {
    const rowIdx = source.indexOf("onPress={() => setAchievementsModalVisible(true)}");
    expect(rowIdx).toBeGreaterThan(-1);
    const adminSectionIdx = source.indexOf("familyRole === 'admin' ? (");
    expect(rowIdx).toBeLessThan(adminSectionIdx);
  });

  it('loads the family unlock ledger and fetches walk history + swap requests only once the sheet is actually opened, not eagerly on mount', () => {
    const effectStart = source.indexOf('if (!achievementsModalVisible) return;');
    expect(effectStart).toBeGreaterThan(-1);
    const effectBlock = source.slice(Math.max(0, effectStart - 100), effectStart + 600);
    expect(effectBlock).toMatch(/useAchievementStore\.getState\(\)\.load\(familyId\)/);
    expect(effectBlock).toMatch(/fetchHistoryWalks\(\)/);
    expect(effectBlock).toMatch(/listSwapRequests\(\)/);
  });

  it('computes progress from current walks while preserving immutable unlocks from the current family ledger', () => {
    expect(source).toMatch(/import \{ computeFamilyAchievementProgress, computePersonalAchievementProgress, preserveUnlockedAchievements \} from '\.\.\/logic\/achievements';/);
    expect(source).toMatch(/computeFamilyAchievementProgress\(achievementWalks\)/);
    expect(source).toMatch(/computePersonalAchievementProgress\(achievementWalks, currentUserId, achievementSwapRequests\)/);
    expect(source).toContain('loadedAchievementFamilyId === familyId ? achievementUnlocks : []');
    expect(source).toContain('preserveUnlockedAchievements(');
  });

  it('passes the current user\'s own gamificationEnabled flag and a real setter into AchievementsModal, not a stub', () => {
    const modalStart = source.indexOf('<AchievementsModal');
    expect(modalStart).toBeGreaterThan(-1);
    const modalBlock = source.slice(modalStart, modalStart + 500);
    expect(modalBlock).toMatch(/gamificationEnabled=\{gamificationEnabled\}/);
    expect(modalBlock).toMatch(/void setGamificationEnabled\(currentUserId, enabled\)/);
  });
});
