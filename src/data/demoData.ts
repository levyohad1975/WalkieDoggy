import type { Dog, Family, FamilyUser, ScheduleEntry, ScheduleRule, Walk } from '../types';
import { toDateOnly } from '../logic/rotation';

/**
 * המשפחה שלנו — demo/seed data used by the local repository (offline mode,
 * first run before Supabase is configured, and Jest tests). Mirrors
 * supabase/seed.sql so behavior is consistent whichever backend is active.
 */

export const DEMO_FAMILY: Family = {
  id: 'family-main',
  name: 'המשפחה שלנו',
  createdAt: new Date().toISOString(),
};

export const DEMO_USERS: FamilyUser[] = [
  {
    id: 'user-aba',
    familyId: DEMO_FAMILY.id,
    name: 'אבא',
    avatar: '👨',
    color: '#5B8DEF',
    remindersEnabled: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'user-ima',
    familyId: DEMO_FAMILY.id,
    name: 'אמא',
    avatar: '👩',
    color: '#F2994A',
    remindersEnabled: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'user-eidan',
    familyId: DEMO_FAMILY.id,
    name: 'עידן',
    avatar: '🧑',
    color: '#27AE60',
    remindersEnabled: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'user-omer',
    familyId: DEMO_FAMILY.id,
    name: 'עומר',
    avatar: '🧑',
    color: '#BB6BD9',
    remindersEnabled: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'user-maor',
    familyId: DEMO_FAMILY.id,
    name: 'מאור',
    avatar: '🧑',
    color: '#EB5757',
    remindersEnabled: true,
    createdAt: new Date().toISOString(),
  },
];

export const DEMO_DOG: Dog = {
  id: 'dog-topi',
  familyId: DEMO_FAMILY.id,
  name: 'טופי',
  walksPerDay: 4,
  notes: 'הכי טוב בעולם 🐾',
};

const ALL_USER_IDS = DEMO_USERS.map((u) => u.id);

function daysAgo(n: number): string {
  return toDateOnly(new Date(Date.now() - n * 86400000));
}

export const DEMO_RULES: ScheduleRule[] = [
  {
    id: 'rule-0700',
    familyId: DEMO_FAMILY.id,
    dogId: DEMO_DOG.id,
    time: '07:00',
    label: 'טיול בוקר',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    rotationUserIds: ALL_USER_IDS,
    rotationAnchorDate: daysAgo(0),
    sortOrder: 0,
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'rule-1230',
    familyId: DEMO_FAMILY.id,
    dogId: DEMO_DOG.id,
    time: '12:30',
    label: 'טיול צהריים',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    rotationUserIds: ALL_USER_IDS,
    rotationAnchorDate: daysAgo(1),
    sortOrder: 1,
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'rule-1700',
    familyId: DEMO_FAMILY.id,
    dogId: DEMO_DOG.id,
    time: '17:00',
    label: 'טיול אחר הצהריים',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    rotationUserIds: ALL_USER_IDS,
    rotationAnchorDate: daysAgo(2),
    sortOrder: 2,
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'rule-2130',
    familyId: DEMO_FAMILY.id,
    dogId: DEMO_DOG.id,
    time: '21:30',
    label: 'טיול לילה',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    rotationUserIds: ALL_USER_IDS,
    rotationAnchorDate: daysAgo(3),
    sortOrder: 3,
    active: true,
    createdAt: new Date().toISOString(),
  },
];

function todayEntry(rule: ScheduleRule, id: string, responsibleUserId: string): ScheduleEntry {
  return {
    id,
    familyId: DEMO_FAMILY.id,
    dogId: DEMO_DOG.id,
    ruleId: rule.id,
    date: toDateOnly(new Date()),
    time: rule.time,
    responsibleUserId,
    createdAt: new Date().toISOString(),
  };
}

export const DEMO_ENTRIES: ScheduleEntry[] = [
  todayEntry(DEMO_RULES[0], 'entry-0700', 'user-aba'),
  todayEntry(DEMO_RULES[1], 'entry-1230', 'user-ima'),
  todayEntry(DEMO_RULES[2], 'entry-1700', 'user-eidan'),
  todayEntry(DEMO_RULES[3], 'entry-2130', 'user-omer'),
];

function todayAt(hh: number, mm: number): string {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

export const DEMO_WALKS: Walk[] = [
  {
    id: 'walk-0700',
    familyId: DEMO_FAMILY.id,
    scheduleEntryId: 'entry-0700',
    dogId: DEMO_DOG.id,
    date: toDateOnly(new Date()),
    scheduledTime: '07:00',
    responsibleUserId: 'user-aba',
    status: 'done',
    completedAt: todayAt(7, 12),
    completedByUserId: 'user-aba',
    hadPee: true,
    hadPoop: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'walk-1230',
    familyId: DEMO_FAMILY.id,
    scheduleEntryId: 'entry-1230',
    dogId: DEMO_DOG.id,
    date: toDateOnly(new Date()),
    scheduledTime: '12:30',
    responsibleUserId: 'user-ima',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'walk-1700',
    familyId: DEMO_FAMILY.id,
    scheduleEntryId: 'entry-1700',
    dogId: DEMO_DOG.id,
    date: toDateOnly(new Date()),
    scheduledTime: '17:00',
    responsibleUserId: 'user-eidan',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'walk-2130',
    familyId: DEMO_FAMILY.id,
    scheduleEntryId: 'entry-2130',
    dogId: DEMO_DOG.id,
    date: toDateOnly(new Date()),
    scheduledTime: '21:30',
    responsibleUserId: 'user-omer',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
