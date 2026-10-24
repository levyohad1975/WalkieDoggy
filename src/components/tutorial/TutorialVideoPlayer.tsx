import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { Image, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { RtlText } from '../RtlText';
import { colors } from '../../theme/colors';
import { layout, radii, spacing, typography } from '../../theme/tokens';
import type { TutorialSource } from '../../lib/tutorialConfig';
import {
  classifyPlayRejection,
  initialTutorialPlayerState,
  showsTutorialFallback,
  tutorialPlayerReducer,
  type TutorialPlayerStatus,
} from '../../logic/tutorialPlayerState';

/**
 * Reusable, responsive tutorial video player.
 *
 * Web (Safari iPhone / Android Chrome / desktop): a DOM <video> with
 * playsinline (no forced iOS fullscreen), preload="metadata", our own
 * Hebrew controls, and a native <track> for captions. Nothing autoplays —
 * playback is attempted only when `startOnMount` reflects an explicit user
 * tap, and a refused start (NotAllowedError) falls back to the poster with a
 * play button.
 *
 * Native builds: no video dependency is bundled, so the poster + highlights
 * fallback is shown. Missing configuration, load/playback errors and offline
 * use the same fallback, which never blocks the close action.
 */

const MASCOT_POSTER = require('../../../assets/branding/walkie-doggy-mascot-transparent.png');

export interface TutorialVideoPlayerProps {
  source: TutorialSource;
  /** True only when the player was opened by an explicit user tap. */
  startOnMount?: boolean;
  onEnded?: () => void;
  onClose?: () => void;
  /** Test seam; defaults to Platform.OS. */
  platformOS?: string;
  /** Test seam; defaults to navigator.onLine on web. */
  initialOnline?: boolean;
}

type DomVideo = {
  play: () => Promise<void> | void;
  pause: () => void;
  load: () => void;
  currentTime: number;
  muted: boolean;
  error?: { code?: number } | null;
  textTracks?: ArrayLike<{ mode: string }>;
};

const MEDIA_ERR_NETWORK = 2;
// DOM host tags (react-native-web renders them through react-dom). Typed as
// plain strings so the element props are not checked against HTMLElement,
// whose ref type would not match the narrow DomVideo interface above.
const VIDEO_TAG: string = 'video';
const TRACK_TAG: string = 'track';

export function tutorialHighlights(role: TutorialSource['role']): string[] {
  const shared = [
    'במסך הבית רואים את הטיול הבא, השעה ומי אחראי עליו.',
    'יוצאים לטיול עם ״התחל טיול״ ומסיימים עם ״סיים טיול״.',
    'לא מסתדר? ״בקש החלפה״ עם בן משפחה או ״בקש שינוי שעה״ מהמנהלים.',
    'בלו״ז רואים היום, מחר והשבוע; היסטוריה ונתונים — לפי ההרשאות במשפחה.',
  ];
  return role === 'admin'
    ? [...shared, 'כמנהלים: מוסיפים בני משפחה, קובעים תפקידים, בונים לו״ז ומעדכנים את פרטי הכלב.']
    : [...shared, 'את בני המשפחה והלו״ז מגדירים מנהלי המשפחה.'];
}

function fallbackMessage(status: TutorialPlayerStatus): string {
  if (status === 'offline') return 'אין חיבור לאינטרנט כרגע. אפשר לצפות בהדרכה כשהחיבור יחזור.';
  if (status === 'error') return 'לא הצלחנו לטעון את הסרטון. אפשר לנסות שוב או להמשיך לאפליקציה.';
  return 'סרטון ההדרכה יהיה זמין בקרוב. בינתיים, הנה עיקרי הדברים:';
}

function readOnline(initialOnline: boolean | undefined, isWeb: boolean): boolean {
  if (typeof initialOnline === 'boolean') return initialOnline;
  if (isWeb && typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') return navigator.onLine;
  return true;
}

export function TutorialVideoPlayer({ source, startOnMount = false, onEnded, onClose, platformOS, initialOnline }: TutorialVideoPlayerProps) {
  const isWeb = (platformOS ?? Platform.OS) === 'web';
  const hasSource = isWeb && Boolean(source.videoUrl);
  const [state, dispatch] = useReducer(tutorialPlayerReducer, undefined, () =>
    initialTutorialPlayerState(hasSource, readOnline(initialOnline, isWeb)));
  const videoRef = useRef<DomVideo | null>(null);
  const startedRef = useRef(false);
  const { width, height } = useWindowDimensions();

  // Portrait screen recording (9:16), bounded so controls stay on screen.
  const maxVideoHeight = Math.max(220, Math.min(height * 0.62, 640));
  const videoWidth = Math.min(width - spacing.lg * 2, (maxVideoHeight * 9) / 16, 420);
  const videoHeight = (videoWidth * 16) / 9;

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    dispatch({ type: 'REQUEST_PLAY' });
    try {
      const result = video.play();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error: unknown) => {
          dispatch(classifyPlayRejection(error) === 'blocked' ? { type: 'PLAY_BLOCKED' } : { type: 'ERROR', kind: 'playback' });
        });
      }
    } catch (error) {
      dispatch(classifyPlayRejection(error) === 'blocked' ? { type: 'PLAY_BLOCKED' } : { type: 'ERROR', kind: 'playback' });
    }
  }, []);

  const pause = useCallback(() => {
    try { videoRef.current?.pause(); } catch { /* element gone */ }
  }, []);

  const replay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    dispatch({ type: 'REPLAY' });
    try { video.currentTime = 0; } catch { /* not seekable yet */ }
    play();
  }, [play]);

  // The fallback replaces the <video>, so a retry re-mounts it first and the
  // effect below reloads + starts it once the new element is attached.
  const pendingRetryRef = useRef(false);
  const retry = useCallback(() => {
    pendingRetryRef.current = true;
    dispatch({ type: 'REPLAY' });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!pendingRetryRef.current || !video || state.status !== 'loading') return;
    pendingRetryRef.current = false;
    try { video.load(); } catch { /* ignore */ }
    play();
  }, [state.status, play]);

  // Pause whenever the element detaches (close, profile switch, fallback),
  // so audio can never continue behind the app.
  const attachVideo = useCallback((node: DomVideo | null) => {
    if (!node && videoRef.current) {
      try { videoRef.current.pause(); } catch { /* ignore */ }
    }
    videoRef.current = node;
  }, []);

  // Explicit-tap start only, evaluated once at mount. It never fires later
  // (e.g. when connectivity returns) and never for a passive mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!hasSource || !startOnMount || state.status !== 'ready') return;
    play();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = state.muted;
  }, [state.muted, state.status]);

  useEffect(() => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;
    for (let i = 0; i < tracks.length; i += 1) tracks[i].mode = state.captionsOn ? 'showing' : 'hidden';
  }, [state.captionsOn, state.status]);

  useEffect(() => {
    if (!isWeb || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const online = () => dispatch({ type: 'ONLINE' });
    const offline = () => dispatch({ type: 'OFFLINE' });
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [isWeb]);

  const fallback = showsTutorialFallback(state.status);
  const playing = state.status === 'playing' || state.status === 'loading';
  const ended = state.status === 'ended';
  const posterSource = source.posterUrl ? { uri: source.posterUrl } : MASCOT_POSTER;

  return (
    <View style={styles.root} testID="tutorial-player">
      {onClose ? (
        <View style={styles.topRow}>
          <Pressable onPress={onClose} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="סגירת ההדרכה" hitSlop={8} testID="tutorial-player-close">
            <RtlText style={styles.iconGlyph}>✕</RtlText>
          </Pressable>
        </View>
      ) : null}

      {fallback ? (
        <View style={[styles.fallback, { width: Math.min(width - spacing.lg * 2, 480) }]} testID={`tutorial-fallback-${state.status}`}>
          <Image source={posterSource} style={styles.fallbackPoster} resizeMode="contain" accessibilityIgnoresInvertColors accessible={false} />
          <RtlText style={styles.fallbackTitle} accessibilityRole="header" accessibilityLiveRegion="polite">{fallbackMessage(state.status)}</RtlText>
          <View style={styles.highlights}>
            {tutorialHighlights(source.role).map((line) => (
              <RtlText key={line} style={styles.highlight}>• {line}</RtlText>
            ))}
          </View>
          {state.status === 'error' ? (
            <Pressable onPress={retry} style={styles.secondaryButton} accessibilityRole="button" accessibilityLabel="ניסיון חוזר לטעינת הסרטון" testID="tutorial-player-retry">
              <RtlText style={styles.secondaryButtonText}>נסו שוב</RtlText>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={[styles.videoFrame, { width: videoWidth, height: videoHeight }]}>
          {React.createElement(
            VIDEO_TAG,
            {
              ref: attachVideo,
              src: source.videoUrl ?? undefined,
              poster: source.posterUrl ?? undefined,
              playsInline: true,
              'webkit-playsinline': 'true',
              preload: 'metadata',
              controls: false,
              // Lower-case: passed through to the DOM as plain attributes.
              controlslist: 'nodownload noplaybackrate',
              disablepictureinpicture: '',
              crossOrigin: source.captionsUrl && /^https:/i.test(source.captionsUrl) ? 'anonymous' : undefined,
              'aria-label': 'סרטון הדרכה של Walkie Doggy',
              'data-testid': 'tutorial-video',
              style: { width: '100%', height: '100%', objectFit: 'contain', backgroundColor: colors.surfaceMuted, borderRadius: radii.lg },
              onWaiting: () => dispatch({ type: 'WAITING' }),
              onPlaying: () => dispatch({ type: 'PLAYING' }),
              onPause: () => dispatch({ type: 'PAUSED' }),
              onEnded: () => { dispatch({ type: 'ENDED' }); onEnded?.(); },
              onError: () => {
                const code = videoRef.current?.error?.code;
                dispatch({ type: 'ERROR', kind: code === MEDIA_ERR_NETWORK ? 'network' : 'load' });
              },
            },
            source.captionsUrl
              ? React.createElement(TRACK_TAG, { kind: 'captions', src: source.captionsUrl, srcLang: 'he', label: 'עברית', default: true })
              : null,
          )}
          {!playing && !ended ? (
            <Pressable onPress={play} style={styles.bigPlay} accessibilityRole="button" accessibilityLabel="הפעלת הסרטון" testID="tutorial-player-big-play">
              <RtlText style={styles.bigPlayGlyph}>▶</RtlText>
            </Pressable>
          ) : null}
        </View>
      )}

      {!fallback ? (
        <View style={styles.controls} accessibilityRole="toolbar">
          {ended ? (
            <ControlButton label="↺" a11y="צפייה חוזרת" onPress={replay} testID="tutorial-player-replay" />
          ) : (
            <ControlButton label={playing ? '❚❚' : '▶'} a11y={playing ? 'השהיית הסרטון' : 'הפעלת הסרטון'} onPress={playing ? pause : play} testID="tutorial-player-toggle" />
          )}
          <ControlButton label={state.muted ? '🔇' : '🔊'} a11y={state.muted ? 'ביטול השתקה' : 'השתקה'} onPress={() => dispatch({ type: 'TOGGLE_MUTE' })} testID="tutorial-player-mute" selected={state.muted} />
          {source.captionsUrl ? (
            <ControlButton label="CC" a11y={state.captionsOn ? 'הסתרת כתוביות' : 'הצגת כתוביות'} onPress={() => dispatch({ type: 'TOGGLE_CAPTIONS' })} testID="tutorial-player-captions" selected={state.captionsOn} />
          ) : null}
        </View>
      ) : null}
      {state.status === 'loading' ? (
        <RtlText style={styles.status} accessibilityLiveRegion="polite">טוען…</RtlText>
      ) : null}
    </View>
  );
}

function ControlButton({ label, a11y, onPress, testID, selected }: { label: string; a11y: string; onPress: () => void; testID: string; selected?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.control, selected && styles.controlSelected, pressed && styles.controlPressed]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={6}
      testID={testID}
    >
      <RtlText style={styles.controlGlyph}>{label}</RtlText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.md, width: '100%' },
  topRow: { width: '100%', flexDirection: 'row', justifyContent: 'flex-end' },
  iconButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.round,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  videoFrame: { borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  bigPlay: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigPlayGlyph: { color: colors.textInverse, fontSize: 28, fontWeight: '800', textAlign: 'center', writingDirection: 'ltr' },
  controls: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center', alignItems: 'center' },
  control: {
    minWidth: 52,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  controlPressed: { opacity: 0.7 },
  controlGlyph: { fontSize: 16, fontWeight: '800', color: colors.primaryDark, textAlign: 'center', writingDirection: 'ltr' },
  status: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },
  fallback: { backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, gap: spacing.md, alignItems: 'stretch' },
  fallbackPoster: { width: 120, height: 120, alignSelf: 'center' },
  fallbackTitle: { ...typography.sectionTitle, color: colors.textPrimary },
  highlights: { gap: spacing.sm },
  highlight: { ...typography.meta, fontSize: 14, lineHeight: 21, color: colors.textPrimary },
  secondaryButton: { minHeight: layout.buttonHeight, borderRadius: radii.md, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  secondaryButtonText: { ...typography.body, color: colors.primaryDark, textAlign: 'center' },
});
