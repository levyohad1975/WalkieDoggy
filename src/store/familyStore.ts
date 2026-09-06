import { useAuthStore } from './authStore';
import { create } from 'zustand';
import type { Dog, Family, FamilyUser, UserDeletionImpact } from '../types';
import { repository } from '../data';
import { generateId } from '../lib/id';
import { computeUserDeletionImpact, FamilyManagementError, planUserRemoval } from '../logic/familyManagement';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { resolveResponsibleForDate, toDateOnly } from '../logic/rotation';
import { useScheduleStore } from './scheduleStore';
import { DEMO_DOG, DEMO_FAMILY } from '../data/demoData';
import { isSupabaseConfigured } from '../lib/supabase';
import { guardTestModeMutation, TEST_MODE_READ_ONLY_MESSAGE } from '../lib/testModeGuard';

interface FamilyState {
  family: Family | null;
  users: FamilyUser[];
  dog: Dog | null;
  loading: boolean;
  error: string | null;
  actionError: string | null;

  load: (familyId: string) => Promise<void>;
  setReminderEnabled: (userId: string, enabled: boolean) => Promise<void>;
  saveDog: (dog: Dog) => Promise<void>;

  addUser: (input: { name: string; avatar: string; color: string; photoUrl?: string }) => Promise<FamilyUser>;
  updateUser: (user: FamilyUser) => Promise<void>;
  getUserDeletionImpact: (userId: string) => UserDeletionImpact;
  /** Pass a replacementUserId to hand this person's future turns to someone else; pass null to just drop them from each rotation (requires at least one person left in it). */
  deleteUser: (userId: string, replacementUserId: string | null) => Promise<void>;
  clearActionError: () => void;
}

