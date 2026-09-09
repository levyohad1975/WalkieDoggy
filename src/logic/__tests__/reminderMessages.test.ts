import {
  REMINDER_STAGES,
  REMINDER_STAGE_OFFSET_MINUTES,
  reminderUrgencyLevel,
  buildWalkReminderMessage,
  buildWalkAttentionEscalationMessage,
  type ReminderStage,
} from '../reminderMessages';

const BASE_INPUT = {
  dogName: 'טופי',
  responsibleName: 'אבא',
  scheduledTime: '17:00',
  varietySeed: 'walk-123',
};

describe('REMINDER_STAGES', () => {
  it('is exactly the four approved stages, in order, with matching offsets — never a fifth', () => {
    expect(REMINDER_STAGES).toEqual(['T-15', 'T', 'T+15', 'T+30']);
    expect(REMINDER_STAGE_OFFSET_MINUTES).toEqual({
      'T-15': -15,
      T: 0,
      'T+15': 15,
      'T+30': 30,
    });
  });
});

describe('reminderUrgencyLevel', () => {
  it('increases monotonically by stage', () => {
    const levels = REMINDER_STAGES.map(reminderUrgencyLevel);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    }
  });
});

describe('buildWalkReminderMessage', () => {
  it.each(REMINDER_STAGES)('returns a non-empty title/body for stage %s', (stage: ReminderStage) => {
    const msg = buildWalkReminderMessage({ ...BASE_INPUT, stage });
    expect(msg.title.length).toBeGreaterThan(0);
    expect(msg.body.length).toBeGreaterThan(0);
  });

  it('always mentions the dog name and the responsible member somewhere in the message', () => {
    for (const stage of REMINDER_STAGES) {
      const msg = buildWalkReminderMessage({ ...BASE_INPUT, stage });
      const text = `${msg.title} ${msg.body}`;
      expect(text).toContain('טופי');
      // Every stage's variants reference the responsible member by name.
      expect(text).toContain('אבא');
    }
  });

  it('is deterministic for the same input (same seed -> same variant every time)', () => {
    const a = buildWalkReminderMessage({ ...BASE_INPUT, stage: 'T' });
    const b = buildWalkReminderMessage({ ...BASE_INPUT, stage: 'T' });
    expect(a).toEqual(b);
  });

  it('can vary the phrase between different walks (different seeds), still within the same stage', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => `walk-${i}`);
    const bodies = new Set(
      seeds.map((varietySeed) => buildWalkReminderMessage({ ...BASE_INPUT, stage: 'T-15', varietySeed }).body)
    );
    // With only 2 variants and 12 seeds, both should show up at least once —
    // this isn't a strict requirement of the function, just confirms the
    // phrase pool for this stage actually has more than one member reachable.
    expect(bodies.size).toBeGreaterThan(1);
  });

  it('never guesses the dog gender when sex is unknown — no "הכלב"/"הכלבה", uses "יצא/ה" not a single guessed form', () => {
    for (const stage of REMINDER_STAGES) {
      const msg = buildWalkReminderMessage({ ...BASE_INPUT, stage, dogSex: undefined });
      const text = `${msg.title} ${msg.body}`;
      expect(text).not.toContain('הכלב ');
      expect(text).not.toContain('הכלבה ');
    }
  });

  it('uses the correct single gendered form once sex is known (male)', () => {
    const msg = buildWalkReminderMessage({ ...BASE_INPUT, stage: 'T+30', dogSex: 'male' });
    const text = `${msg.title} ${msg.body}`;
    expect(text).not.toContain('יצא/ה');
  });

  it('uses the correct single gendered form once sex is known (female)', () => {
    const msg = buildWalkReminderMessage({ ...BASE_INPUT, stage: 'T+30', dogSex: 'female' });
    const text = `${msg.title} ${msg.body}`;
    expect(text).not.toContain('יצא/ה');
  });

  it('escalates in urgency: T-15 is purely informational, T+30 carries an urgent marker', () => {
    const early = buildWalkReminderMessage({ ...BASE_INPUT, stage: 'T-15' });
    const late = buildWalkReminderMessage({ ...BASE_INPUT, stage: 'T+30' });
    expect(early.title).not.toContain('🚨');
    expect(late.title).toContain('🚨');
  });
});

describe('buildWalkAttentionEscalationMessage', () => {
  it('mentions both the dog and the responsible member, and reads as a status report, not an instruction', () => {
    const msg = buildWalkAttentionEscalationMessage(BASE_INPUT);
    const text = `${msg.title} ${msg.body}`;
    expect(text).toContain('טופי');
    expect(text).toContain('אבא');
    expect(msg.title).toContain('🚨');
  });

  it('is deterministic for the same input', () => {
    const a = buildWalkAttentionEscalationMessage(BASE_INPUT);
    const b = buildWalkAttentionEscalationMessage(BASE_INPUT);
    expect(a).toEqual(b);
  });

  it('produces a different message identity from the responsible member own T+30 reminder for the same walk', () => {
    const toResponsible = buildWalkReminderMessage({ ...BASE_INPUT, stage: 'T+30' });
    const toAdmin = buildWalkAttentionEscalationMessage(BASE_INPUT);
    expect(toAdmin).not.toEqual(toResponsible);
  });
});
