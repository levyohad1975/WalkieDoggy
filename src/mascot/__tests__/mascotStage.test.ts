import { deriveMascotStageForPendingWalk, deriveMascotMoment, MASCOT_MOMENT_MAP } from '../mascotStage';
import { MASCOT_STATES } from '../../components/WalkieMascot';

/**
 * BATCH 4 (C8) — direct tests of the centralized stage/state/category
 * pairing table and the time-bucketing that derives a stage from "now" vs
 * a walk's scheduled time. Pure logic, no RN import needed for these
 * specific exports (WalkieMascot's MASCOT_STATES is a plain string array,
 * not the component itself).
 */

function walkAt(date: string, scheduledTime: string) {
  return { date, scheduledTime };
}

describe('mascot/mascotStage — deriveMascotStageForPendingWalk (time bucketing)', () => {
  const day = '2026-09-08';

  it('more than 15 minutes before the walk -> idle', () => {
    const now = new Date(2026, 8, 8, 17, 30);
    expect(deriveMascotStageForPendingWalk(walkAt(day, '18:00'), now)).toBe('idle');
  });

  it('exactly at the 15-minutes-before boundary -> excited (T-15 zone)', () => {
    const now = new Date(2026, 8, 8, 17, 45);
    expect(deriveMascotStageForPendingWalk(walkAt(day, '18:00'), now)).toBe('excited');
  });

  it('a few minutes before scheduled time -> excited', () => {
    const now = new Date(2026, 8, 8, 17, 55);
    expect(deriveMascotStageForPendingWalk(walkAt(day, '18:00'), now)).toBe('excited');
  });

  it('exactly at scheduled time -> ready', () => {
    const now = new Date(2026, 8, 8, 18, 0);
    expect(deriveMascotStageForPendingWalk(walkAt(day, '18:00'), now)).toBe('ready');
  });

  it('a few minutes after scheduled time (still within T+15) -> ready', () => {
    const now = new Date(2026, 8, 8, 18, 10);
    expect(deriveMascotStageForPendingWalk(walkAt(day, '18:00'), now)).toBe('ready');
  });

  it('just past T+15 -> waiting', () => {
    const now = new Date(2026, 8, 8, 18, 16);
    expect(deriveMascotStageForPendingWalk(walkAt(day, '18:00'), now)).toBe('waiting');
  });

  it('just before T+30 -> waiting', () => {
    const now = new Date(2026, 8, 8, 18, 29);
    expect(deriveMascotStageForPendingWalk(walkAt(day, '18:00'), now)).toBe('waiting');
  });

  it('at/past T+30 -> concerned', () => {
    expect(deriveMascotStageForPendingWalk(walkAt(day, '18:00'), new Date(2026, 8, 8, 18, 30))).toBe('concerned');
    expect(deriveMascotStageForPendingWalk(walkAt(day, '18:00'), new Date(2026, 8, 8, 19, 30))).toBe('concerned');
  });
});

describe('mascot/mascotStage — MASCOT_MOMENT_MAP / deriveMascotMoment (centralized C8 pairing)', () => {
  it('every mascot state used by the map is one of WalkieMascot.MASCOT_STATES — the pairing table never references a state the component doesn\'t implement', () => {
    for (const stage of Object.keys(MASCOT_MOMENT_MAP) as Array<keyof typeof MASCOT_MOMENT_MAP>) {
      expect(MASCOT_STATES).toContain(MASCOT_MOMENT_MAP[stage].mascotState);
    }
  });

  it('T-15/T/T+15/T+30/completed pairing matches the brief exactly: excited/ready/waiting/concerned/success', () => {
    expect(MASCOT_MOMENT_MAP.excited).toEqual({ mascotState: 'excited', messageCategory: 'excited' });
    expect(MASCOT_MOMENT_MAP.ready).toEqual({ mascotState: 'ready', messageCategory: 'ready' });
    expect(MASCOT_MOMENT_MAP.waiting).toEqual({ mascotState: 'waiting', messageCategory: 'waiting' });
    expect(MASCOT_MOMENT_MAP.concerned).toEqual({ mascotState: 'concerned', messageCategory: 'concerned' });
    expect(MASCOT_MOMENT_MAP.success).toEqual({ mascotState: 'success', messageCategory: 'success' });
  });

  it('deriveMascotMoment(null) -> idle (no walk to react to)', () => {
    const moment = deriveMascotMoment(null, new Date());
    expect(moment.stage).toBe('idle');
    expect(moment.mascotState).toBe('idle');
  });

  it('deriveMascotMoment ties the derived stage to the correct mascotState + messageCategory in one call', () => {
    const now = new Date(2026, 8, 8, 18, 40);
    const moment = deriveMascotMoment(walkAt('2026-09-08', '18:00'), now);
    expect(moment.stage).toBe('concerned');
    expect(moment.mascotState).toBe('concerned');
    expect(moment.messageCategory).toBe('concerned');
  });
});
