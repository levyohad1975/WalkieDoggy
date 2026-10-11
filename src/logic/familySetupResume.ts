/**
 * A device-local onboarding draft is not authorization to switch tenants.
 * Resume it only when the server-confirmed family context already matches.
 */
export function canResumeFamilySetupDraft(progressFamilyId: string, serverFamilyId: string | null | undefined): boolean {
  return Boolean(progressFamilyId && serverFamilyId && progressFamilyId === serverFamilyId);
}
