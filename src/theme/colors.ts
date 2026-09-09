/**
 * Warm, calm, family-friendly palette. Status colors are deliberately soft
 * (no harsh saturated red) per the "gentle, clear colors" design requirement.
 */
export const colors = {
  // Layered surfaces keep hierarchy clear without introducing a cold,
  // dashboard-like gray palette.
  background: '#FBF8F3',
  surface: '#FFFFFF',
  surfaceMuted: '#F3EEE4',
  border: '#EAE2D3',

  textPrimary: '#2E2A24',
  textSecondary: '#8A8171',
  textInverse: '#FFFFFF',

  primary: '#20A7B5',
  primaryDark: '#0B5C75',
  primarySoft: '#E4F7F8',
  accent: '#F2994A',

  // Semantic aliases are the public design-system vocabulary. Existing
  // status names remain intact so screen migrations can be incremental.
  info: '#5B8DEF',
  infoSoft: '#E9F0FF',
  success: '#2F9E5B',
  successSoft: '#E6F5EC',
  warning: '#B76A1F',
  warningSoft: '#FFF1DF',
  danger: '#C74A3C',
  dangerSoft: '#FBE7E4',

  statusPending: '#B8AF9C',
  statusPendingBg: '#F3EEE4',
  statusCurrent: '#5B8DEF',
  statusCurrentBg: '#E9F0FF',
  statusDone: '#2F9E5B',
  statusDoneBg: '#E6F5EC',
  // "לא בוצע" — final, resolved "not done" state (the ✕ counterpart of ✓ done).
  // Filled/saturated red so it reads clearly distinct from the lighter,
  // outlined statusOverdue below (an unresolved, still-actionable state).
  statusSkipped: '#C74A3C',
  statusSkippedBg: '#FBE7E4',
  // "ממתין לעדכון" — a pending walk whose time passed but is NOT yet
  // resolved either way. Intentionally softer/lighter than statusSkipped so
  // the two red-ish states stay visually distinguishable at a glance.
  statusOverdue: '#D9705C',
  statusOverdueBg: '#FBEAE6',

  shadow: '#00000022',
} as const;

export const userPalette = ['#5B8DEF', '#F2994A', '#27AE60', '#BB6BD9', '#EB5757', '#2D9CDB'];
