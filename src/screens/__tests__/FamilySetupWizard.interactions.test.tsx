import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPickAndUpload = jest.fn();
const mockTakeAndUpload = jest.fn();
jest.mock('../../lib/uploadImage', () => ({
  pickAndUploadImage: (...args: unknown[]) => mockPickAndUpload(...args),
  takeAndUploadImage: (...args: unknown[]) => mockTakeAndUpload(...args),
}));
jest.mock('../../components/WalkieMascot', () => ({ WalkieMascot: () => null }));
jest.mock('../../components/DogPhoto', () => {
  const { Text } = require('react-native');
  return { DogPhoto: ({ photoUrl }: { photoUrl?: string }) => <Text>{photoUrl ? `dog-photo:${photoUrl}` : 'official-mascot'}</Text> };
});
jest.mock('../../components/Avatar', () => ({ Avatar: () => null }));
jest.mock('../../components/Button', () => ({
  Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => {
    const { Pressable, Text } = require('react-native');
    return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>
    );
  },
}));
jest.mock('../../components/TimePickerField', () => ({
  TimePickerField: ({ webLabel, onChange }: { webLabel: string; onChange: (time: string) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
    <Pressable accessibilityRole="button" accessibilityLabel={webLabel} onPress={() => onChange('09:30')}><Text>{webLabel}</Text></Pressable>
    );
  },
}));
jest.mock('../../components/UserFormModal', () => ({
  UserFormModal: ({ visible, onSave }: { visible: boolean; onSave: (user: { name: string; avatar: string; color: string }) => void }) => {
    const { Pressable, Text } = require('react-native');
    return visible ? <Pressable accessibilityRole="button" accessibilityLabel="שמירת בן משפחה לבדיקה" onPress={() => onSave({ name: 'נועה בת כהן', avatar: '👧', color: '#5B8DEF' })}><Text>שמירת בן משפחה לבדיקה</Text></Pressable> : null;
  },
}));
jest.mock('../../components/FamilySharingModal', () => ({ FamilySharingModal: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(View, null, children),
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: unknown }) => ReactActual.createElement(View, { style }, children),
  };
});

import { FamilySetupWizard } from '../FamilySetupWizard';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { useScheduleStore } from '../../store/scheduleStore';
import { FAMILY_SETUP_PROGRESS_KEY } from '../../lib/familySetupProgress';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FAMILY_ID = 'wizard-family';
const ADMIN_ID = 'wizard-admin';
const DOG = { id: 'wizard-dog', familyId: FAMILY_ID, name: 'לוקה', walksPerDay: 0 };
const ADMIN = { id: ADMIN_ID, familyId: FAMILY_ID, name: 'יעל כהן', avatar: '👩', color: '#5B8DEF', remindersEnabled: true, gamificationEnabled: true, createdAt: '2026-01-01T00:00:00.000Z' };
const progress = { familyId: FAMILY_ID, ownerAuthUserId: 'verified-owner', step: 2 as const, adminUserId: ADMIN_ID };

