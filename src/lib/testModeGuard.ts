import { Alert } from 'react-native';
import { useAuthStore } from '../store/authStore';

export const TEST_MODE_READ_ONLY_MESSAGE =
  'מצב בדיקה הוא לצפייה בלבד — לא ניתן לבצע פעולות שמשנות נתונים בזמן שמדמים משתמש אחר.';

/**
 * The single choke point for "Admin Test Mode is read-only" (requirement 1).
 * Every store action that writes anything — scheduleStore, familyStore,
 * requestsStore — calls this as its very first line, so the block is
 * enforced once, centrally, regardless of which screen or button reaches
 * the action. This is deliberately at the STORE layer rather than
 * scattered across screen-level onPress handlers: a screen might hide a
 * button while simulating a member, but the earlier Home-only wiring
 * proved that's easy to miss for a button added later (the swap/time-
 * change request buttons shipped without this guard) — enforcing it in the
 * store makes it structurally impossible to reach a real mutation/RPC
 * while `testModeUserId` is set, from ANY current or future call site.
 *
 * Returns true if it's safe to proceed. Returns false (after showing the
 * "מצב בדיקה הוא לצפייה בלבד" alert) if Test Mode is currently active and
 * blocking this action. Silent (no repeated alerts) is deliberately NOT the
 * choice here — the person needs to understand why nothing happened.
 */
export function guardTestModeMutation(): boolean {
  if (useAuthStore.getState().testModeUserId) {
    Alert.alert('מצב בדיקה', TEST_MODE_READ_ONLY_MESSAGE);
    return false;
  }
  return true;
}
