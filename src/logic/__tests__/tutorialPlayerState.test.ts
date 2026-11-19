import {
  classifyPlayRejection,
  initialTutorialPlayerState,
  showsTutorialFallback,
  tutorialPlayerReducer,
  type TutorialPlayerEvent,
  type TutorialPlayerState,
} from '../tutorialPlayerState';

function run(state: TutorialPlayerState, ...events: TutorialPlayerEvent[]): TutorialPlayerState {
  return events.reduce(tutorialPlayerReducer, state);
}

describe('tutorialPlayerState', () => {
  it('starts on the poster, never playing (no autoplay), with captions on and sound on', () => {
    expect(initialTutorialPlayerState(true)).toEqual({ status: 'ready', muted: false, captionsOn: true, errorKind: null });
  });

  it('uses the fallback when there is no source, and nothing makes it playable', () => {
    const s = initialTutorialPlayerState(false);
    expect(s.status).toBe('unavailable');
    expect(showsTutorialFallback(s.status)).toBe(true);
    expect(run(s, { type: 'REQUEST_PLAY' }, { type: 'PLAYING' }, { type: 'ONLINE' }).status).toBe('unavailable');
  });

  it('starts offline when the device is offline, and recovers to the poster when back online', () => {
    const s = initialTutorialPlayerState(true, false);
    expect(s.status).toBe('offline');
    expect(run(s, { type: 'REQUEST_PLAY' }).status).toBe('offline');
    expect(run(s, { type: 'ONLINE' }).status).toBe('ready');
  });

  it('walks through loading → playing → paused → playing → ended → replay', () => {
    let s = initialTutorialPlayerState(true);
    s = run(s, { type: 'REQUEST_PLAY' });
    expect(s.status).toBe('loading');
    s = run(s, { type: 'PLAYING' });
    expect(s.status).toBe('playing');
    s = run(s, { type: 'PAUSED' });
    expect(s.status).toBe('paused');
    s = run(s, { type: 'REQUEST_PLAY' }, { type: 'PLAYING' }, { type: 'ENDED' });
    expect(s.status).toBe('ended');
    s = run(s, { type: 'REPLAY' });
    expect(s.status).toBe('loading');
  });

  it('a refused start (iOS Safari NotAllowedError) waits for a tap instead of failing', () => {
    const s = run(initialTutorialPlayerState(true), { type: 'REQUEST_PLAY' }, { type: 'PLAY_BLOCKED' });
    expect(s.status).toBe('blocked');
    expect(showsTutorialFallback(s.status)).toBe(false);
    expect(run(s, { type: 'REQUEST_PLAY' }, { type: 'PLAYING' }).status).toBe('playing');
  });

  it('load and playback errors switch to the fallback; retry clears the error', () => {
    const errored = run(initialTutorialPlayerState(true), { type: 'REQUEST_PLAY' }, { type: 'ERROR', kind: 'load' });
    expect(errored).toMatchObject({ status: 'error', errorKind: 'load' });
    expect(showsTutorialFallback(errored.status)).toBe(true);
    expect(run(errored, { type: 'PLAYING' }).status).toBe('error');
    expect(run(errored, { type: 'REPLAY' })).toMatchObject({ status: 'loading', errorKind: null });
  });

  it('a network error recovers when connectivity returns', () => {
    const s = run(initialTutorialPlayerState(true), { type: 'ERROR', kind: 'network' });
    expect(run(s, { type: 'ONLINE' }).status).toBe('ready');
  });

  it('going offline mid-playback keeps playing from buffer', () => {
    const s = run(initialTutorialPlayerState(true), { type: 'REQUEST_PLAY' }, { type: 'PLAYING' }, { type: 'OFFLINE' });
    expect(s.status).toBe('playing');
  });

  it('toggles mute and captions', () => {
    const s = run(initialTutorialPlayerState(true), { type: 'TOGGLE_MUTE' }, { type: 'TOGGLE_CAPTIONS' });
    expect(s).toMatchObject({ muted: true, captionsOn: false });
  });

  it('classifies play() rejections', () => {
    expect(classifyPlayRejection({ name: 'NotAllowedError' })).toBe('blocked');
    expect(classifyPlayRejection({ name: 'AbortError' })).toBe('blocked');
    expect(classifyPlayRejection({ name: 'NotSupportedError' })).toBe('error');
    expect(classifyPlayRejection(null)).toBe('error');
  });
});
