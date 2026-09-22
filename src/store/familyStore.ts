import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from './authStore';
import { create } from 'zustand';
import type { Dog, Family, FamilyUser, UserDeletionImpact } from '../types';
import { repository } from '../data';
import { generateId } from '../lib/id';
import { computeUserDeletionImpact, FamilyManagementError, planUserRemoval } from '../logic/familyManagement';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { resolveResponsibleForDate } from '../logic/rotation';
import { localDateOnly } from '../logic/dateFormat';
import { useScheduleStore } from './scheduleStore';
import { DEMO_DOG, DEMO_FAMILY } from '../data/demoData';
import { isSupabaseConfigured } from '../lib/supabase';
import { guardTestModeMutation, TEST_MODE_READ_ONLY_MESSAGE } from '../lib/testModeGuard';
import type { MemberPermissionOverride, PermissionKey, PermissionLoadStatus } from '../logic/permissions';
import { clearMemberPermissionOverride, listMemberPermissionOverrides, setMemberPermissionOverride } from '../lib/permissions';

// A device belongs to exactly one family (see authStore's FAMILY_ID_KEY) —
// so, like FAMILY_ID_KEY/CURRENT_USER_KEY, a single un-namespaced key is
// enough; re-selecting a dog after switching families is expected (the old
// id simply won't be found in the new family's `dogs` and load() falls back
// to the first dog — see load()'s selection resolution below).
const SELECTED_DOG_KEY = 'dog-walk-family:selected-dog-id';

interface FamilyState {
  family: Family | null;
  users: FamilyUser[];
  /** The currently SELECTED/active dog (see `selectedDogId`/`selectDog` below) — every dog-dependent screen (Home, new walk/rule creation, ...) reads this one. Not simply `dogs[0]`. */
  dog: Dog | null;
  /**
   * Every dog belonging to this family (Phase 1B: arbitrary N dogs
   * foundation — schedule_rules/schedule_entries/walks already carry their
   * own dog_id at the DB layer, see supabase/schema.sql).
   */
  dogs: Dog[];
  /** The id backing `dog` above. Kept alongside `dog` so a selector UI can compare against it directly without re-deriving it from `dog?.id`. */
  selectedDogId: string | null;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  /**
   * BATCH 3 (Task 3): every member-permission-override row this device can
   * see per RLS (0023) — its own rows, or, for a Family Admin, every row in
   * the family. Empty in local/demo mode (no Supabase, no concept of a
   * per-member override there — every local/demo member simply gets the
   * role default). Never read directly by screens; go through
   * logic/permissions.ts's resolveEffectivePermission()/canViewHistory()/
   * canViewStatistics() instead, so the "override, else role default" rule
   * only lives in one place.
   */
  permissionOverrides: MemberPermissionOverride[];
  /**
   * BATCH 3 CORRECTION #2 (post-review): whether `permissionOverrides`
   * above is currently a verified snapshot of the server's rows. Starts
   * 'idle', becomes 'loading' the instant loadPermissionOverrides() is
   * called, then 'loaded' or 'error'. This is what
   * logic/permissions.ts's canAccessHistoryScreen()/canAccessStatisticsScreen()
   * check to fail closed — previously nothing distinguished "override data
   * hasn't loaded yet" from "loaded, and there is no override", so a member
   * with an explicit denied override could transiently be treated as
   * allowed for as long as this hadn't resolved (or if it silently failed).
   * In local/demo mode this goes straight to 'loaded' (see
   * loadPermissionOverrides() below) — there is no server round-trip to
   * wait on and no per-member override concept there at all.
   */
  permissionOverridesStatus: PermissionLoadStatus;

