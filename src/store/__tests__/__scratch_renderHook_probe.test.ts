import { renderHook } from '@testing-library/react-native';
import { useEffectiveFamilyRole, useEffectiveUserId, useAuthStore } from '../authStore';

describe('scratch renderHook probe', () => {
  it('renders useEffectiveFamilyRole/useEffectiveUserId', () => {
    useAuthStore.setState({ familyRole: 'admin', currentUserId: 'u1', testModeUserId: null, impersonatingUserId: null });
    const role = renderHook(() => useEffectiveFamilyRole());
    const userId = renderHook(() => useEffectiveUserId());
    expect(role.result.current).toBe('admin');
    expect(userId.result.current).toBe('u1');
  });
});
