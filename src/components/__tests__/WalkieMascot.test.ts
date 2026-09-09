import { MASCOT_STATES, MASCOT_ASSET_PRODUCTION_LIST, MASCOT_ANIMATION_STATUS, type MascotState } from '../WalkieMascot';

/**
 * BATCH 4 (C2 — mascot animation system). WalkieMascot.tsx itself renders
 * RN Animated/Image/AccessibilityInfo and can't be render-tested in this
 * repo's convention (no RN component-rendering test infra — see
 * mascot/__tests__/mascotStage.test.ts's own note on this), but its two
 * plain-data exports are ordinary objects/arrays and are tested directly
 * here: every required state is present, and the C2-required asset
 * production list (deliverable #9 in the Batch 4 report) covers every one
 * of them with a non-empty description.
 */
describe('components/WalkieMascot — MASCOT_STATES / MASCOT_ASSET_PRODUCTION_LIST', () => {
  it('includes exactly the six required states from the brief (C2)', () => {
    const required: MascotState[] = ['idle', 'excited', 'ready', 'waiting', 'concerned', 'success'];
    expect(MASCOT_STATES).toHaveLength(6);
    for (const state of required) {
      expect(MASCOT_STATES).toContain(state);
    }
  });

  it('MASCOT_ASSET_PRODUCTION_LIST has a non-empty production note for every required state, and no extras', () => {
    const keys = Object.keys(MASCOT_ASSET_PRODUCTION_LIST) as MascotState[];
    expect(keys.sort()).toEqual([...MASCOT_STATES].sort());
    for (const state of MASCOT_STATES) {
      expect(typeof MASCOT_ASSET_PRODUCTION_LIST[state]).toBe('string');
      expect(MASCOT_ASSET_PRODUCTION_LIST[state].length).toBeGreaterThan(10);
    }
  });

  /**
   * BATCH 4 CORRECTION #1 (item 1). Regression guard against re-introducing
   * the overclaim the review flagged: this must never silently become
   * 'complete' (or any value not containing 'fallback') without a deliberate
   * code change that also updates the module doc comment and the asset
   * production list — whole-image transforms on one static bitmap are not
   * the real character animation (blink/tail-wag/ear-expression/new poses)
   * the product requires.
   */
  it('MASCOT_ANIMATION_STATUS honestly reports this as a temporary fallback, not the completed requirement', () => {
    expect(MASCOT_ANIMATION_STATUS).toBe('temporary-fallback-real-character-frames-required');
    expect(MASCOT_ANIMATION_STATUS).toContain('fallback');
    expect(MASCOT_ANIMATION_STATUS).not.toBe('complete');
  });

  it('every production-list entry for a state needing a new base pose (ready/concerned/success) says so explicitly', () => {
    expect(MASCOT_ASSET_PRODUCTION_LIST.ready).toMatch(/NEW BASE POSE/);
    expect(MASCOT_ASSET_PRODUCTION_LIST.concerned).toMatch(/NEW BASE POSE/);
    expect(MASCOT_ASSET_PRODUCTION_LIST.success).toMatch(/NEW BASE POSE/);
  });
});
