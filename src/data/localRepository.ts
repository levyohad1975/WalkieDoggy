import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  AchievementUnlock,
  Dog,
  Family,
  FamilyUser,
  HealthTask,
  NotificationSetting,
  ScheduleEntry,
  ScheduleRule,
  Walk,
  WalkGpsSession,
} from '../types';
import { defaultNotificationSetting } from '../logic/reminders';
import type { DeleteFamilyMemberPayload, Repository } from './repository';
import {
  DEMO_DOG,
  DEMO_ENTRIES,
  DEMO_FAMILY,
  DEMO_RULES,
  DEMO_USERS,
  DEMO_WALKS,
} from './demoData';

// Bumped from v1 -> v2: earlier builds could leave a cached store on-device
// whose seeded family/user ids don't match the current demoData.ts (e.g.
// after this update renamed the demo family/users). A stale cache like that
// silently resolves to an empty `users` array for the current family id,
// which dead-ended the "pick your profile" screen with no way forward. A
// version bump makes any such stale cache get re-seeded from scratch instead
// of read as-is.
// Bumped from v2 -> v3: the single `dog: Dog` slot became `dogs: Dog[]`
// (arbitrary-N multi-dog foundation) — an old cache's `dog` field would
// otherwise be read as `undefined` under the new shape and crash the first
// `.filter()`/`.find()` call against `dogs`.
const STORAGE_KEY = 'dog-walk-family:v3';

interface LocalStoreShape {
  family: Family;
  users: FamilyUser[];
  dogs: Dog[];
  rules: ScheduleRule[];
  entries: ScheduleEntry[];
  walks: Walk[];
  healthTasks: HealthTask[];
  gpsSessions: WalkGpsSession[];
  achievementUnlocks: AchievementUnlock[];
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function seedStore(): LocalStoreShape {
  return {
    family: DEMO_FAMILY,
    users: DEMO_USERS,
    dogs: [DEMO_DOG],
    rules: DEMO_RULES,
    entries: DEMO_ENTRIES,
    walks: DEMO_WALKS,
    healthTasks: [],
    gpsSessions: [],
    achievementUnlocks: [],
  };
}

/**
 * AsyncStorage-backed repository. This is the app's local cache/source of
 * truth for "usable offline": reads always resolve instantly from disk, and
 * writes land here immediately (the sync queue then pushes them to Supabase
 * in the background — see offlineFirstRepository.ts).
 *
 * It is also used standalone as the "demo mode" backend when no Supabase
 * project is configured (see lib/supabase.ts), and in unit tests via an
 * in-memory AsyncStorage mock.
 */
export class LocalRepository implements Repository {
  private cache: LocalStoreShape | null = null;

  private async load(): Promise<LocalStoreShape> {
    if (this.cache) return this.cache;
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (safeJsonParse(raw) as LocalStoreShape | null) : null;
    // Defensive re-seed: a missing/corrupt/malformed cache (bad JSON, wrong
    // shape from an older app version, etc.) must never leave the app with
    // no family/users to show — that's a dead end on the "pick your
    // profile" screen with no way to recover. Fall back to fresh demo data.
    // This must check EVERY array field, not just `users`: a cache that
    // passed an older, narrower check but had `rules`/`entries`/`walks`
    // missing or corrupt would otherwise be accepted as "valid" here and
    // then throw on the first `.filter(...)` call against it — which
    // surfaces to the screen as a silently-empty schedule (0 rules, 0
    // entries), not as a visible error.
    // A dog whose familyId doesn't match the cached family's id is exactly
    // the kind of stale/mismatched leftover an earlier dev build could have
    // written (see the STORAGE_KEY bump above) — `getDog()`/`getDogs()`
    // would silently return nothing forever for the current family, even
    // though the cache otherwise "looks" valid. Treat that as corrupt too.
    // An empty `dogs` array is valid (no dog added yet) — only a MISMATCHED
    // one is corrupt.
    const dogsMatchFamily = Boolean(
      parsed && parsed.family && Array.isArray(parsed.dogs) && parsed.dogs.every((d) => d && d.familyId === parsed.family.id)
    );
    if (
      parsed &&
      parsed.family &&
      Array.isArray(parsed.users) &&
      dogsMatchFamily &&
      Array.isArray(parsed.rules) &&
      Array.isArray(parsed.entries) &&
      Array.isArray(parsed.walks)
    ) {
      this.cache = parsed;
      // Soft-add, not a corrupt-cache trigger: a cache written before
      // health_tasks existed simply won't have this field yet. Unlike the
      // v2->v3 `dog`->`dogs` change, there's no old value to reinterpret
      // here, so there's nothing to lose by defaulting it in place instead
      // of forcing every existing device to re-seed its whole family/
      // schedule/walk cache just to gain one new empty array.
      if (!Array.isArray(this.cache.healthTasks)) this.cache.healthTasks = [];
      // Same soft-add as healthTasks above — a cache written before GPS
      // sessions existed just gains an empty array here.
      if (!Array.isArray(this.cache.gpsSessions)) this.cache.gpsSessions = [];
      // Same soft-add — a cache written before gamification existed just
      // gains an empty unlock ledger and each user defaults to opted-in
      // (matching 0052's `default true` for the same column server-side).
      if (!Array.isArray(this.cache.achievementUnlocks)) this.cache.achievementUnlocks = [];
      this.cache.users = this.cache.users.map((u) =>
        typeof u.gamificationEnabled === 'boolean' ? u : { ...u, gamificationEnabled: true }
      );
    } else {
      this.cache = seedStore();
      await this.persist();
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
  }

  async replaceAll(store: LocalStoreShape): Promise<void> {
    this.cache = store;
    await this.persist();
  }

  async getFamily(familyId: string): Promise<Family | undefined> {
    const s = await this.load();
    return s.family.id === familyId ? s.family : undefined;
  }

  async getUsers(familyId: string): Promise<FamilyUser[]> {
    const s = await this.load();
    return s.users.filter((u) => u.familyId === familyId);
  }

  /**
   * Local/demo mode has no RLS to split against (see Repository.createUser's
   * doc comment for why Supabase mode needs a separate method) — this is
   * just an alias for the same upsert-into-array behavior as `upsertUser`
   * below, kept as a distinct method only to satisfy the Repository
   * interface so callers (familyStore.addUser) don't need a mode-specific
   * branch.
   */
  async createUser(user: FamilyUser): Promise<void> {
    await this.upsertUser(user);
  }

  async upsertUser(user: FamilyUser): Promise<void> {
    const s = await this.load();
    const idx = s.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) s.users[idx] = user;
    else s.users.push(user);
    await this.persist();
  }

