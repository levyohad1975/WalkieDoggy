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

function setup(step: 2 | 3 | 4 | 5 = 2, pendingDogSex?: 'male' | 'female') {
  const onProgressChange = jest.fn();
  const onComplete = jest.fn().mockResolvedValue(undefined);
  const saveDog = jest.fn(async (dog: typeof DOG) => {
    useFamilyStore.setState({ dog, dogs: [dog], selectedDogId: dog.id });
  });
  const loadFamily = jest.fn().mockResolvedValue(undefined);
  const loadSchedule = jest.fn().mockResolvedValue(true);
  const addUser = jest.fn(async (input: { name: string; avatar: string; color: string }) => {
    const user = { ...input, id: 'new-member', familyId: FAMILY_ID, remindersEnabled: true, gamificationEnabled: true, createdAt: '2026-01-01T00:00:00.000Z' };
    useFamilyStore.setState((state) => ({ users: [...state.users, user] }));
    return user;
  });
  const addRule = jest.fn(async (rule: any) => useScheduleStore.setState((state) => ({ rules: [...state.rules, rule] })));
  useAuthStore.setState({ currentUserId: ADMIN_ID, familyId: FAMILY_ID, familyRole: 'admin' });
  useFamilyStore.setState({ family: { id: FAMILY_ID, name: 'משפחת כהן', inviteCode: 'ABC123', timezone: 'Asia/Jerusalem', createdAt: '2026-01-01T00:00:00.000Z' }, dog: null, dogs: [], users: [ADMIN], selectedDogId: undefined, loading: false, error: null, load: loadFamily, saveDog, selectDog: jest.fn(), removeDogPhoto: jest.fn(), addUser, updateUser: jest.fn() } as any);
  useScheduleStore.setState({ rules: [], entries: [], walks: [], loading: false, error: null, load: loadSchedule, addRule, updateRule: jest.fn(), deleteRule: jest.fn() } as any);
  mockPickAndUpload.mockReset();
  mockTakeAndUpload.mockReset();
  const view = render(<SafeAreaProvider><FamilySetupWizard familyId={FAMILY_ID} progress={{ ...progress, ...(pendingDogSex ? { pendingDogSex } : {}), step }} onProgressChange={onProgressChange} onComplete={onComplete} /></SafeAreaProvider>);
  return { ...view, onProgressChange, onComplete, saveDog, addUser, addRule, loadFamily, loadSchedule };
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
