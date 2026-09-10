/**
 * Approved clean mascot master for in-app mascot surfaces. It preserves the
 * turquoise rounded-square composition and is intentionally opaque.
 */
export const CLEAN_MASCOT_MASTER_ASSET = {
  expectedPath: 'assets/branding/walkie-doggy-mascot-clean.png',
  status: 'approved-clean-mascot-master' as const,
  fallbackPath: 'assets/branding/walkie-doggy-mascot-clean.png',
  requirements: 'PNG, opaque turquoise rounded-square composition, no embedded wordmark or text, same approved Walkie Doggy Link character.',
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
