/**
 * A device-local onboarding draft is not authorization to switch tenants.
 * Resume it only when the server-confirmed family context already matches.
 */
export function canResumeFamilySetupDraft(progressFamilyId: string, serverFamilyId: string | null | undefined): boolean {
  return Boolean(progressFamilyId && serverFamilyId && progressFamilyId === serverFamilyId);
}

/**
 * A local family id and admin-owned draft can both be stale after a profile
 * switch. Rendering onboarding therefore also requires an explicit server
 * family confirmation for this exact draft.
 */
export function canShowFamilySetupWizard(input: {
  progressFamilyId: string | null | undefined;
  localFamilyId: string | null | undefined;
  serverConfirmedFamilyId: string | null | undefined;
  ownerMatches: boolean;
  familyRole: string | null | undefined;
}): boolean {
  return Boolean(
    input.ownerMatches &&
    input.familyRole === 'admin' &&
    input.progressFamilyId &&
    input.progressFamilyId === input.localFamilyId &&
    canResumeFamilySetupDraft(input.progressFamilyId, input.serverConfirmedFamilyId)
  );
}
