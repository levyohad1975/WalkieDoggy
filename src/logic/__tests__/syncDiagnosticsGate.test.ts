import { shouldShowStagingSyncDiagnostics } from '../syncDiagnosticsGate';

describe('Staging sync diagnostics gate', () => {
  it('shows diagnostics only for a System Admin on the dedicated Staging project', () => {
    expect(shouldShowStagingSyncDiagnostics(true, 'https://czbxhsoxyawprqehkfit.supabase.co')).toBe(true);
    expect(shouldShowStagingSyncDiagnostics(false, 'https://czbxhsoxyawprqehkfit.supabase.co')).toBe(false);
    expect(shouldShowStagingSyncDiagnostics(true, 'https://zxolmnkevbtorxmcyvnz.supabase.co')).toBe(false);
    expect(shouldShowStagingSyncDiagnostics(true, 'https://czbxhsoxyawprqehkfit.supabase.co.evil.example')).toBe(false);
    expect(shouldShowStagingSyncDiagnostics(true, 'not-a-url')).toBe(false);
  });
});
