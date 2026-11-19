import { taskTypeLabel } from '../HealthGroomingModal';
import type { HealthTask } from '../../types';

/**
 * Field report 2026-11-06: a vet appointment appeared as a grooming one. The
 * record was correct (category 'vet_visit'), but the list showed only the title
 * — and this one's purpose was "אחר: תספורת" (other → free text "תספורת"), which
 * reads like a haircut, with no "וטרינר" shown anywhere. taskTypeLabel now
 * surfaces the category for the two current appointment categories.
 */
const task = (category: HealthTask['category'], title: string): HealthTask =>
  ({ category, title } as HealthTask);

describe('taskTypeLabel — vet appointments are distinguishable from grooming', () => {
  it('labels any vet appointment "וטרינר", whatever its purpose text', () => {
    expect(taskTypeLabel(task('vet_visit', 'אחר: תספורת'))).toBe('וטרינר');
    expect(taskTypeLabel(task('vet_visit', 'בדיקה · חיסון כלבת'))).toBe('וטרינר');
    expect(taskTypeLabel(task('vet_visit', ''))).toBe('וטרינר');
  });

  it('labels grooming "תספורת" — equal to its title, so the caller drops the redundant line', () => {
    expect(taskTypeLabel(task('grooming', 'תספורת'))).toBe('תספורת');
  });

  it('keeps the explicit title for legacy categories (no contradictory subtitle)', () => {
    expect(taskTypeLabel(task('weight', 'שקילה חודשית'))).toBe('שקילה חודשית');
    expect(taskTypeLabel(task('vaccination', ''))).toBe('חיסונים');
  });
});
