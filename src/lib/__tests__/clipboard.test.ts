/**
 * BATCH 4 (item E — Copy Family Code). Direct behavioral test of the
 * shared copyToClipboard() helper: real success/failure return value,
 * mocking only expo-clipboard's setStringAsync — no source-text scanning,
 * since this is plain, RN-free logic.
 */
describe('lib/clipboard — copyToClipboard', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('resolves true when Clipboard.setStringAsync succeeds', async () => {
    jest.doMock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
    const { copyToClipboard } = require('../clipboard');

    await expect(copyToClipboard('ABC123')).resolves.toBe(true);
  });

  it('resolves false (never throws) when Clipboard.setStringAsync rejects', async () => {
    jest.doMock('expo-clipboard', () => ({
      setStringAsync: jest.fn().mockRejectedValue(new Error('clipboard unavailable')),
    }));
    const { copyToClipboard } = require('../clipboard');

    await expect(copyToClipboard('ABC123')).resolves.toBe(false);
  });

  it('resolves false for an empty string without even calling the Clipboard API', async () => {
    const setStringAsync = jest.fn().mockResolvedValue(undefined);
    jest.doMock('expo-clipboard', () => ({ setStringAsync }));
    const { copyToClipboard } = require('../clipboard');

    await expect(copyToClipboard('')).resolves.toBe(false);
    expect(setStringAsync).not.toHaveBeenCalled();
  });

  it('passes the exact text through to setStringAsync', async () => {
    const setStringAsync = jest.fn().mockResolvedValue(undefined);
    jest.doMock('expo-clipboard', () => ({ setStringAsync }));
    const { copyToClipboard } = require('../clipboard');

    await copyToClipboard('WD-42');
    expect(setStringAsync).toHaveBeenCalledWith('WD-42');
  });
});