  load: (familyId: string) => Promise<void>;
  /** Reload of permissionOverrides alone — called after load() and after every set/clear below. Never throws (a failure here must not block family/schedule data — every screen already falls back to the role default when override data hasn't loaded), but DOES record the outcome in permissionOverridesStatus ('loaded' or 'error') so a caller that needs to fail closed (History/Statistics — see logic/permissions.ts's canAccessHistoryScreen()/canAccessStatisticsScreen()) can tell "verified" apart from "unknown". */
  loadPermissionOverrides: () => Promise<void>;
  /** Family-Admin-only server-side (set_member_permission_override, 0023) — never trust a client-side admin check alone; the RPC re-verifies it. */
  setPermissionOverride: (userId: string, permissionKey: PermissionKey, allowed: boolean) => Promise<void>;
  /** Reverts one member/permission back to the role default. Family-Admin-only server-side (clear_member_permission_override, 0023). */
  clearPermissionOverride: (userId: string, permissionKey: PermissionKey) => Promise<void>;
  setReminderEnabled: (userId: string, enabled: boolean) => Promise<void>;
  /** PRD §9 gamification off-switch — same shape as setReminderEnabled. */
  setGamificationEnabled: (userId: string, enabled: boolean) => Promise<void>;
  saveDog: (dog: Dog) => Promise<void>;
  /** Makes `dogId` (must already be in `dogs`) the active dog and persists the choice locally so it survives an app restart. No-op if `dogId` isn't one of this family's dogs. */
  selectDog: (dogId: string) => Promise<void>;

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
  dogs: [],
  selectedDogId: null,
  loading: false,
  error: null,
  actionError: null,
  permissionOverrides: [],
  permissionOverridesStatus: 'idle',

