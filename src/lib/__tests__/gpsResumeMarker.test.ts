import { Platform } from 'react-native';
import {
  clearGpsTrackingMarker,
  isGeolocationAlreadyGranted,
  markGpsTrackingOnThisDevice,
  wasTrackingGpsOnThisDevice,
} from '../gpsResumeMarker';

describe('gpsResumeMarker', () => {
  const store = new Map<string, string>();
  const originalOs = Platform.OS;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  beforeEach(() => {
    // The marker is a web-only (home-screen app) feature.
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
    store.clear();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOs });
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as any).localStorage;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  });

  it('remembers and forgets a walk per device, without location data', () => {
    expect(wasTrackingGpsOnThisDevice('w1')).toBe(false);
    markGpsTrackingOnThisDevice('w1');
    expect(wasTrackingGpsOnThisDevice('w1')).toBe(true);
    expect(wasTrackingGpsOnThisDevice('w2')).toBe(false);
    expect([...store.values()].every((value) => /^\d+$/.test(value))).toBe(true);
    clearGpsTrackingMarker('w1');
    expect(wasTrackingGpsOnThisDevice('w1')).toBe(false);
  });

  it('never throws when storage is denied', () => {
    (globalThis as any).localStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(() => markGpsTrackingOnThisDevice('w1')).not.toThrow();
    expect(() => clearGpsTrackingMarker('w1')).not.toThrow();
    expect(wasTrackingGpsOnThisDevice('w1')).toBe(false);
  });

  it('reports granted only when the browser says so', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { permissions: { query: async () => ({ state: 'granted' }) } } });
    await expect(isGeolocationAlreadyGranted()).resolves.toBe(true);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { permissions: { query: async () => ({ state: 'prompt' }) } } });
    await expect(isGeolocationAlreadyGranted()).resolves.toBe(false);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { permissions: { query: async () => { throw new Error('unsupported'); } } } });
    await expect(isGeolocationAlreadyGranted()).resolves.toBe(false);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await expect(isGeolocationAlreadyGranted()).resolves.toBe(false);
  });
});