function setup(step: 2 | 3 | 4 | 5 = 2, pendingDogSex?: 'male' | 'female', omitAdminProgress = false) {
  const onProgressChange = jest.fn();
  const onComplete = jest.fn().mockResolvedValue(undefined);
  const saveDog = jest.fn(async (dog: typeof DOG) => {
    useFamilyStore.setState({ dog, dogs: [dog], selectedDogId: dog.id });
  });
  const loadFamily = jest.fn().mockResolvedValue(undefined);
  const loadSchedule = jest.fn().mockResolvedValue(true);
  const addUser = jest.fn(async (input: { id?: string; name: string; avatar: string; color: string }) => {
    const user = { ...input, id: input.id ?? 'new-member', familyId: FAMILY_ID, remindersEnabled: true, gamificationEnabled: true, createdAt: '2026-01-01T00:00:00.000Z' };
    useFamilyStore.setState((state) => ({ users: [...state.users, user] }));
    return user;
  });
  const addRule = jest.fn(async (rule: any) => useScheduleStore.setState((state) => ({ rules: [...state.rules, rule] })));
  const signIn = jest.fn().mockResolvedValue(undefined);
  useAuthStore.setState({ currentUserId: omitAdminProgress ? null : ADMIN_ID, familyId: FAMILY_ID, familyRole: 'admin', isQaFamily: omitAdminProgress, signIn } as any);
  const scheduleDog = step >= 4 ? { ...DOG } : null;
  useFamilyStore.setState({ family: { id: FAMILY_ID, name: 'משפחת כהן', inviteCode: 'ABC123', timezone: 'Asia/Jerusalem', createdAt: '2026-01-01T00:00:00.000Z' }, dog: scheduleDog, dogs: scheduleDog ? [scheduleDog] : [], users: [ADMIN], selectedDogId: scheduleDog?.id, loading: false, error: null, load: loadFamily, saveDog, selectDog: jest.fn(), removeDogPhoto: jest.fn(), addUser, updateUser: jest.fn() } as any);
  useScheduleStore.setState({ rules: [], entries: [], walks: [], loading: false, error: null, load: loadSchedule, addRule, updateRule: jest.fn(), deleteRule: jest.fn() } as any);
  mockPickAndUpload.mockReset();
  mockTakeAndUpload.mockReset();
  const view = render(<SafeAreaProvider><FamilySetupWizard familyId={FAMILY_ID} progress={{ ...progress, ...(omitAdminProgress ? { adminUserId: undefined } : {}), ...(pendingDogSex ? { pendingDogSex } : {}), step }} onProgressChange={onProgressChange} onComplete={onComplete} /></SafeAreaProvider>);
  return { ...view, onProgressChange, onComplete, saveDog, addUser, addRule, loadFamily, loadSchedule, signIn };
}

