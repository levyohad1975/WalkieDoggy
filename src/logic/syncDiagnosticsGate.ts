/** Only System Admin identities in the dedicated Staging Supabase project may view local sync diagnostics. */
export function shouldShowStagingSyncDiagnostics(isSystemAdmin: boolean, projectUrl: string): boolean {
  if (!isSystemAdmin) return false;
  try {
    const url = new URL(projectUrl);
    return url.protocol === 'https:' && url.hostname === 'czbxhsoxyawprqehkfit.supabase.co' && !url.username && !url.password;
  } catch {
    return false;
  }
}
