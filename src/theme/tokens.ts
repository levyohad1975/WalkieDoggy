import { Platform } from 'react-native';

/**
 * FINAL CORRECTION PASS — Deliverable 3A (design tokens).
 *
 * A small, real shared set of layout/typography constants, built on TOP of
 * the existing theme/colors.ts (not a second competing system — colors stay
 * exactly where they are; this file is only the SIZES/SPACING/SHAPES every
 * screen already informally converges on, made explicit and reusable).
 * Audited first: HomeScreen/ScheduleScreen/StatisticsScreen/SettingsScreen/
 * WalkRow/every *Modal.tsx already independently landed on very similar
 * numbers (16-20px screen padding, 16-18px card radius, 12-14px section
 * gaps, 48px+ button/row height, 1-1.5px hairline borders) — this file
 * names those numbers once instead of a sixth screen inventing its own
 * close-but-not-quite variant.
 *
 * Applied THIS pass to: StatisticsScreen (full redesign), SettingsScreen
 * (hybrid redesign — dog card, family section, grouped rows), and used for
 * new components added this pass (QA sandbox section, PIN modals). NOT yet
 * swept across every existing screen (Home/Schedule/History/Family keep
 * their own established, already-reasonable spacing/sizing this pass —
 * see the final report's honest per-area breakdown) — retrofitting a
 * working screen purely to match a token name, with no visible bug being
 * fixed, was judged lower value than finishing the screens that were
 * genuinely still using ad-hoc/inconsistent values.
 *
 * Identity: keep the friendly dog/family warmth (rounded corners, soft
 * borders, generous tap targets, no hard corporate edges) — tokens exist to
 * make that consistent, not to flatten it into something colder.
 */

export const spacing = {
  /** Tight gap inside a compact row (icon-to-label, chip padding). */
  xs: 4,
  /** Standard gap between related small elements. */
  sm: 8,
  /** Standard gap between a card's internal sections. */
  md: 12,
  /** Standard gap between sibling cards/sections on a screen. */
  lg: 16,
  /** Standard screen-edge margin. */
  xl: 20,
  /** Generous separation between major screen sections. */
  xxl: 28,
  /** Extra separation for screen heroes and major visual moments. */
  xxxl: 36,
} as const;

export const radii = {
  /** Chips, small badges, inputs. */
  sm: 10,
  /** Buttons, list rows. */
  md: 14,
  /** Cards. */
  lg: 18,
  /** Bottom sheets / modal cards, avatars-as-circles use 999. */
  xl: 24,
  round: 999,
} as const;

export const typography = {
  /** Brand/hero heading. Use sparingly, primarily for onboarding. */
  display: { fontSize: 30, lineHeight: 38, fontWeight: '800' as const },
  /** Screen title ("⚙️ הגדרות", "📈 סטטיסטיקה"). */
  screenTitle: { fontSize: 22, lineHeight: 30, fontWeight: '800' as const },
  /** Section/card heading within a screen. */
  sectionTitle: { fontSize: 16, lineHeight: 23, fontWeight: '700' as const },
  /** A card's own smaller heading (e.g. a KPI tile's label). */
  cardTitle: { fontSize: 14, lineHeight: 20, fontWeight: '700' as const },
  /** Primary row/list text (a member's name, a settings row's title). */
  body: { fontSize: 16, lineHeight: 23, fontWeight: '600' as const },
  /** Secondary/meta text (subtitle under a row, helper copy). */
  meta: { fontSize: 13, lineHeight: 19, fontWeight: '500' as const },
  /** Large numeric readout (a KPI tile's big number, a percent). */
  statValue: { fontSize: 26, lineHeight: 32, fontWeight: '800' as const },
  /** Small caption (badge text, tiny label). */
  caption: { fontSize: 11, lineHeight: 16, fontWeight: '700' as const },
} as const;

export const layout = {
  /** Standard tappable row height (settings rows, member rows). */
  rowHeight: 56,
  /** Standard button height. */
  buttonHeight: 48,
  /** Standard icon glyph size inside a row's leading icon slot. */
  iconSize: 22,
  /** Standard small avatar (list rows, compact member chips). */
  avatarSm: 32,
  /** Standard medium avatar (member detail headers). */
  avatarMd: 48,
  /** Standard large avatar/photo (dog card, profile headers). */
  avatarLg: 72,
  /** Standard screen content horizontal padding. */
  screenPadding: 20,
  /** Minimum target for a tappable control, per iOS/Android accessibility guidance. */
  minTouchTarget: 44,
} as const;

export const elevation = {
  /** Subtle card lift — this app avoids heavy shadows (flat, paper-like cards with a hairline border read as more "friendly household app", less "corporate dashboard"), so this is intentionally soft. */
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
} as const;

/** Responsive measurements. Keep layouts mobile-first; wide web viewports
 * should constrain readable content rather than stretch form controls. */
export const breakpoints = {
  phone: 599,
  tablet: 899,
  desktop: 1200,
  readingColumn: 640,
  desktopContent: 1120,
} as const;

/**
 * Pins a physical layout `direction` on native only. `direction` is a real,
 * correctly-typed RN `ViewStyle` property (required to anchor `flexDirection:
 * 'row'` to a fixed physical order regardless of the ambient RTL layout —
 * see Countdown.tsx for the original documented bug this fixes), but
 * react-native-web's own style validator unconditionally rejects and strips
 * it, logging a console.error on every render. Returning `{}` on web keeps
 * that a true no-op with no warning; native gets the exact same value as
 * before.
 */
export function nativeDirection(value: 'ltr' | 'rtl'): { direction?: 'ltr' | 'rtl' } {
  return Platform.OS === 'web' ? {} : { direction: value };
}

/** Motion timings are optional: non-essential motion must honor the OS
 * reduced-motion setting before it is played. */
export const motion = {
  feedback: 160,
  transition: 240,
  emphasis: 360,
  celebrationMax: 2400,
} as const;