  async deleteUser(userId: string): Promise<void> {
    const s = await this.load();
    s.users = s.users.filter((u) => u.id !== userId);
    await this.persist();
  }

  /**
   * Local/demo mode: single device, so just apply the same writes in order
   * — see the Repository interface doc comment for why Supabase mode needs
   * an atomic RPC instead. Soft-deletes (sets `removedAt`) rather than
   * removing the user row, for the same reason Supabase mode does: history
   * (past schedule_entries, completed walks) still needs to resolve this
   * person's name/avatar, and planUserRemoval() deliberately never touches
   * that history to begin with.
   */
  async deleteFamilyMember({ userId, updatedRules, updatedEntries, updatedWalks }: DeleteFamilyMemberPayload): Promise<void> {
    const s = await this.load();
    for (const rule of updatedRules) {
      const idx = s.rules.findIndex((r) => r.id === rule.id);
      if (idx >= 0) s.rules[idx] = rule;
    }
    for (const entry of updatedEntries) {
      const idx = s.entries.findIndex((e) => e.id === entry.id);
      if (idx >= 0) s.entries[idx] = entry;
    }
    for (const walk of updatedWalks) {
      const idx = s.walks.findIndex((w) => w.id === walk.id);
      if (idx >= 0) s.walks[idx] = walk;
    }
    const userIdx = s.users.findIndex((u) => u.id === userId);
    if (userIdx >= 0) s.users[userIdx] = { ...s.users[userIdx], removedAt: new Date().toISOString() };
    await this.persist();
  }

  async updateUserReminderSetting(userId: string, enabled: boolean): Promise<void> {
    const s = await this.load();
    s.users = s.users.map((u) => (u.id === userId ? { ...u, remindersEnabled: enabled } : u));
    await this.persist();
  }

  async updateUserGamificationSetting(userId: string, enabled: boolean): Promise<void> {
    const s = await this.load();
    s.users = s.users.map((u) => (u.id === userId ? { ...u, gamificationEnabled: enabled } : u));
    await this.persist();
  }

  async getDog(familyId: string): Promise<Dog | undefined> {
    const s = await this.load();
    return s.dogs.find((d) => d.familyId === familyId);
  }

  async getDogs(familyId: string): Promise<Dog[]> {
    const s = await this.load();
    return s.dogs.filter((d) => d.familyId === familyId);
  }

  async upsertDog(dog: Dog): Promise<void> {
    const s = await this.load();
    const idx = s.dogs.findIndex((d) => d.id === dog.id);
    if (idx >= 0) s.dogs[idx] = dog;
    else s.dogs.push(dog);
    await this.persist();
  }

  async getHealthTasks(dogId: string): Promise<HealthTask[]> {
    const s = await this.load();
    return s.healthTasks.filter((t) => t.dogId === dogId);
  }

  async upsertHealthTask(task: HealthTask): Promise<void> {
    const s = await this.load();
    const idx = s.healthTasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) s.healthTasks[idx] = task;
    else s.healthTasks.push(task);
    await this.persist();
  }

