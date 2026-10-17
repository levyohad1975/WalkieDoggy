import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StagingDuplicateWalkResolutionPanel } from '../StagingDuplicateWalkResolutionPanel';
import { TEST_DUPLICATE_RESOLUTION_RATIONALE } from '../../logic/duplicateWalkResolution';

const CONFIRMED_TEST_WALK_IDS = [
  'da94d830-4a1d-4044-b0e3-e1f3c4f59736',
  'f4c94498-2cfc-4ff0-b5e8-daaa9ed67847',
  'a40f80ad-b434-4603-a2b8-bea6f0fbcd00',
  '4350ff84-ec27-416b-b6ed-d3a5756dbb21',
];

const mockAuthState: any = {};
const mockFamilyState: any = { family: { timezone: 'Asia/Jerusalem' } };
const mockRepository: any = require('../../data').repository;
const mockGetOperationId = jest.fn();
const mockGetExistingOperationId = jest.fn();
const mockCompleteOperation = jest.fn();

jest.mock('../../store/authStore', () => ({ useAuthStore: (selector: (state: any) => unknown) => selector(mockAuthState) }));
jest.mock('../../store/familyStore', () => ({ useFamilyStore: (selector: (state: any) => unknown) => selector(mockFamilyState) }));
jest.mock('../../data', () => ({ repository: {
  getDuplicateActiveWalkReview: jest.fn(),
  resolveDuplicateActiveWalksV12: jest.fn(),
} }));
jest.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true, isWalkResolutionStaging: true }));
jest.mock('../../data/walkLifecycleOperationIds', () => ({
  getWalkLifecycleOperationId: (...args: unknown[]) => mockGetOperationId(...args),
  getExistingWalkLifecycleOperationId: (...args: unknown[]) => mockGetExistingOperationId(...args),
  completeWalkLifecycleOperation: (...args: unknown[]) => mockCompleteOperation(...args),
}));

function mockRecords() {
  return CONFIRMED_TEST_WALK_IDS.map((walkId, index) => ({
    walkId, familyId: 'family-1', dogId: 'dog-1', status: 'in_progress', isUnplanned: true,
    createdAt: `2026-10-13T10:0${index}:00Z`, startedAt: `2026-10-13T10:0${index}:00Z`, startedByUserId: `profile-${index + 1}`,
    actualWalkerUserId: `profile-${index + 1}`, responsibleUserId: 'profile-1',
    auditEntries: [{ id: `audit-${index}`, action: 'spontaneous_walk_added', actorUserId: 'profile-1', createdAt: `2026-10-13T10:0${index}:00Z`, metadata: { date: '2026-10-13', time: `13:0${index}` } }],
    gpsSessions: [],
  }));
}

function authorizeFamilyAdmin() {
  Object.assign(mockAuthState, {
    familyId: 'family-1', currentUserId: 'profile-admin', familyRole: 'admin',
    impersonatingUserId: null, systemObserverActive: false, testModeUserId: null,
  });
}

async function openConfirmation() {
  await waitFor(() => expect(screen.getByText('נמצאו 1 קבוצות פעילות לבדיקה. לא יבוצע שינוי ללא אישור מפורש של כל הקבוצה המוצגת.')).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'סקירה ואישור של 4 רשומות' }));
  fireEvent.press(screen.getByRole('checkbox'));
}

describe('StagingDuplicateWalkResolutionPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authorizeFamilyAdmin();
    mockRepository.getDuplicateActiveWalkReview.mockResolvedValue(mockRecords());
    mockRepository.resolveDuplicateActiveWalksV12.mockResolvedValue('audit-group-1');
    mockGetOperationId.mockResolvedValue('f4e33db4-72b3-4a3b-a7d0-8a9e5f4a327c');
    mockGetExistingOperationId.mockResolvedValue(undefined);
    mockCompleteOperation.mockResolvedValue(undefined);
  });

  it('discovers all four current-family records and requires explicit no-canonical confirmation before calling RPC', async () => {
    render(<StagingDuplicateWalkResolutionPanel />);
    await waitFor(() => expect(screen.getAllByText(/יומן ביקורת: spontaneous_walk_added/)).toHaveLength(4));
    await openConfirmation();
    expect(screen.getByText('אני מאשר/ת שכל 4 הרשומות המוצגות הן טיולי בדיקה כפולים, ושלא יישאר טיול קנוני פעיל.')).toBeTruthy();
    expect(mockRepository.resolveDuplicateActiveWalksV12).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'אישור מנהל/ת' }));
    await waitFor(() => expect(mockRepository.resolveDuplicateActiveWalksV12).toHaveBeenCalledTimes(1));
    expect(mockRepository.resolveDuplicateActiveWalksV12).toHaveBeenCalledWith({
      walkIds: [...CONFIRMED_TEST_WALK_IDS].sort(), canonicalWalkId: null,
      rationale: TEST_DUPLICATE_RESOLUTION_RATIONALE, operationId: 'f4e33db4-72b3-4a3b-a7d0-8a9e5f4a327c',
    });
    expect(mockCompleteOperation).toHaveBeenCalledWith('resolve_duplicates', expect.any(String), 'profile-admin');
    expect(screen.getByText(/נשמרה קבוצת ביקורת audit-group-1/)).toBeTruthy();
  }, 20000);

  it('maps server-side Family Admin denial and missing migration into distinct safe messages', async () => {
    const { unmount } = render(<StagingDuplicateWalkResolutionPanel />);
    await openConfirmation();
    mockRepository.resolveDuplicateActiveWalksV12.mockRejectedValueOnce({ code: '42501', message: 'family admin required' });
    fireEvent.press(screen.getByRole('button', { name: 'אישור מנהל/ת' }));
    await waitFor(() => expect(screen.getByText(/השרת לא אישר את פעולת מנהל\/ת המשפחה/)).toBeTruthy());
    unmount();

    mockRepository.getDuplicateActiveWalkReview.mockRejectedValueOnce({ code: 'PGRST202', message: 'Could not find the function' });
    render(<StagingDuplicateWalkResolutionPanel />);
    await waitFor(() => expect(screen.getByText(/שדות או פונקציות המיגרציה אינם זמינים ב-Staging/)).toBeTruthy());
  });

  it('ignores repeated confirmation taps while the authenticated RPC is in flight', async () => {
    let finishRpc!: (value: string) => void;
    mockRepository.resolveDuplicateActiveWalksV12.mockImplementationOnce(() => new Promise((resolve) => { finishRpc = resolve; }));
    render(<StagingDuplicateWalkResolutionPanel />);
    await openConfirmation();
    const confirm = screen.getByRole('button', { name: 'אישור מנהל/ת' });
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    await waitFor(() => expect(mockRepository.resolveDuplicateActiveWalksV12).toHaveBeenCalledTimes(1));
    finishRpc('audit-group-1');
    await waitFor(() => expect(screen.getByText(/נשמרה קבוצת ביקורת audit-group-1/)).toBeTruthy());
  }, 20000);

  it('retains and reuses the same operation id after an uncertain network result', async () => {
    render(<StagingDuplicateWalkResolutionPanel />);
    await openConfirmation();
    mockRepository.resolveDuplicateActiveWalksV12.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.press(screen.getByRole('button', { name: 'אישור מנהל/ת' }));
    await waitFor(() => expect(screen.getByText(/ייתכן שהפעולה הושלמה/)).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'בדיקת / ניסיון חוזר בטוח לקבוצה' }));
    fireEvent.press(screen.getByRole('checkbox'));
    mockRepository.resolveDuplicateActiveWalksV12.mockResolvedValueOnce('audit-group-1');
    fireEvent.press(screen.getByRole('button', { name: 'אישור מנהל/ת' }));
    await waitFor(() => expect(mockGetOperationId).toHaveBeenCalledTimes(2));
    expect(mockRepository.resolveDuplicateActiveWalksV12).toHaveBeenLastCalledWith(expect.objectContaining({ operationId: 'f4e33db4-72b3-4a3b-a7d0-8a9e5f4a327c' }));
  });

  it('does not render for a non-admin or while using an observer session', () => {
    mockAuthState.familyRole = 'member';
    const { unmount } = render(<StagingDuplicateWalkResolutionPanel />);
    expect(screen.queryByText('בדיקת טיולים פעילים כפולים · Staging')).toBeNull();
    unmount();
    authorizeFamilyAdmin();
    mockAuthState.systemObserverActive = true;
    render(<StagingDuplicateWalkResolutionPanel />);
    expect(screen.queryByText('בדיקת טיולים פעילים כפולים · Staging')).toBeNull();
  });
});
