// Chromecast support through Google's Cast sender library (Chrome on desktop and Android).
// The Chromecast fetches and plays the audio itself, so it needs a URL it can reach on
// its own: never a blob: URL, and never a Tailscale name.

import { useSyncExternalStore } from 'react';

const SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

// ── The few pieces of the Cast library the player uses ───────────────────────
interface CastMediaSession { idleReason?: string | null }
interface CastSession {
  getCastDevice(): { friendlyName: string };
  getMediaSession(): CastMediaSession | null;
  loadMedia(request: unknown): Promise<unknown>;
  endSession(stopCasting: boolean): void;
}
interface CastContextLike {
  setOptions(options: Record<string, unknown>): void;
  addEventListener(type: string, handler: (event: { castState?: string; sessionState?: string }) => void): void;
  requestSession(): Promise<unknown>;
  getCurrentSession(): CastSession | null;
  getCastState(): string;
}
interface RemotePlayerLike {
  isConnected: boolean;
  isMediaLoaded: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  playerState: string | null;
}
interface RemotePlayerControllerLike {
  addEventListener(type: string, handler: (event: { field: string; value: unknown }) => void): void;
  playOrPause(): void;
  seek(): void;
}
interface CastFramework {
  CastContext: { getInstance(): CastContextLike };
  CastContextEventType: { CAST_STATE_CHANGED: string; SESSION_STATE_CHANGED: string };
  RemotePlayer: new () => RemotePlayerLike;
  RemotePlayerController: new (player: RemotePlayerLike) => RemotePlayerControllerLike;
  RemotePlayerEventType: { ANY_CHANGE: string };
}
interface ChromeCast {
  AutoJoinPolicy: { ORIGIN_SCOPED: string };
  Image: new (url: string) => unknown;
  media: {
    DEFAULT_MEDIA_RECEIVER_APP_ID: string;
    StreamType: { BUFFERED: string };
    MediaInfo: new (url: string, contentType: string) => { metadata?: unknown; streamType?: string };
    MusicTrackMediaMetadata: new () => { title?: string; artist?: string; albumName?: string; images?: unknown[] };
    LoadRequest: new (media: unknown) => { currentTime?: number; autoplay?: boolean };
  };
}
declare global {
  interface Window {
    __onGCastApiAvailable?: (available: boolean) => void;
    cast?: { framework: CastFramework };
    chrome?: { cast?: ChromeCast };
  }
}

// ── State the player reads ────────────────────────────────────────────────────
export interface CastState {
  /** A Chromecast is on the network (the button shows). */
  available: boolean;
  connecting: boolean;
  connected: boolean;
  deviceName: string;
  /** Position and state reported by the Chromecast. */
  currentTime: number;
  duration: number;
  paused: boolean;
}

let state: CastState = {
  available: false,
  connecting: false,
  connected: false,
  deviceName: '',
  currentTime: 0,
  duration: 0,
  paused: true,
};
const listeners = new Set<() => void>();
const endedListeners = new Set<() => void>();

let context: CastContextLike | null = null;
let player: RemotePlayerLike | null = null;
let controller: RemotePlayerControllerLike | null = null;
let started = false;

