import { minutesUntilWalk, reminderPromptTemplate, REMINDER_PROMPT_DUE_TEMPLATE } from '../reminderPromptMessage';

/**
 * Real-iPhone QA regression: at 18:25 the mascot said "הגיע הזמן לטייל" for
 * a walk scheduled at 18:40 (a T-15 reminder). T-15 copy must say the walk
 * starts in 15 minutes.
 */
describe('reminderPromptTemplate — in-app mascot copy for a tapped walk reminder', () => {
  const at = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00`);

  it('T-15 tapped at 18:25 for an 18:40 walk says it starts in 15 minutes, not that it is time to go', () => {
    const text = reminderPromptTemplate('T-15', '2026-10-08', '18:40', at('18:25'));
    expect(text).toBe('{responsibleName}, הטיול עם {dogNoun} מתחיל בעוד 15 דקות 🐾');
    expect(text).not.toContain('הגיע הזמן');
  });

  it('T-15 tapped a little later counts down the real remaining minutes', () => {
    expect(reminderPromptTemplate('T-15', '2026-10-08', '18:40', at('18:33'))).toContain('מתחיל בעוד 7 דקות');
    expect(reminderPromptTemplate('T-15', '2026-10-08', '18:40', at('18:39'))).toContain('מתחיל בעוד דקה');
  });

  it('rounds a partial minute up, so 14m30s left still reads as 15', () => {
    expect(minutesUntilWalk('2026-10-08', '18:40', new Date('2026-10-08T18:25:30'))).toBe(15);
  });

  it('a T-15 notification tapped after the start time falls back to the due copy', () => {
    expect(reminderPromptTemplate('T-15', '2026-10-08', '18:40', at('18:40'))).toBe(REMINDER_PROMPT_DUE_TEMPLATE);
    expect(reminderPromptTemplate('T-15', '2026-10-08', '18:40', at('18:55'))).toBe(REMINDER_PROMPT_DUE_TEMPLATE);
  });

  it('T-15 with an unparseable time still says 15 minutes (the stage itself)', () => {
    expect(reminderPromptTemplate('T-15', 'bad', 'bad', at('18:25'))).toContain('מתחיל בעוד 15 דקות');
  });

  it('only the due stage says "הגיע הזמן"', () => {
    expect(reminderPromptTemplate('T', '2026-10-08', '18:40', at('18:40'))).toBe(REMINDER_PROMPT_DUE_TEMPLATE);
    expect(REMINDER_PROMPT_DUE_TEMPLATE).toContain('הגיע הזמן לטייל');
    expect(reminderPromptTemplate('T+15', '2026-10-08', '18:40', at('18:55'))).not.toContain('הגיע הזמן');
    expect(reminderPromptTemplate('T+30', '2026-10-08', '18:40', at('19:10'))).not.toContain('הגיע הזמן');
  });

  it('overdue stages say the dog is still waiting / waiting half an hour', () => {
    expect(reminderPromptTemplate('T+15', '2026-10-08', '18:40', at('18:55'))).toContain('עדיין מחכה לטיול');
    expect(reminderPromptTemplate('T+30', '2026-10-08', '18:40', at('19:10'))).toContain('חצי שעה');
  });

  it('every stage keeps the placeholders Home fills in, and never a dog-face emoji', () => {
    for (const kind of ['T-15', 'T', 'T+15', 'T+30'] as const) {
      const text = reminderPromptTemplate(kind, '2026-10-08', '18:40', at('18:25'));
      expect(text).toContain('{responsibleName}');
      expect(text).toContain('{dogNoun}');
      expect(text).not.toMatch(/[\u{1F436}\u{1F415}\u{1F9AE}\u{1F429}]/u);
    }
  });
});
