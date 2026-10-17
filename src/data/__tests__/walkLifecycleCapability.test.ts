import {
  capabilityFromProbe,
  isMissingFunctionError,
  isMissingRelationError,
  isWalkLifecycleUnavailableError,
  persistWalkLifecycleCapability,
  readPersistedWalkLifecycleCapability,
  unavailableErrorFor,
  WalkLifecycleUnavailableError,
  WALK_LIFECYCLE_UNAVAILABLE_MARKER,
} from '../walkLifecycleCapability';

/**
 * P0 real-iPhone (2026-10-15): tapping Start returned PGRST202 for
 * public.start_walk_v11 because the deployed client assumed the v1.1 schema
 * existed. These pin the classification the version gate relies on.
 */
describe('walkLifecycleCapability', () => {
  it('recognises the exact real-iPhone PostgREST error as a missing function', () => {
    expect(isMissingFunctionError({
      code: 'PGRST202',
      message: 'Could not find the function public.start_walk_v11(p_actual_walker_id, p_expected_actor_id, p_operation_id, p_remote_start, p_substitution_confirmed, p_walk_id) in the schema cache',
      hint: 'Perhaps you meant to call the function public.start_walk',
    })).toBe(true);
    expect(isMissingFunctionError({ code: '42883', message: 'function public.x() does not exist' })).toBe(true);
    expect(isMissingFunctionError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingFunctionError(new Error('Failed to fetch'))).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });

  it('recognises a missing v1.1 table separately from other read failures', () => {
    expect(isMissingRelationError({ code: 'PGRST205', message: "Could not find the table 'public.walk_gps_ownership' in the schema cache" })).toBe(true);
    expect(isMissingRelationError({ code: '42P01', message: 'relation "public.walk_gps_ownership" does not exist' })).toBe(true);
    expect(isMissingRelationError({ code: '42501', message: 'permission denied for table walk_gps_ownership' })).toBe(false);
  });

  it('accepts only an exact v1.1 answer with nothing missing as supported', () => {
    expect(capabilityFromProbe({ lifecycle_version: '1.1', missing: [] }, 't').status).toBe('supported');
    expect(capabilityFromProbe({ lifecycle_version: '1.1', missing: ['function:public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean)'] }, 't'))
      .toEqual({ status: 'incomplete', checkedAt: 't', missing: ['function:public.start_walk_v11(uuid,uuid,uuid,uuid,boolean,boolean)'] });
    expect(capabilityFromProbe({ lifecycle_version: '1.0', missing: [] }, 't').status).toBe('incomplete');
    expect(capabilityFromProbe(null, 't').status).toBe('incomplete');
    expect(capabilityFromProbe({ lifecycle_version: '1.1' }, 't').status).toBe('incomplete');
  });

  it('turns every non-supported answer into the explicit, user-mappable error', () => {
    expect(unavailableErrorFor({ status: 'supported', checkedAt: 't' })).toBeNull();
    const notInstalled = unavailableErrorFor({ status: 'not_installed', checkedAt: 't' });
    expect(notInstalled?.message).toContain(WALK_LIFECYCLE_UNAVAILABLE_MARKER);
    expect(isWalkLifecycleUnavailableError(notInstalled)).toBe(true);
    const incomplete = unavailableErrorFor({ status: 'incomplete', checkedAt: 't', missing: ['execute:a', 'table:b'] });
    expect(incomplete?.reason).toBe('incomplete');
    expect(incomplete?.message).toContain('execute:a');
    expect(isWalkLifecycleUnavailableError(new Error(WALK_LIFECYCLE_UNAVAILABLE_MARKER))).toBe(false);
    expect(isWalkLifecycleUnavailableError(new WalkLifecycleUnavailableError('missing_rpc', 'start_walk_v11'))).toBe(true);
  });

  it('persists and restores the last answer for the offline path, ignoring corrupt storage', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    expect(await readPersistedWalkLifecycleCapability()).toBeNull();
    await persistWalkLifecycleCapability({ status: 'supported', checkedAt: '2026-10-15T00:00:00.000Z' });
    expect(await readPersistedWalkLifecycleCapability()).toEqual({ status: 'supported', checkedAt: '2026-10-15T00:00:00.000Z' });
    await AsyncStorage.setItem('@walkie/walk-lifecycle-capability-v1', '{not json');
    expect(await readPersistedWalkLifecycleCapability()).toBeNull();
    await AsyncStorage.setItem('@walkie/walk-lifecycle-capability-v1', JSON.stringify({ status: 'bogus', checkedAt: 'x' }));
    expect(await readPersistedWalkLifecycleCapability()).toBeNull();
  });
});