function update(patch: Partial<CastState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function setup() {
  const framework = window.cast?.framework;
  const chromeCast = window.chrome?.cast;
  if (!framework || !chromeCast) return;
  context = framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  const readCastState = (castState: string) => {
    update({
      available: castState !== 'NO_DEVICES_AVAILABLE',
      connecting: castState === 'CONNECTING',
    });
  };
  context.addEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, (event) => {
    if (event.castState) readCastState(event.castState);
  });
  readCastState(context.getCastState());
  // "Connected" waits for the session itself, so a song can be loaded onto it straight away.
  const readSession = () => {
    const session = context?.getCurrentSession() ?? null;
    update({ connected: Boolean(session), deviceName: session?.getCastDevice().friendlyName ?? '' });
  };
  context.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, (event) => {
    if (event.sessionState === 'SESSION_STARTED' || event.sessionState === 'SESSION_RESUMED') readSession();
    if (event.sessionState === 'SESSION_ENDED' || event.sessionState === 'SESSION_START_FAILED') {
      update({ connected: false, deviceName: '' });
    }
  });
  readSession();

  player = new framework.RemotePlayer();
  controller = new framework.RemotePlayerController(player);
  let lastTime = 0;
  controller.addEventListener(framework.RemotePlayerEventType.ANY_CHANGE, (event) => {
    if (!player) return;
    if (event.field === 'currentTime') lastTime = player.currentTime;
    if (event.field === 'playerState' && event.value === 'IDLE') {
      // IDLE also follows a new load or a stop. Only a song that played out counts as ended.
      const reason = context?.getCurrentSession()?.getMediaSession()?.idleReason;
      const nearEnd = state.duration > 0 && lastTime >= state.duration - 1.5;
      if (reason === 'FINISHED' || (!reason && nearEnd)) {
        lastTime = 0;
        for (const listener of endedListeners) listener();
      }
    }
    update({
      currentTime: player.currentTime || 0,
      duration: player.duration || state.duration,
      paused: player.isPaused || !player.isMediaLoaded || player.playerState === 'IDLE',
    });
  });
}

/** Loads Google's Cast library once. Browsers without Cast (Safari, Firefox) never show the button. */
export function startCast() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.__onGCastApiAvailable = (available) => {
    if (available) setup();
  };
  const script = document.createElement('script');
  script.src = SDK_URL;
  script.async = true;
  document.head.appendChild(script);
}

export function useCast(): CastState {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => state,
  );
}

/** Called when a song finishes playing on the Chromecast. */
export function onCastEnded(listener: () => void): () => void {
  endedListeners.add(listener);
  return () => endedListeners.delete(listener);
}

/** Opens the browser's device picker, or stops casting when already connected. */
export async function toggleCast() {
  if (!context) return;
  if (state.connected) {
    context.getCurrentSession()?.endSession(true);
    return;
  }
  try {
    await context.requestSession();
  } catch {
    // The picker was closed without choosing a device.
  }
}

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
};

export function contentTypeFor(name: string): string {
  const ext = name.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'audio/mpeg';
}

export async function castLoad(input: {
  url: string;
  contentType: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
  startAt: number;
  autoplay: boolean;
}) {
  const chromeCast = window.chrome?.cast;
  const session = context?.getCurrentSession();
  if (!chromeCast || !session) throw new Error('no Chromecast session');
  const media = new chromeCast.media.MediaInfo(input.url, input.contentType);
  media.streamType = chromeCast.media.StreamType.BUFFERED;
  const metadata = new chromeCast.media.MusicTrackMediaMetadata();
  metadata.title = input.title;
  metadata.artist = input.artist;
  metadata.albumName = input.album;
  // The Chromecast fetches the artwork too, so only a web address works.
  if (input.artworkUrl && /^https?:/.test(input.artworkUrl)) metadata.images = [new chromeCast.Image(input.artworkUrl)];
  media.metadata = metadata;
  const request = new chromeCast.media.LoadRequest(media);
  request.currentTime = input.startAt;
  request.autoplay = input.autoplay;
  update({ currentTime: input.startAt, paused: !input.autoplay });
  // Resolves with an error code on some versions of the library, and rejects with one on others.
  const result = await session.loadMedia(request);
  if (result) throw new Error(String((result as { code?: string }).code ?? result));
}

/** Readable text for an error from the Cast library, which is often a bare code. */
export function castErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const code = (error as { code?: string; description?: string } | null)?.code;
  const description = (error as { description?: string } | null)?.description;
  return [code, description].filter(Boolean).join(': ') || 'unknown error';
}

export function castSetPlaying(playing: boolean) {
  if (!player || !controller || !player.isMediaLoaded) return;
  if (player.isPaused === playing) controller.playOrPause();
}

export function castSeek(time: number) {
  if (!player || !controller) return;
  player.currentTime = time;
  controller.seek();
  update({ currentTime: time });
}
