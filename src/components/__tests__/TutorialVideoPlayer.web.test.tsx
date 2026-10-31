import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TutorialVideoPlayer } from '../tutorial/TutorialVideoPlayer';
import type { TutorialSource } from '../../lib/tutorialConfig';

/**
 * iPhone Safari / Android Chrome (web) contract for the tutorial player.
 * The DOM <video> is replaced by a node mock so play()/pause()/load() and
 * media events can be driven deterministically.
 */

const SOURCE: TutorialSource = {
  role: 'member',
  videoUrl: '/tutorial/member.mp4',
  captionsUrl: '/tutorial/member.he.vtt',
  posterUrl: null,
};

type MockVideo = {
  play: jest.Mock;
  pause: jest.Mock;
  load: jest.Mock;
  currentTime: number;
  muted: boolean;
  error: { code?: number } | null;
  textTracks: { mode: string }[];
};

function makeVideo(play: () => Promise<void> = () => Promise.resolve()): MockVideo {
  return { play: jest.fn(play), pause: jest.fn(), load: jest.fn(), currentTime: 12, muted: false, error: null, textTracks: [{ mode: 'disabled' }] };
}

function renderPlayer(video: MockVideo, props: Partial<React.ComponentProps<typeof TutorialVideoPlayer>> = {}) {
  const onEnded = jest.fn();
  const onClose = jest.fn();
  render(
    <TutorialVideoPlayer source={SOURCE} platformOS="web" initialOnline onEnded={onEnded} onClose={onClose} {...props} />,
    { createNodeMock: (element: { type: unknown }) => (element.type === 'video' ? video : null) },
  );
  const videoNode = () => screen.UNSAFE_root.findAll((n: { type: unknown }) => n.type === 'video')[0];
  return { onEnded, onClose, videoNode };
}

const flush = () => act(async () => { await new Promise((resolve) => setImmediate(resolve)); });

describe('TutorialVideoPlayer (web: iPhone Safari / Android Chrome)', () => {
  it('renders an inline, metadata-only, non-autoplaying <video> without native controls', () => {
    const video = makeVideo();
    const { videoNode } = renderPlayer(video);
    const props = videoNode().props;
    expect(props.playsInline).toBe(true);
    expect(props['webkit-playsinline']).toBe('true');
    expect(props.preload).toBe('metadata');
    expect(props.controls).toBe(false);
    expect(props.autoPlay).toBeUndefined();
    expect(props.muted).toBeUndefined();
    expect(props.src).toBe('/tutorial/member.mp4');
    expect(video.play).not.toHaveBeenCalled();
    expect(screen.getByTestId('tutorial-player-big-play')).toBeTruthy();
  });

  it('starts only when opened by an explicit tap', async () => {
    const video = makeVideo();
    renderPlayer(video, { startOnMount: true });
    await flush();
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('a refused start (NotAllowedError) leaves the poster with a play button instead of an error', async () => {
    const video = makeVideo(() => Promise.reject(Object.assign(new Error('gesture'), { name: 'NotAllowedError' })));
    renderPlayer(video, { startOnMount: true });
    await flush();
    expect(screen.getByTestId('tutorial-player-big-play')).toBeTruthy();
    expect(screen.queryByTestId('tutorial-fallback-error')).toBeNull();
  });

  it('play/pause, mute and captions controls drive the element', async () => {
    const video = makeVideo();
    const { videoNode } = renderPlayer(video);
    fireEvent.press(screen.getByTestId('tutorial-player-toggle'));
    expect(video.play).toHaveBeenCalledTimes(1);
    act(() => { videoNode().props.onPlaying(); });
    expect(screen.getByLabelText('השהיית הסרטון')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tutorial-player-toggle'));
    expect(video.pause).toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('tutorial-player-mute'));
    expect(video.muted).toBe(true);

    expect(video.textTracks[0].mode).toBe('showing');
    fireEvent.press(screen.getByTestId('tutorial-player-captions'));
    expect(video.textTracks[0].mode).toBe('hidden');
  });

  it('ships a Hebrew captions track', () => {
    const video = makeVideo();
    const { videoNode } = renderPlayer(video);
    const track = videoNode().findAll((n: { type: unknown }) => n.type === 'track')[0];
    expect(track.props).toMatchObject({ kind: 'captions', srcLang: 'he', src: '/tutorial/member.he.vtt' });
  });

  it('ended → reports completion and offers replay from the start', async () => {
    const video = makeVideo();
    const { videoNode, onEnded } = renderPlayer(video);
    act(() => { videoNode().props.onEnded(); });
    expect(onEnded).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('tutorial-player-replay'));
    expect(video.currentTime).toBe(0);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('a load error switches to the fallback; retry reloads and plays', () => {
    const video = makeVideo();
    const { videoNode } = renderPlayer(video);
    video.error = { code: 4 };
    act(() => { videoNode().props.onError(); });
    expect(screen.getByTestId('tutorial-fallback-error')).toBeTruthy();
    // The close action is never blocked by an error.
    expect(screen.getByTestId('tutorial-player-close')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tutorial-player-retry'));
    expect(screen.queryByTestId('tutorial-fallback-error')).toBeNull();
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('starts in the offline fallback when the device is offline', () => {
    const video = makeVideo();
    renderPlayer(video, { initialOnline: false });
    expect(screen.getByTestId('tutorial-fallback-offline')).toBeTruthy();
    expect(video.play).not.toHaveBeenCalled();
  });

  it('shows the "coming soon" fallback when no video is configured', () => {
    render(<TutorialVideoPlayer source={{ ...SOURCE, videoUrl: null, captionsUrl: null }} platformOS="web" initialOnline />);
    expect(screen.getByTestId('tutorial-fallback-unavailable')).toBeTruthy();
  });

  it('close works while playing and pauses on unmount', () => {
    const video = makeVideo();
    const { onClose } = renderPlayer(video);
    fireEvent.press(screen.getByTestId('tutorial-player-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    screen.unmount();
    expect(video.pause).toHaveBeenCalled();
  });
});