describe('FamilySetupWizard interactions', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });
  afterEach(cleanup);

  it('advances after the real-photo preview and avoids a redundant second dog save', async () => {
    const state = setup();
    await waitFor(() => expect(screen.getByLabelText('שם הכלב או הכלבה')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('שם הכלב או הכלבה'), 'בוקי');
    await act(async () => { fireEvent.press(screen.getByLabelText('נקבה')); });
    mockPickAndUpload.mockResolvedValue('https://cdn.example/buki.jpg');

    await act(async () => { fireEvent.press(screen.getByLabelText('בחירת תמונה מהגלריה')); });
    expect(screen.getByText('dog-photo:https://cdn.example/buki.jpg')).toBeTruthy();
    expect(state.saveDog).toHaveBeenCalledTimes(2);
    expect(state.saveDog).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'בוקי',
      sex: 'female',
      photoUrl: 'https://cdn.example/buki.jpg',
    }));

    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לבני המשפחה')); });
    expect(state.onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({ step: 3 }));
    expect(screen.getByLabelText('הוספת בן או בת משפחה')).toBeTruthy();
    expect(state.saveDog).toHaveBeenCalledTimes(2);
  });

  it('keeps an uploaded photo available and shows a visible retryable error when saving the dog fails', async () => {
    const state = setup();
    await waitFor(() => expect(screen.getByLabelText('שם הכלב או הכלבה')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('שם הכלב או הכלבה'), 'בוקי');
    mockPickAndUpload.mockResolvedValue('https://cdn.example/buki.jpg');
    state.saveDog.mockRejectedValueOnce(new Error('offline'));

    await act(async () => { fireEvent.press(screen.getByLabelText('בחירת תמונה מהגלריה')); });
    expect(await screen.findByText(/התמונה הועלתה, אך שמירת פרטי הכלב/)).toBeTruthy();
    expect(screen.getByText('dog-photo:https://cdn.example/buki.jpg')).toBeTruthy();
    expect(JSON.parse((await AsyncStorage.getItem(FAMILY_SETUP_PROGRESS_KEY))!).pendingDogPhotoUrl).toBe('https://cdn.example/buki.jpg');

    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לבני המשפחה')); });
    expect(state.onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({ step: 3 }));
    expect(state.saveDog).toHaveBeenCalledTimes(2);
    expect(state.saveDog).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'בוקי', photoUrl: 'https://cdn.example/buki.jpg' }));
  });

  it('creates the first dog for a QA family with a database-valid walk count before advancing', async () => {
    const state = setup();
    await waitFor(() => expect(screen.getByLabelText('שם הכלב או הכלבה')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('שם הכלב או הכלבה'), 'בוקי');
    await act(async () => { fireEvent.press(screen.getByLabelText('זכר')); });
    mockPickAndUpload.mockResolvedValue('https://cdn.example/buki-qa.jpg');

    await act(async () => { fireEvent.press(screen.getByLabelText('בחירת תמונה מהגלריה')); });
    expect(state.saveDog).toHaveBeenLastCalledWith(expect.objectContaining({
      familyId: FAMILY_ID,
      name: 'בוקי',
      sex: 'male',
      photoUrl: 'https://cdn.example/buki-qa.jpg',
      walksPerDay: 1,
    }));

    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לבני המשפחה')); });
    expect(state.onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({ familyId: FAMILY_ID, step: 3 }));
    expect(screen.getByLabelText('הוספת בן או בת משפחה')).toBeTruthy();
    expect(state.saveDog).toHaveBeenCalledTimes(2);
  });

  it('persists the test-family administrator once and safely retries a profile-claim queue guard', async () => {
    const state = setup(3);
    await waitFor(() => expect(screen.getByLabelText('המשך להגדרת הטיולים')).toBeTruthy());
    state.signIn.mockRejectedValueOnce(new Error('pending sync from another profile on this device — connect to the internet and try again'));
    act(() => {
      useFamilyStore.setState({ users: [] });
      useAuthStore.setState({ currentUserId: null, isQaFamily: true });
    });
    await waitFor(() => expect(screen.getByLabelText('שם מנהל המשפחה')).toBeTruthy());

    const nameInput = screen.getByLabelText('שם מנהל המשפחה');
    fireEvent.changeText(nameInput, 'מנהל בדיקה');
    await act(async () => { fireEvent.press(screen.getByLabelText('שמירה והמשך')); });

    expect(await screen.findByText(/פרופיל המנהל נשמר במשפחת הבדיקה/)).toBeTruthy();
    expect(state.addUser).toHaveBeenCalledTimes(1);
    expect(state.signIn).toHaveBeenCalledTimes(1);
    expect(state.addUser).toHaveBeenCalledWith(expect.objectContaining({
      id: ADMIN_ID,
      name: 'מנהל בדיקה',
    }));
    const savedDraft = JSON.parse((await AsyncStorage.getItem(FAMILY_SETUP_PROGRESS_KEY))!);
    expect(savedDraft).toEqual(expect.objectContaining({
      familyId: FAMILY_ID,
      adminUserId: ADMIN_ID,
      adminName: 'מנהל בדיקה',
    }));
    expect(useFamilyStore.getState().users).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ADMIN_ID, familyId: FAMILY_ID, name: 'מנהל בדיקה' }),
    ]));

    await act(async () => { fireEvent.press(screen.getByLabelText('שמירה והמשך')); });
    expect(await screen.findByText('טיולים בכל יום (0)')).toBeTruthy();
    expect(state.addUser).toHaveBeenCalledTimes(1);
    expect(state.signIn).toHaveBeenCalledTimes(2);
    expect(state.signIn).toHaveBeenNthCalledWith(1, ADMIN_ID);
    expect(state.signIn).toHaveBeenNthCalledWith(2, ADMIN_ID);
  });

  it('re-enters an existing QA family and schedules walks for its sole saved manager', async () => {
    const state = setup(4, undefined, true);
    await waitFor(() => expect(screen.getByText('טיולים בכל יום (0)')).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText('הוספת שעה ללוח').props.disabled).toBeFalsy());

    await act(async () => { fireEvent.press(screen.getByLabelText('הוספת הצעה: בוקר, צהריים וערב')); });

    expect(state.addRule).toHaveBeenCalledTimes(3);
    expect(state.addRule.mock.calls.map(([rule]) => rule.time)).toEqual(['08:00', '14:00', '20:00']);
    for (const [rule] of state.addRule.mock.calls) {
      expect(rule).toEqual(expect.objectContaining({ familyId: FAMILY_ID, dogId: DOG.id, rotationUserIds: [ADMIN_ID], active: true }));
    }
    expect(screen.getByText('08:00 · טיול בוקר')).toBeTruthy();
    expect(screen.getByText('14:00 · טיול צהריים')).toBeTruthy();
    expect(screen.getByText('20:00 · טיול ערב')).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לסיכום')); });
    expect(screen.getByText('שלב 5 מתוך 5')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('חזרה לעריכה')); });
    expect(screen.getByText('08:00 · טיול בוקר')).toBeTruthy();
    expect(screen.getByText('14:00 · טיול צהריים')).toBeTruthy();
    expect(screen.getByText('20:00 · טיול ערב')).toBeTruthy();
  });

  it('explains when no active member in this family can be assigned', async () => {
    setup(4);
    await waitFor(() => expect(screen.getByText('טיולים בכל יום (0)')).toBeTruthy());
    act(() => { useFamilyStore.setState({ users: [] }); });
    expect(await screen.findByText(/לא נמצא במשפחה פרופיל פעיל/)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('הוספת שעה ללוח')); });
    expect(useScheduleStore.getState().rules).toHaveLength(0);
    expect(state.addRule).not.toHaveBeenCalled();
  });

  it('continues without a photo when a valid dog name has been entered', async () => {
    const state = setup();
    await waitFor(() => expect(screen.getByLabelText('שם הכלב או הכלבה')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('שם הכלב או הכלבה'), 'בוקי');
    expect(screen.getByText('official-mascot')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לבני המשפחה')); });
    expect(state.saveDog).toHaveBeenCalledWith(expect.objectContaining({ name: 'בוקי' }));
    expect(state.onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({ step: 3 }));
    expect(screen.getByLabelText('הוספת בן או בת משפחה')).toBeTruthy();
  });

  it('persists dog sex in the profile and resumable setup draft, then restores it into the saved dog', async () => {
    const state = setup();
    await waitFor(() => expect(screen.getByLabelText('מין הכלב או הכלבה')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('נקבה'));
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(FAMILY_SETUP_PROGRESS_KEY))!).pendingDogSex).toBe('female'));
    fireEvent.changeText(screen.getByLabelText('שם הכלב או הכלבה'), 'לוקה');
    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לבני המשפחה')); });
    expect(state.saveDog).toHaveBeenCalledWith(expect.objectContaining({ name: 'לוקה', sex: 'female' }));
    expect(state.onProgressChange).toHaveBeenCalledWith(expect.objectContaining({ step: 3, pendingDogSex: undefined }));
  });

  it('restores a saved dog sex draft when onboarding resumes after refresh', async () => {
    setup(2, 'female');
    await waitFor(() => expect(screen.getByLabelText('נקבה').props.accessibilityState.selected).toBe(true));
  });

  it('requires a dog name and preserves a selected photo until the named dog is saved', async () => {
    const state = setup();
    await waitFor(() => expect(screen.getByLabelText('המשך לבני המשפחה')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('המשך לבני המשפחה'));
    expect(await screen.findByText('צריך להזין את שם הכלב/ה כדי להמשיך.')).toBeTruthy();
    expect(state.saveDog).not.toHaveBeenCalled();

    mockPickAndUpload.mockResolvedValue('https://cdn.example/family-dog.jpg');
    await act(async () => { fireEvent.press(screen.getByLabelText('בחירת תמונה מהגלריה')); });
    expect(await screen.findByText('dog-photo:https://cdn.example/family-dog.jpg')).toBeTruthy();
    expect(state.saveDog).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(FAMILY_SETUP_PROGRESS_KEY))!).pendingDogPhotoUrl).toBe('https://cdn.example/family-dog.jpg');

    fireEvent.changeText(screen.getByLabelText('שם הכלב או הכלבה'), 'לוקה');
    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לבני המשפחה')); });
    expect(state.saveDog).toHaveBeenCalledWith(expect.objectContaining({ name: 'לוקה', photoUrl: 'https://cdn.example/family-dog.jpg' }));
    expect(state.onProgressChange).toHaveBeenCalledWith(expect.objectContaining({ step: 3, pendingDogPhotoUrl: undefined }));
  });

  it('opens the gallery on the tap before awaiting the entered dog-name save', async () => {
    setup();
    await waitFor(() => expect(screen.getByLabelText('שם הכלב או הכלבה')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('שם הכלב או הכלבה'), 'לוקה');

    let resolvePicker!: (value: string | null) => void;
    let clearPreview!: () => void;
    mockPickAndUpload.mockImplementation((...args: unknown[]) => {
      const onPreview = args[3] as (uri: string | null) => void;
      onPreview('blob:local-dog-preview');
      clearPreview = () => onPreview(null);
      return new Promise((resolve) => { resolvePicker = resolve; });
    });
    fireEvent.press(screen.getByLabelText('בחירת תמונה מהגלריה'));

    expect(screen.getByText('dog-photo:blob:local-dog-preview')).toBeTruthy();
    expect(mockPickAndUpload).toHaveBeenCalledTimes(1);
    expect(mockPickAndUpload).toHaveBeenCalledWith(
      'dogs',
      FAMILY_ID,
      expect.any(String),
      expect.any(Function),
    );
    await act(async () => { clearPreview(); resolvePicker(null); });
  });

  it('shows a retryable Hebrew error when dog persistence fails, then allows back and forward navigation', async () => {
    const state = setup();
    await waitFor(() => expect(screen.getByLabelText('שם הכלב או הכלבה')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('שם הכלב או הכלבה'), 'לוקה');
    state.saveDog.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לבני המשפחה')); });
    expect(await screen.findByText('לא הצלחנו לשמור את פרטי הכלב/ה. בדקו את החיבור ונסו שוב.')).toBeTruthy();
    expect(screen.getByLabelText('ניסיון חוזר')).toBeTruthy();
    expect(screen.getByLabelText('המשך לבני המשפחה')).toBeTruthy();
    state.saveDog.mockImplementationOnce(async (dog) => { useFamilyStore.setState({ dog, dogs: [dog] }); });
    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לבני המשפחה')); });
    expect(state.onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({ step: 3 }));
    await act(async () => { fireEvent.press(screen.getByText('חזרה')); });
    expect(screen.getByLabelText('שם הכלב או הכלבה')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לבני המשפחה')); });
    expect(state.onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({ step: 3 }));
  });

  it('ignores repeated taps while a server save is in flight', async () => {
    const state = setup();
    await waitFor(() => expect(screen.getByLabelText('שם הכלב או הכלבה')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('שם הכלב או הכלבה'), 'לוקה');
    let resolveSave!: () => void;
    state.saveDog.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    fireEvent.press(screen.getByLabelText('המשך לבני המשפחה'));
    fireEvent.press(screen.getByLabelText('המשך לבני המשפחה'));
    expect(state.saveDog).toHaveBeenCalledTimes(1);
    await act(async () => { resolveSave(); });
    expect(state.onProgressChange).toHaveBeenCalledWith(expect.objectContaining({ step: 3 }));
  });

  it('adds a member with a spaced name and offers Invite Later', async () => {
    const state = setup(3);
    await waitFor(() => expect(screen.getByLabelText('הוספת בן או בת משפחה')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('הוספת בן או בת משפחה'));
    fireEvent.press(await screen.findByLabelText('שמירת בן משפחה לבדיקה'));
    await waitFor(() => expect(state.addUser).toHaveBeenCalledWith(expect.objectContaining({ name: 'נועה בת כהן' })));
    await act(async () => { fireEvent.press(screen.getByText('הזמנה אחר כך · המשך')); });
    expect(state.onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({ step: 4 }));
  });

  it('saves configured schedule times and completes directly to the dashboard callback', async () => {
    const state = setup(4);
    act(() => { useFamilyStore.setState({ dog: DOG, dogs: [DOG], selectedDogId: DOG.id }); });
    await waitFor(() => expect(screen.getByLabelText('בחירת שעת טיול')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('בחירת שעת טיול'));
    await act(async () => { fireEvent.press(screen.getByLabelText('הוספת שעה ללוח')); });
    expect(state.addRule).toHaveBeenCalledWith(expect.objectContaining({ dogId: DOG.id, time: '09:30', rotationUserIds: [ADMIN_ID] }));
    await act(async () => { fireEvent.press(screen.getByLabelText('המשך לסיכום')); });
    await waitFor(() => expect(screen.getByLabelText('בואו נתחיל!')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByLabelText('בואו נתחיל!')); });
    expect(state.onComplete).toHaveBeenCalledTimes(1);
  });
});
