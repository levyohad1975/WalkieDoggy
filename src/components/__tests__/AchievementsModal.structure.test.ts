import fs from 'fs';

/**
 * PRD §9 gamification, Phase 5 kickoff — structural checks for the
 * read-only achievements/progress view + off-switch. Source-scan
 * convention: this repo has no render-test harness for screens/modals.
 */
describe('AchievementsModal (structural)', () => {
  const source = fs.readFileSync(require.resolve('../AchievementsModal'), 'utf8').replace(/\r\n/g, '\n');

  it('offers a gamification off-switch (PRD: "עם אפשרות לכיבוי") bound to the given value/handler, never a local-only toggle', () => {
    expect(source).toMatch(/<Switch/);
    expect(source).toMatch(/value=\{gamificationEnabled\}/);
    expect(source).toMatch(/onValueChange=\{onSetGamificationEnabled\}/);
  });

  it('shows every achievement (locked and unlocked), never hiding a locked one — PRD: no dark patterns, no punishment for missing one', () => {
    expect(source).toMatch(/familyProgress\.map/);
    expect(source).not.toMatch(/filter\([^)]*unlocked/);
  });

  it('shows current/target progress for a locked achievement, and a distinct "unlocked" state instead once it is', () => {
    expect(source).toMatch(/progress\.current\}\/\{progress\.target\}/);
    expect(source).toMatch(/progress\.unlocked \? <RtlText style=\{styles\.unlockedBadge\}>/);
  });

  it('looks up display copy via achievementDefinition, never hardcoding titles inline', () => {
    expect(source).toMatch(/import \{ achievementDefinition, type AchievementProgress \} from '\.\.\/logic\/achievements';/);
    expect(source).toMatch(/const def = achievementDefinition\(progress\.key\)/);
  });

  it('renders a separate personal-achievements section only when there is personal progress to show', () => {
    expect(source).toMatch(/personalProgress\.length > 0/);
  });
});