  load: async (familyId: string) => {
    set({ loading: true, error: null });
    try {
      const [family, users, dogs] = await Promise.all([
        repository.getFamily(familyId),
        repository.getUsers(familyId),
        repository.getDogs(familyId),
      ]);
      // The dog must never be silently missing in local/demo mode: this is
      // the app's single seeded family, so if the repository came back with
      // no dogs for it (a stale cache from an earlier build, a not-yet-run
      // Supabase seed, etc.) fall back to the known demo dog rather than
      // leaving `dogs` empty with no way for the UI to recover on its own.
      // Some verified-family onboarding rows can exist before a dogs row is
      // readable/created. Keep the Family profile usable by synthesizing the
      // family's known dog identity, then persist it when the photo is saved.
      const familyDogName = (family as any)?.dogName ?? (family as any)?.dog_name;
      const resolvedDogs: Dog[] =
        dogs.length > 0
          ? dogs
          : familyDogName
            ? [{ id: `dog-${familyId}`, familyId, name: familyDogName, walksPerDay: 0 }]
            : !isSupabaseConfigured && familyId === DEMO_FAMILY.id
              ? [DEMO_DOG]
              : [];

      // Resolve which dog is ACTIVE: prefer the device's persisted choice
      // (e.g. a member switched to the family's second dog before closing
      // the app) as long as it still refers to one of this family's dogs —
      // a stale id (the dog was removed, or this is a different family than
      // the one that id was saved for) falls back to the first dog instead
      // of leaving `dog` pointing at nothing.
      let persistedSelectedId: string | null = null;
      try {
        persistedSelectedId = await AsyncStorage.getItem(SELECTED_DOG_KEY);
      } catch {
        /* best-effort — falls back to the first dog below */
      }
      const selectedDog =
        (persistedSelectedId && resolvedDogs.find((d) => d.id === persistedSelectedId)) || resolvedDogs[0] || null;
      if (selectedDog && selectedDog.id !== persistedSelectedId) {
        try {
          await AsyncStorage.setItem(SELECTED_DOG_KEY, selectedDog.id);
        } catch {
          /* best-effort */
        }
      }

      set({
        family: family ?? null,
        users,
        dog: selectedDog,
        dogs: resolvedDogs,
        selectedDogId: selectedDog?.id ?? null,
        loading: false,
      });

      // If an admin removed the profile THIS device is currently signed in
      // as (soft-deleted, see FamilyUser.removedAt), send it back to "pick
      // your profile" rather than letting it keep acting as a removed
      // member — it would otherwise still fully work (removal only strips
      // it from other people's active pickers), which isn't the intent.
      const auth = useAuthStore.getState();
      const signedInAsRemoved = auth.currentUserId && users.find((u) => u.id === auth.currentUserId)?.removedAt;
      if (signedInAsRemoved) void auth.signOut();

      // Best-effort — see loadPermissionOverrides's own doc comment for why
      // this never blocks or fails the family load itself.
      void get().loadPermissionOverrides();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'שגיאה בטעינת נתוני המשפחה', loading: false });
    }
  },

  loadPermissionOverrides: async () => {
    if (!isSupabaseConfigured) {
      // No per-member permission concept in local/demo mode at all — every
      // member simply gets the role default, and there is no server
      // round-trip to wait on, so this is immediately a VERIFIED 'loaded'
      // state (not 'idle'/'loading') rather than something a fail-closed
      // caller would ever need to block on.
      set({ permissionOverrides: [], permissionOverridesStatus: 'loaded' });
      return;
    }
    set({ permissionOverridesStatus: 'loading' });
    try {
      const permissionOverrides = await listMemberPermissionOverrides();
      set({ permissionOverrides, permissionOverridesStatus: 'loaded' });
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('loadPermissionOverrides failed (non-fatal):', e);
      }
      // permissionOverrides itself is deliberately left as whatever it was
      // (stale data, or still []) — permissionOverridesStatus alone is
      // what a fail-closed caller (canAccessHistoryScreen()/
      // canAccessStatisticsScreen()) must check before ever trusting it.
      set({ permissionOverridesStatus: 'error' });
    }
  },

  setPermissionOverride: async (userId: string, permissionKey: PermissionKey, allowed: boolean) => {
    if (!guardTestModeMutation()) return;
    try {
      await setMemberPermissionOverride(userId, permissionKey, allowed);
      await get().loadPermissionOverrides();
    } catch (e) {
      set({ actionError: friendlyErrorMessage(e, [], 'לא הצלחנו לעדכן את ההרשאה') });
      throw e;
    }
  },

  clearPermissionOverride: async (userId: string, permissionKey: PermissionKey) => {
    if (!guardTestModeMutation()) return;
    try {
      await clearMemberPermissionOverride(userId, permissionKey);
      await get().loadPermissionOverrides();
    } catch (e) {
      set({ actionError: friendlyErrorMessage(e, [], 'לא הצלחנו לאפס את ההרשאה') });
      throw e;
    }
  },

  setReminderEnabled: async (userId: string, enabled: boolean) => {
    if (!guardTestModeMutation()) return;
    const before = get().users.find((u) => u.id === userId);
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, remindersEnabled: enabled } : u)) }));
    try {
      await repository.updateUserReminderSetting(userId, enabled);
    } catch (e) {
      // Functional merge against CURRENT state, not a raw overwrite from the
      // pre-await `before` snapshot: a realtime reload (subscribeToFamilyChanges
      // watches `users`, see lib/realtime.ts) triggered by another family
      // member's unrelated concurrent edit can land on this device while this
      // RPC is in flight, and a raw `set({ users: prev, ... })` here would
      // silently discard that legitimate update along with reverting this
      // one field — same defect class as scheduleStore.swapTwoWalks's own
      // catch block, fixed for the same reason.
      set((s) => ({
        users: before ? s.users.map((u) => (u.id === userId ? { ...u, remindersEnabled: before.remindersEnabled } : u)) : s.users,
        error: 'לא הצלחנו לעדכן את הגדרות התזכורות',
      }));
    }
  },

  setGamificationEnabled: async (userId: string, enabled: boolean) => {
    if (!guardTestModeMutation()) return;
    const before = get().users.find((u) => u.id === userId);
    set((s) => ({ users: s.users.map((u) => (u.id === userId ? { ...u, gamificationEnabled: enabled } : u)) }));
    try {
      await repository.updateUserGamificationSetting(userId, enabled);
    } catch (e) {
      // Same functional-merge-against-current-state rollback as
      // setReminderEnabled above, for the same reason (a concurrent
      // realtime reload must not be clobbered by a stale pre-await
      // snapshot).
      set((s) => ({
        users: before ? s.users.map((u) => (u.id === userId ? { ...u, gamificationEnabled: before.gamificationEnabled } : u)) : s.users,
        error: 'לא הצלחנו לעדכן את הגדרת הגיימיפיקציה',
      }));
    }
  },

  saveDog: async (dog: Dog) => {
    if (!guardTestModeMutation()) return;
    // Upserts by id, so this doubles as "add a new dog" once a caller wants
    // more than one — see `dogs`'s doc comment above. Deliberately does NOT
    // change the selection on its own (a caller adding a brand-new dog
    // calls selectDog() explicitly afterwards) — editing the CURRENTLY
    // selected dog's photo/name must not silently reselect a different one.
    set((s) => {
      const idx = s.dogs.findIndex((d) => d.id === dog.id);
      const dogs = idx >= 0 ? s.dogs.map((d, i) => (i === idx ? dog : d)) : [...s.dogs, dog];
      // Nothing was selected yet (e.g. the family's very first dog) -> this
      // one becomes it, so `dog` is never left null after a successful save.
      const isSelected = s.selectedDogId === dog.id || s.selectedDogId === null;
      return isSelected ? { dog, dogs, selectedDogId: dog.id } : { dogs };
    });
    await repository.upsertDog(dog);
  },

  selectDog: async (dogId: string) => {
    const target = get().dogs.find((d) => d.id === dogId);
    if (!target) return;
    set({ dog: target, selectedDogId: dogId });
    try {
      await AsyncStorage.setItem(SELECTED_DOG_KEY, dogId);
    } catch {
      // best-effort persistence — the in-memory selection already applied
    }
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
      gamificationEnabled: true,
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
    const before = get().users.find((u) => u.id === user.id);
    set((s) => ({ users: s.users.map((u) => (u.id === user.id ? user : u)) }));
    try {
      await repository.upsertUser(user);
    } catch (e) {
      // Functional merge against CURRENT state — see setReminderEnabled's
      // catch block above for why a raw `set({ users: prev, ... })` from a
      // pre-await snapshot is unsafe here (a concurrent realtime reload of
      // an unrelated member could land mid-RPC and would otherwise be
      // silently discarded).
      set((s) => ({
        users: before ? s.users.map((u) => (u.id === user.id ? before : u)) : s.users,
        actionError: 'לא הצלחנו לעדכן את בן המשפחה',
      }));
    }
  },

  getUserDeletionImpact: (userId: string) => {
    const { rules, entries, walks } = useScheduleStore.getState();
    // Local calendar day, not UTC — see scheduleStore.ts's `today` doc
    // comment for why a UTC-anchored "today" is wrong here for anyone in a
    // timezone ahead of UTC (e.g. Israel) for a few hours after midnight.
    return computeUserDeletionImpact(userId, rules, entries, walks, localDateOnly(new Date()));
  },

  deleteUser: async (userId: string, replacementUserId: string | null) => {
    if (!guardTestModeMutation()) return;
    const { rules, entries, walks } = useScheduleStore.getState();
    try {
      const { updatedRules, updatedEntries, updatedWalks } = planUserRemoval(
        userId,
        replacementUserId,
        rules,
        entries,
        walks,
        localDateOnly(new Date()),
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
      // Functional merge against CURRENT state, not a raw overwrite from a
      // pre-await snapshot: `users` is a realtime-watched table (see
      // lib/realtime.ts's subscribeToFamilyChanges, wired in RootNavigator
      // to useFamilyStore.getState().load()) — a concurrent, unrelated edit
      // to another member landing on this device while
      // repository.deleteFamilyMember's RPC is in flight must survive this
      // update, not be silently discarded. Same defect class as
      // scheduleStore.swapTwoWalks's own catch block, fixed for the same
      // reason.
      const removedAt = new Date().toISOString();
      set((s) => ({
        users: s.users.map((u) => (u.id === userId ? { ...u, removedAt } : u)),
        actionError: null,
      }));
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
