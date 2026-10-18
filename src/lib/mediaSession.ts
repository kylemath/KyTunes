import type { Song } from '../types';

/**
 * Artwork for the system media card (Android notification shade, quick settings
 * media player, lock screen; macOS/Windows media overlays).
 *
 * The OS crops and blurs whatever it is given, so the card looks best with a
 * square, high-resolution image. Album art is centre-cropped to a square; songs
 * without art get a generated cover (a colour per album) instead of the
 * browser's grey placeholder.
 */

const SIZE = 512;
const cache = new Map<string, string>();

function hashHue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('artwork failed to load'));
    img.src = url;
  });
}

function newCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  return ctx ? [canvas, ctx] : null;
}

async function squareArtwork(url: string): Promise<string> {
  const img = await loadImage(url);
  const made = newCanvas();
  if (!made) return url;
  const [canvas, ctx] = made;
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function generatedArtwork(song: Song): string | null {
  const made = newCanvas();
  if (!made) return null;
  const [canvas, ctx] = made;
  const hue = hashHue(`${song.artist}\u0000${song.album}`);

  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, `hsl(${hue} 70% 45%)`);
  bg.addColorStop(1, `hsl(${(hue + 60) % 360} 65% 22%)`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Android lays its own title, artist and controls over the artwork, so the
  // cover carries no text: just vinyl rings and a note, centred.
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 6;
  for (let r = 48; r < SIZE; r += 40) {
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '700 200px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♫', SIZE / 2, SIZE / 2 + 8);

  // JPEG keeps the cover around 50 KB; a PNG of the gradient is ~450 KB, which
  // is a lot to hand the OS on every track change.
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function artworkFor(song: Song, albumArtworkUrl?: string): Promise<MediaImage[]> {
  const key = albumArtworkUrl ?? `gen:${song.id}`;
  let src = cache.get(key);
  if (!src) {
    if (albumArtworkUrl) {
      try {
        src = await squareArtwork(albumArtworkUrl);
      } catch {
        src = albumArtworkUrl;
      }
    } else {
      src = generatedArtwork(song) ?? undefined;
    }
    if (src) {
      cache.set(key, src);
      if (cache.size > 24) cache.delete(cache.keys().next().value as string);
    }
  }
  return src ? imagesFor(src) : [];
}

function imagesFor(src: string): MediaImage[] {
  const type = src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  return [{ src, sizes: `${SIZE}x${SIZE}`, type }];
}

let metadataRequest = 0;

/** Sets title, artist, album and artwork on the OS media card. */
export async function setMediaMetadata(song: Song | null, albumArtworkUrl?: string): Promise<void> {
  if (!('mediaSession' in navigator)) return;
  const request = ++metadataRequest;
  if (!song) {
    navigator.mediaSession.metadata = null;
    return;
  }
  const base = { title: song.title, artist: song.artist, album: song.album };
  const cached = cache.get(albumArtworkUrl ?? `gen:${song.id}`);
  if (cached) {
    navigator.mediaSession.metadata = new MediaMetadata({ ...base, artwork: imagesFor(cached) });
    return;
  }
  // Show text immediately, then add artwork once it is ready.
  navigator.mediaSession.metadata = new MediaMetadata(base);
  const artwork = await artworkFor(song, albumArtworkUrl);
  // A later call (next song, or this song's album art arriving) wins.
  if (request === metadataRequest) {
    navigator.mediaSession.metadata = new MediaMetadata({ ...base, artwork });
  }
}

/**
 * Keeps the scrubber on the OS media card in step with the player. The OS
 * advances it on its own while playbackState is 'playing', so this only needs
 * calling on load, seek, and play/pause.
 */
export function setMediaPosition(position: number, duration: number): void {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(position, 0), duration),
      playbackRate: 1,
    });
  } catch {
    // Some browsers reject position state while metadata is loading.
  }
}

export function setMediaActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // The action is not supported by this browser.
  }
}
