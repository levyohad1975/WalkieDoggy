/**
 * The approved clean mascot master is not yet present in this repository.
 * These references are deliberately metadata only: until approved artwork is
 * supplied, every runtime consumer keeps the existing branded fallback.
 */
export const CLEAN_MASCOT_MASTER_ASSET = {
  expectedPath: 'assets/branding/walkie-doggy-mascot-clean.png',
  status: 'pending-approved-clean-mascot-artwork' as const,
  fallbackPath: 'assets/branding/walkie-doggy-mascot.png',
  requirements: 'PNG, transparent background, no embedded wordmark or text, same approved Walkie Doggy Link character.',
};

/** Exact assets/entry points to replace only after the approved clean master arrives. */
export const CLEAN_MASCOT_REPLACEMENT_TARGETS = [
  'src/components/WalkieMascot.tsx',
  'src/components/celebrationAssets.ts',
  'src/components/ReminderMascotPrompt.tsx',
  'src/mascot/celebrationAnimationManifest.ts',
  'assets/icon.png',
  'assets/adaptive-icon.png',
  'assets/favicon.png',
] as const;
