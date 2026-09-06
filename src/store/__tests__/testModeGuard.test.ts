import { Alert } from 'react-native';
import type { Dog, FamilyUser, ScheduleRule } from '../../types';

/**
 * ADMIN TEST MODE must be genuinely read-only (requirement 1, tightened
 * after review): while `authStore.testModeUserId` is set, NO mutation may
 * reach the repository/RPC layer from ANY store — scheduleStore,
 * familyStore, or requestsStore — regardless of which screen or button
 * triggered the call. See src/lib/testModeGuard.ts for the shared guard
 * every mutating store action calls as its first line.
 *
 * Each test spies on the actual repository/RPC functions the action would
 * otherwise call and asserts they are NEVER invoked while test mode is
 * active — not just that the resulting state "looks unchanged".
 */
describe('Admin Test Mode blocks every mutation at the store layer', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.restoreAllMocks();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  function activateTestMode() {
    const { useAuthStore } = require('../authStore');
    useAuthStore.setState({ testModeUserId: 'member-being-simulated' });
  }

  describe('scheduleStore', () => {
    async function setup() {
      const { useScheduleStore } = require('../scheduleStore');
      const { repository } = require('../../data');
      await useScheduleStore.getState().load('family-main');
      activateTestMode();
      return { useScheduleStore, repository };
    }

    it('markDone never calls repository.saveWalk', async () => {
      const { useScheduleStore, repository } = await setup();
      const saveWalk = jest.spyOn(repository, 'saveWalk');
      const walk = useScheduleStore.getState().walks[0];

      await useScheduleStore.getState().markDone(walk.id, 'someone', {});

      expect(saveWalk).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalled();
    });

    it('addUnplannedWalk never calls repository.saveWalk', async () => {
      const { useScheduleStore, repository } = await setup();
      const saveWalk = jest.spyOn(repository, 'saveWalk');

      await useScheduleStore.getState().addUnplannedWalk({
        familyId: 'family-main',
        dogId: 'dog-topi',
        performedByUserId: 'user-aba',
        date: '2026-08-30',
        time: '09:00',
        hadPee: true,
        hadPoop: false,
      });

      expect(saveWalk).not.toHaveBeenCalled();
    });

    it('swap / swapTwoWalks / rescheduleWalk / skip never call repository.saveWalk', async () => {
      const { useScheduleStore, repository } = await setup();
      const saveWalk = jest.spyOn(repository, 'saveWalk');
      const walks = useScheduleStore.getState().walks.filter((w: any) => w.status === 'pending');

      await useScheduleStore.getState().swap(walks[0].id, 'user-ima', 'user-aba');
      await useScheduleStore.getState().rescheduleWalk(walks[0].id, '10:00');
      await useScheduleStore.getState().skip(walks[0].id);
      if (walks.length > 1) await useScheduleStore.getState().swapTwoWalks(walks[0].id, walks[1].id, 'user-aba');

      expect(saveWalk).not.toHaveBeenCalled();
    });

    it('addRule / updateRule / deleteRule / reorderRules never touch the repository', async () => {
      const { useScheduleStore, repository } = await setup();
      const upsertScheduleRule = jest.spyOn(repository, 'upsertScheduleRule');
      const deleteScheduleRule = jest.spyOn(repository, 'deleteScheduleRule');
      const rules = useScheduleStore.getState().rules;

      const newRule: ScheduleRule = {
        id: 'rule-blocked',
        familyId: 'family-main',
        dogId: 'dog-topi',
        time: '11:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        rotationUserIds: ['user-aba'],
        rotationAnchorDate: '2026-08-27',
        sortOrder: 99,
        active: true,
        createdAt: new Date().toISOString(),
      };
      await useScheduleStore.getState().addRule(newRule);
      await useScheduleStore.getState().updateRule(rules[0].id, { time: '12:00' });
      await useScheduleStore.getState().deleteRule(rules[0].id);
      await useScheduleStore.getState().reorderRules(rules.map((r: ScheduleRule) => r.id).reverse());

      expect(upsertScheduleRule).not.toHaveBeenCalled();
      expect(deleteScheduleRule).not.toHaveBeenCalled();
      expect(useScheduleStore.getState().rules).toEqual(rules); // state genuinely untouched
    });
  });

  describe('familyStore', () => {
    async function setup() {
      const { useFamilyStore } = require('../familyStore');
      const { repository } = require('../../data');
      await useFamilyStore.getState().load('family-main');
      activateTestMode();
      return { useFamilyStore, repository };
    }

    it('setReminderEnabled / saveDog / updateUser / deleteUser never touch the repository', async () => {
      const { useFamilyStore, repository } = await setup();
      const updateUserReminderSetting = jest.spyOn(repository, 'updateUserReminderSetting');
      const upsertDog = jest.spyOn(repository, 'upsertDog');
      const upsertUser = jest.spyOn(repository, 'upsertUser');
      const deleteFamilyMember = jest.spyOn(repository, 'deleteFamilyMember');
      const users = useFamilyStore.getState().users;
      const dog = useFamilyStore.getState().dog as Dog;

      await useFamilyStore.getState().setReminderEnabled(users[0].id, false);
      await useFamilyStore.getState().saveDog({ ...dog, name: 'שם חדש' });
      await useFamilyStore.getState().updateUser({ ...users[0], name: 'שם אחר' } as FamilyUser);
      await useFamilyStore.getState().deleteUser(users[0].id, users[1]?.id ?? null);

      expect(updateUserReminderSetting).not.toHaveBeenCalled();
      expect(upsertDog).not.toHaveBeenCalled();
      expect(upsertUser).not.toHaveBeenCalled();
      expect(deleteFamilyMember).not.toHaveBeenCalled();
    });

    it('addUser rejects instead of silently succeeding, and never touches the repository', async () => {
      const { useFamilyStore, repository } = await setup();
      const upsertUser = jest.spyOn(repository, 'upsertUser');

      await expect(
        useFamilyStore.getState().addUser({ name: 'חדש', avatar: '🐶', color: '#000' })
      ).rejects.toThrow();

      expect(upsertUser).not.toHaveBeenCalled();
    });
  });

  describe('requestsStore', () => {
    it('createSwap / approveSwap / rejectSwap / createTimeChange / approveTimeChange / rejectTimeChange never call the RPC layer', async () => {
      jest.doMock('../../lib/requests', () => ({
        createSwapRequest: jest.fn(),
        approveSwapRequest: jest.fn(),
        rejectSwapRequest: jest.fn(),
        listSwapRequests: jest.fn().mockResolvedValue([]),
        createTimeChangeRequest: jest.fn(),
        approveTimeChangeRequest: jest.fn(),
        rejectTimeChangeRequest: jest.fn(),
        listTimeChangeRequests: jest.fn().mockResolvedValue([]),
      }));
      const rpc = require('../../lib/requests');
      activateTestMode();
      const { useRequestsStore } = require('../requestsStore');

      await useRequestsStore.getState().createSwap('walk-1', 'walk-2');
      await useRequestsStore.getState().approveSwap('req-1');
      await useRequestsStore.getState().rejectSwap('req-1');
      await useRequestsStore.getState().createTimeChange('walk-1', '19:00');
      await useRequestsStore.getState().approveTimeChange('req-2');
      await useRequestsStore.getState().rejectTimeChange('req-2');

      expect(rpc.createSwapRequest).not.toHaveBeenCalled();
      expect(rpc.approveSwapRequest).not.toHaveBeenCalled();
      expect(rpc.rejectSwapRequest).not.toHaveBeenCalled();
      expect(rpc.createTimeChangeRequest).not.toHaveBeenCalled();
      expect(rpc.approveTimeChangeRequest).not.toHaveBeenCalled();
      expect(rpc.rejectTimeChangeRequest).not.toHaveBeenCalled();
    });
  });
});
