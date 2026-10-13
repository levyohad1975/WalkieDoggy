import { renderHook } from '@testing-library/react-native';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../authStore';

/**
 * useEffectiveFamilyRole()/useEffectiveUserId() — the shared selectors every
 * member-facing screen (Home, Schedule, Family, Settings) reads instead of
 * each re-deriving `testModeUserId ? 'member' : familyRole` /
 * `testModeUserId ?? currentUserId` independently (see their own doc
 * comments in authStore.ts for why that inconsistency was a real bug).
 * Exercised via renderHook (@testing-library/react-native) since both are
 * real zustand-subscribing hooks, not plain functions.
 *
 * Deliberately a separate file from authStore.test.ts: that file calls
 * `jest.resetModules()` throughout (to reset env vars / re-mock Supabase per
 * test), which re-requires `react` as a fresh module instance mid-suite —
 * breaking react-test-renderer/@testing-library's own already-captured React
 * singleton (`TypeError: Cannot read properties of null (reading 'useRef')`,
 * the classic "two copies of React" symptom) for any renderHook() call that
 * happens anywhere after the first resetModules() in that file. This file
 * never calls resetModules(), so React stays a single, consistent instance
 * throughout.
 */
describe('useEffectiveFamilyRole / useEffectiveUserId', () => {
  it('useEffectiveFamilyRole: returns the real familyRole when neither Test Mode nor real impersonation is active', () => {
    useAuthStore.setState({ familyRole: 'admin', testModeUserId: null, impersonatingUserId: null });

    const { result } = renderHook(() => useEffectiveFamilyRole());

    expect(result.current).toBe('admin');
  });

  it('useEffectiveFamilyRole: returns "member" while Admin Test Mode is simulating a member, regardless of the real familyRole', () => {
    useAuthStore.setState({ familyRole: 'admin', testModeUserId: 'member-1', impersonatingUserId: null });

    const { result } = renderHook(() => useEffectiveFamilyRole());

    expect(result.current).toBe('member');
  });

  it('useEffectiveFamilyRole: returns "member" while a REAL impersonation session is active', () => {
    useAuthStore.setState({ familyRole: 'admin', testModeUserId: null, impersonatingUserId: 'member-1' });

    const { result } = renderHook(() => useEffectiveFamilyRole());

    expect(result.current).toBe('member');
  });

  it('useEffectiveUserId: returns the real currentUserId when neither Test Mode nor real impersonation is active', () => {
    useAuthStore.setState({ currentUserId: 'real-admin-id', testModeUserId: null, impersonatingUserId: null });

    const { result } = renderHook(() => useEffectiveUserId());

    expect(result.current).toBe('real-admin-id');
  });

  it('useEffectiveUserId: returns the simulated member id while Admin Test Mode is active', () => {
    useAuthStore.setState({ currentUserId: 'real-admin-id', testModeUserId: 'member-1', impersonatingUserId: null });

    const { result } = renderHook(() => useEffectiveUserId());

    expect(result.current).toBe('member-1');
  });

  it('useEffectiveUserId: prefers the impersonated member id over testModeUserId during real impersonation (the two are mutually exclusive in practice)', () => {
    useAuthStore.setState({ currentUserId: 'real-admin-id', testModeUserId: null, impersonatingUserId: 'member-2' });

    const { result } = renderHook(() => useEffectiveUserId());

    expect(result.current).toBe('member-2');
  });
});