export const useFamilyStore = create<FamilyState>((set, get) => ({
  family: null,
  users: [],
  dog: null,
  loading: false,
  error: null,
  actionError: null,

  load: async (familyId: string) => {
    set({ loading: true, error: null });
    try {
      const [family, users, dog] = await Promise.all([
        repository.getFamily(familyId),
        repository.getUsers(familyId),
        repository.getDog(familyId),
      ]);
      // The dog must never be silently missing in local/demo mode: this is
      // the app's single seeded family, so if the repository came back with
      // no dog for it (a stale cache from an earlier build, a not-yet-run
      // Supabase seed, etc.) fall back to the known demo dog rather than
      // leaving `dog` null with no way for the UI to recover on its own.
      const resolvedDog = dog ?? (!isSupabaseConfigured && familyId === DEMO_FAMILY.id ? DEMO_DOG : undefined);
      set({ family: family ?? null, users, dog: resolvedDog ?? null, loading: false });

      // If an admin removed the profile THIS device is currently signed in
      // as (soft-deleted, see FamilyUser.removedAt), send it back to "pick
      // your profile" rather than letting it keep acting as a removed
      // member — it would otherwise still fully work (removal only strips
      // it from other people's active pickers), which isn't the intent.
      const auth = useAuthStore.getState();
      const signedInAsRemoved = auth.currentUserId && users.find((u) => u.id === auth.currentUserId)?.removedAt;
      if (signedInAsRemoved) void auth.signOut();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'שגיאה בטעינת נתוני המשפחה', loading: false });
    }
  },

  setReminderEnabled: async (userId: string, enabled: boolean) => {
    if (!guardTestModeMutation()) return;
    const prev = get().users;
    set({ users: prev.map((u) => (u.id === userId ? { ...u, remindersEnabled: enabled } : u)) });
    try {
      await repository.updateUserReminderSetting(userId, enabled);
    } catch (e) {
      set({ users: prev, error: 'לא הצלחנו לעדכן את הגדרות התזכורות' });
    }
  },

  saveDog: async (dog: Dog) => {
    if (!guardTestModeMutation()) return;
    set({ dog });
    await repository.upsertDog(dog);
  },

  addUser: async ({ name, avatar, color, photoUrl }) => {
    if (!guardTestModeMutation()) throw new Error(TEST_MODE_READ_ONLY_MESSAGE);
    // Falls back to the app's single demo family id when `family` hasn't
    // loaded yet (e.g. a corrupt/mismatched local cache, or this is called
    // before `load()` resolved) — this is what's added first from the
    // "first run, no family members yet" screen, so it must never bail out
    // just because `family` is still null.
    const loadedFamilyId = get().family?.id;
const joinedFamilyId = useAuthStore.getState().familyId;

const familyId =
  loadedFamilyId ??
  (isSupabaseConfigured ? joinedFamilyId : DEMO_FAMILY.id);

if (!familyId) {
  const message = 'לא נמצאה משפחה פעילה';
  set({ actionError: message });
  throw new Error(message);
}
    const user: FamilyUser = {
      id: generateId('user'),
      familyId,
      name: name.trim(),
      avatar,
      photoUrl,
      color,
      remindersEnabled: true,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ users: [...s.users, user] }));
    try {
  // QA pass v3, issue 1: a brand-new row must go through the INSERT-only
  // (admin-authorized) path — see Repository.createUser's doc comment.
  await repository.createUser(user);
  return user;
} catch (e) {
  set((s) => ({
    users: s.users.filter((u) => u.id !== user.id),
    actionError: 'לא הצלחנו להוסיף את בן המשפחה',
  }));
  throw e;
}
  },

  updateUser: async (user: FamilyUser) => {
    if (!guardTestModeMutation()) return;
    const prev = get().users;
    set({ users: prev.map((u) => (u.id === user.id ? user : u)) });
    try {
      await repository.upsertUser(user);
    } catch (e) {
      set({ users: prev, actionError: 'לא הצלחנו לעדכן את בן המשפחה' });
    }
  },

  getUserDeletionImpact: (userId: string) => {
    const { rules, entries } = useScheduleStore.getState();
    return computeUserDeletionImpact(userId, rules, entries, toDateOnly(new Date()));
  },

  deleteUser: async (userId: string, replacementUserId: string | null) => {
    if (!guardTestModeMutation()) return;
    const prevUsers = get().users;
    const { rules, entries, walks } = useScheduleStore.getState();
    try {
      const { updatedRules, updatedEntries, updatedWalks } = planUserRemoval(
        userId,
        replacementUserId,
        rules,
        entries,
        walks,
        toDateOnly(new Date()),
        resolveResponsibleForDate
      );

      // Admin-only, atomic operation: see Repository.deleteFamilyMember's
      // doc comment — in Supabase mode this is a single SECURITY DEFINER
      // RPC call that re-checks server-side that the caller is actually an
      // admin, so a Member can never reach this even by calling the client
      // API directly (the UI hiding this action for Members is a
      // convenience, not the security boundary).
      await repository.deleteFamilyMember({ userId, updatedRules, updatedEntries, updatedWalks });

      // Soft-delete, not a removal from `users`: the row (and their real
      // name/avatar) must keep resolving everywhere history is shown — see
      // FamilyUser.removedAt's doc comment. FamilyScreen/SettingsScreen/
      // RuleFormModal/EditWalkModal filter removedAt out of their own
      // active-member pickers instead.
      const removedAt = new Date().toISOString();
      set({
        users: prevUsers.map((u) => (u.id === userId ? { ...u, removedAt } : u)),
        actionError: null,
      });
      useScheduleStore.setState((s) => ({
        rules: s.rules.map((r) => updatedRules.find((ur) => ur.id === r.id) ?? r),
        entries: s.entries.map((e) => updatedEntries.find((ue) => ue.id === e.id) ?? e),
        walks: s.walks.map((w) => updatedWalks.find((uw) => uw.id === w.id) ?? w),
      }));
    } catch (e) {
      // FamilyManagementError is a CLIENT-side planning rejection (computed
      // by planUserRemoval() before any RPC call — e.g. "no one left to
      // reassign this rotation to") and already carries a friendly Hebrew
      // message of its own. Anything else here is a SERVER-side rejection
      // from admin_delete_family_member() (0004/0007) — most notably 0007's
      // last-admin-removal guard ("cannot remove the last admin of this
      // family") — which must go through the shared Hebrew mapping rather
      // than a single generic fallback string, or that specific rejection
      // would be indistinguishable from any other failure (Part 3/1E).
      set({
        actionError:
          e instanceof FamilyManagementError ? e.message : friendlyErrorMessage(e, [], 'לא הצלחנו למחוק את בן המשפחה'),
      });
    }
  },

  clearActionError: () => set({ actionError: null }),
}));
