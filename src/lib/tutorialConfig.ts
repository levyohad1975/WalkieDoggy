/**
 * First-run video tutorial — configurable asset sources.
 *
 * No final video URL is hard-coded anywhere: every source comes from an
 * EXPO_PUBLIC_TUTORIAL_* environment variable (same pattern as
 * EXPO_PUBLIC_SUPPORT_EMAIL). When nothing is configured the tutorial is
 * still reachable from Help, but the player shows its poster/highlights
 * fallback and the automatic first-run invitation is never offered.
 *
 * Expo only inlines `process.env.EXPO_PUBLIC_*` when each variable is read
 * with a literal member expression, so the default env object below spells
 * every name out explicitly. Tests pass their own object instead.
 */

export type TutorialRole = 'admin' | 'member';

export interface TutorialEnv {
  videoUrl?: string;
  videoUrlAdmin?: string;
  videoUrlMember?: string;
  captionsUrl?: string;
  captionsUrlAdmin?: string;
  captionsUrlMember?: string;
  posterUrl?: string;
  autoOfferSince?: string;
}

export interface TutorialSource {
  /** Playable video URL, or null when none is configured for this role. */
  videoUrl: string | null;
  /** WebVTT Hebrew captions, or null. */
  captionsUrl: string | null;
  /** Poster image URL, or null to use the bundled approved mascot. */
  posterUrl: string | null;
  role: TutorialRole;
}

export function readTutorialEnv(): TutorialEnv {
  return {
    videoUrl: process.env.EXPO_PUBLIC_TUTORIAL_VIDEO_URL,
    videoUrlAdmin: process.env.EXPO_PUBLIC_TUTORIAL_VIDEO_URL_ADMIN,
    videoUrlMember: process.env.EXPO_PUBLIC_TUTORIAL_VIDEO_URL_MEMBER,
    captionsUrl: process.env.EXPO_PUBLIC_TUTORIAL_CAPTIONS_URL,
    captionsUrlAdmin: process.env.EXPO_PUBLIC_TUTORIAL_CAPTIONS_URL_ADMIN,
    captionsUrlMember: process.env.EXPO_PUBLIC_TUTORIAL_CAPTIONS_URL_MEMBER,
    posterUrl: process.env.EXPO_PUBLIC_TUTORIAL_POSTER_URL,
    autoOfferSince: process.env.EXPO_PUBLIC_TUTORIAL_AUTO_OFFER_SINCE,
  };
}

/**
 * Accepts only https:// URLs or same-origin absolute paths ("/tutorial/x.mp4").
 * Anything else (blank, http://, javascript:, data:, relative) is treated as
 * not configured, so a typo can never inject an unexpected scheme.
 */
export function sanitizeTutorialUrl(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

export function resolveTutorialSource(role: TutorialRole | null | undefined, env: TutorialEnv = readTutorialEnv()): TutorialSource {
  const effectiveRole: TutorialRole = role === 'admin' ? 'admin' : 'member';
  const roleVideo = effectiveRole === 'admin' ? env.videoUrlAdmin : env.videoUrlMember;
  const roleCaptions = effectiveRole === 'admin' ? env.captionsUrlAdmin : env.captionsUrlMember;
  const roleVideoUrl = sanitizeTutorialUrl(roleVideo);
  return {
    role: effectiveRole,
    videoUrl: roleVideoUrl ?? sanitizeTutorialUrl(env.videoUrl),
    // Role-specific captions only pair with a role-specific cut; the generic
    // captions track pairs with the generic video.
    captionsUrl: roleVideoUrl
      ? sanitizeTutorialUrl(roleCaptions)
      : sanitizeTutorialUrl(env.captionsUrl),
    posterUrl: sanitizeTutorialUrl(env.posterUrl),
  };
}

/** Parsed rollout cutoff for the automatic invitation, or null when unset/invalid. */
export function resolveAutoOfferSince(env: TutorialEnv = readTutorialEnv()): number | null {
  const raw = (env.autoOfferSince ?? '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