  async getGpsSession(walkId: string): Promise<WalkGpsSession | undefined> {
    const s = await this.load();
    return s.gpsSessions.find((g) => g.walkId === walkId);
  }

  async upsertGpsSession(session: WalkGpsSession): Promise<void> {
    const s = await this.load();
    const idx = s.gpsSessions.findIndex((g) => g.walkId === session.walkId);
    if (idx >= 0) s.gpsSessions[idx] = session;
    else s.gpsSessions.push(session);
    await this.persist();
  }

  async getGpsSessionsForWalkIds(walkIds: string[]): Promise<WalkGpsSession[]> {
    const s = await this.load();
    const ids = new Set(walkIds);
    return s.gpsSessions.filter((g) => ids.has(g.walkId));
  }

  async getAchievementUnlocks(familyId: string): Promise<AchievementUnlock[]> {
    const s = await this.load();
    return s.achievementUnlocks.filter((a) => a.familyId === familyId);
  }

  async upsertAchievementUnlock(unlock: AchievementUnlock): Promise<void> {
    const s = await this.load();
    // Idempotent by (familyId, achievementKey, userId) — see 0052's
    // dedupe_key generated column for the server-side equivalent.
    const exists = s.achievementUnlocks.some(
      (a) => a.familyId === unlock.familyId && a.achievementKey === unlock.achievementKey && a.userId === unlock.userId
    );
    if (!exists) {
      s.achievementUnlocks.push(unlock);
      await this.persist();
    }
  }

  async getScheduleRules(familyId: string): Promise<ScheduleRule[]> {
    const s = await this.load();
    return s.rules.filter((r) => r.familyId === familyId);
  }

  async upsertScheduleRule(rule: ScheduleRule): Promise<void> {
    const s = await this.load();
    const idx = s.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) s.rules[idx] = rule;
    else s.rules.push(rule);
    await this.persist();
  }

  async deleteScheduleRule(ruleId: string): Promise<void> {
    const s = await this.load();
    s.rules = s.rules.filter((r) => r.id !== ruleId);
    await this.persist();
  }

  async getScheduleEntries(familyId: string): Promise<ScheduleEntry[]> {
    const s = await this.load();
    return s.entries.filter((e) => e.familyId === familyId);
  }

  async addScheduleEntries(entries: ScheduleEntry[]): Promise<void> {
    const s = await this.load();
    const existingKeys = new Set(s.entries.map((e) => `${e.dogId}|${e.date}|${e.time}`));
    for (const entry of entries) {
      const key = `${entry.dogId}|${entry.date}|${entry.time}`;
      if (!existingKeys.has(key)) {
        s.entries.push(entry);
        existingKeys.add(key);
      }
    }
    await this.persist();
  }

  async updateScheduleEntry(entry: ScheduleEntry): Promise<void> {
    const s = await this.load();
    const idx = s.entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) s.entries[idx] = entry;
    else s.entries.push(entry);
    await this.persist();
  }

  async deleteScheduleEntry(entryId: string): Promise<void> {
    const s = await this.load();
    s.entries = s.entries.filter((e) => e.id !== entryId);
    s.walks = s.walks.filter((w) => w.scheduleEntryId !== entryId);
    await this.persist();
  }

  async getWalks(familyId: string): Promise<Walk[]> {
    const s = await this.load();
    return s.walks.filter((w) => w.familyId === familyId);
  }

  /**
   * Optimistic-concurrency guard for "two people mark it done at once":
   * if the incoming write's `updatedAt` no longer matches what's stored, a
   * concurrent write already happened — we keep the version already saved
   * instead of clobbering it, and the caller (walkActions.markWalkDone) is
   * expected to have already rejected a double-complete before we get here.
   */
  async saveWalk(walk: Walk): Promise<void> {
    const s = await this.load();
    const idx = s.walks.findIndex((w) => w.id === walk.id);
    if (idx >= 0) {
      const current = s.walks[idx];
      if (current.status === 'done' && walk.status === 'done' && current.completedByUserId !== walk.completedByUserId) {
        // Someone else already completed it first — don't overwrite the record.
        return;
      }
      s.walks[idx] = walk;
    } else {
      s.walks.push(walk);
    }
    await this.persist();
  }

  /**
   * Section 2: deletes an unplanned/spontaneous walk entered by mistake.
   * Callers (scheduleStore.deleteUnplannedWalk) are responsible for the
   * is_unplanned/ownership check before calling this — this local
   * implementation trusts the caller the same way saveWalk does, matching
   * every other method on this class.
   */
  async deleteWalk(walkId: string): Promise<void> {
    const s = await this.load();
    s.walks = s.walks.filter((w) => w.id !== walkId);
    await this.persist();
  }

  async getNotificationSettings(familyId: string): Promise<NotificationSetting[]> {
    const users = await this.getUsers(familyId);
    return users.map((u) => ({ ...defaultNotificationSetting(u.id), enabled: u.remindersEnabled }));
  }
}
