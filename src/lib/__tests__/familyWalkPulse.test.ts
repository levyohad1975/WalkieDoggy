/**
 * Field report 2026-11-12: a walk started on Android reached the admin's
 * iPhone minutes late. Home now polls one row while it is in front and
 * reloads everything when the app returns to the front.
 */
import fs from 'fs';
import path from 'path';

const mockQuery: Record<string, jest.Mock> = {};
const mockFrom = jest.fn();
jest.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { fetchLatestFamilyWalkChange } from '../familyWalkPulse';

function chain(result: { data: unknown; error: unknown }) {
  for (const name of ['select', 'eq', 'order', 'limit']) mockQuery[name] = jest.fn(() => builder);
  mockQuery.maybeSingle = jest.fn(async () => result);
  const builder = mockQuery;
  mockFrom.mockReturnValue(builder);
}

describe('fetchLatestFamilyWalkChange', () => {
  it("reads only the family's most recent walk change", async () => {
    chain({ data: { updated_at: '2026-11-12T11:04:09Z' }, error: null });
    await expect(fetchLatestFamilyWalkChange('fam')).resolves.toBe('2026-11-12T11:04:09Z');
    expect(mockFrom).toHaveBeenCalledWith('walks');
    expect(mockQuery.select).toHaveBeenCalledWith('updated_at');
    expect(mockQuery.eq).toHaveBeenCalledWith('family_id', 'fam');
    expect(mockQuery.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(mockQuery.limit).toHaveBeenCalledWith(1);
  });

  it('returns null when offline or empty', async () => {
    chain({ data: null, error: { message: 'offline' } });
    await expect(fetchLatestFamilyWalkChange('fam')).resolves.toBeNull();
    chain({ data: null, error: null });
    await expect(fetchLatestFamilyWalkChange('fam')).resolves.toBeNull();
  });
});

describe('Home wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../screens/HomeScreen.tsx'), 'utf8');
  const start = src.indexOf('Field report 2026-11-12: a walk started on another phone');
  const block = src.slice(start, start + 2200);

  it('polls while Home is focused and reloads the schedule when the latest change moves', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('useFocusEffect(');
    expect(block).toContain('setInterval(() => { void pulse(); }, FAMILY_WALK_PULSE_MS)');
    expect(block).toMatch(/lastSeen !== null && latest !== lastSeen\) await useScheduleStore\.getState\(\)\.load\(familyId\)/);
    expect(block).toContain("AppState.currentState !== 'active'");
  });

  it('reloads family, schedule and requests when the app returns to the front', () => {
    expect(block).toMatch(/AppState\.addEventListener\('change'[\s\S]*loadFamily\(familyId\)[\s\S]*loadSchedule\(familyId\)[\s\S]*loadRequests\(\)/);
    expect(block).toContain('clearInterval(interval); sub.remove();');
  });
});
