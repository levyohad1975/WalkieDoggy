/**
 * Pure playback state for the tutorial video player.
 *
 * The DOM <video> element (web) only reports events; this reducer decides
 * what the UI shows. Keeping it pure makes loading/error/offline/replay
 * behaviour testable without a browser.
 */

export type TutorialPlayerStatus =
  /** No source for this platform/config: poster + highlights fallback. */
  | 'unavailable'
  /** Poster with a play button; nothing is playing (never autoplays). */
  | 'ready'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  /** The browser refused to start (e.g. iOS NotAllowedError): wait for a tap. */
  | 'blocked'
  | 'error'
  | 'offline';

export interface TutorialPlayerState {
  status: TutorialPlayerStatus;
  muted: boolean;
  captionsOn: boolean;
  /** Last error kind, for diagnostics/tests (never shown raw). */
  errorKind: 'load' | 'playback' | 'network' | null;
}

export type TutorialPlayerEvent =
  | { type: 'REQUEST_PLAY' }
  | { type: 'WAITING' }
  | { type: 'PLAYING' }
  | { type: 'PAUSED' }
  | { type: 'ENDED' }
  | { type: 'PLAY_BLOCKED' }
  | { type: 'ERROR'; kind: 'load' | 'playback' | 'network' }
  | { type: 'OFFLINE' }
  | { type: 'ONLINE' }
  | { type: 'REPLAY' }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'TOGGLE_CAPTIONS' };

export function initialTutorialPlayerState(hasSource: boolean, online = true): TutorialPlayerState {
  return {
    status: !hasSource ? 'unavailable' : online ? 'ready' : 'offline',
    muted: false,
    captionsOn: true,
    errorKind: null,
  };
}

export function tutorialPlayerReducer(state: TutorialPlayerState, event: TutorialPlayerEvent): TutorialPlayerState {
  if (state.status === 'unavailable') {
    // Nothing can make a missing source playable; only UI toggles apply.
    if (event.type === 'TOGGLE_CAPTIONS') return { ...state, captionsOn: !state.captionsOn };
    return state;
  }
  switch (event.type) {
    case 'REQUEST_PLAY':
      if (state.status === 'offline' || state.status === 'error') return state;
      return { ...state, status: state.status === 'paused' ? 'playing' : 'loading' };
    case 'WAITING':
      return state.status === 'playing' || state.status === 'loading' ? { ...state, status: 'loading' } : state;
    case 'PLAYING':
      if (state.status === 'error' || state.status === 'offline') return state;
      return { ...state, status: 'playing', errorKind: null };
    case 'PAUSED':
      return state.status === 'playing' || state.status === 'loading' ? { ...state, status: 'paused' } : state;
    case 'ENDED':
      return { ...state, status: 'ended' };
    case 'PLAY_BLOCKED':
      return { ...state, status: 'blocked' };
    case 'ERROR':
      return { ...state, status: 'error', errorKind: event.kind };
    case 'OFFLINE':
      // A playing video may continue from buffer; only idle states switch.
      return state.status === 'ready' || state.status === 'blocked' || state.status === 'error'
        ? { ...state, status: 'offline', errorKind: 'network' }
        : state;
    case 'ONLINE':
      return state.status === 'offline' || (state.status === 'error' && state.errorKind === 'network')
        ? { ...state, status: 'ready', errorKind: null }
        : state;
    case 'REPLAY':
      if (state.status === 'offline') return state;
      return { ...state, status: 'loading', errorKind: null };
    case 'TOGGLE_MUTE':
      return { ...state, muted: !state.muted };
    case 'TOGGLE_CAPTIONS':
      return { ...state, captionsOn: !state.captionsOn };
    default:
      return state;
  }
}

/** Whether the fallback (poster + highlights) panel replaces the video. */
export function showsTutorialFallback(status: TutorialPlayerStatus): boolean {
  return status === 'unavailable' || status === 'error' || status === 'offline';
}

/** Classifies a rejected HTMLMediaElement.play() promise. */
export function classifyPlayRejection(error: unknown): 'blocked' | 'error' {
  const name = (error as { name?: unknown } | null)?.name;
  // NotAllowedError: autoplay/gesture policy (iOS Safari, Chrome). AbortError:
  // a pause()/src change interrupted the start — harmless, wait for a tap.
  return name === 'NotAllowedError' || name === 'AbortError' ? 'blocked' : 'error';
}
