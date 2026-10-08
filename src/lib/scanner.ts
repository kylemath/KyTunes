import * as mm from 'music-metadata';
import type { Song } from '../types';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.mp4', '.flac', '.wav', '.aac', '.ogg', '.opus', '.wma']);

// App data that macOS keeps in ~/Music, plus package bundles that are not a listening library.
const APP_DIR_NAMES = new Set(['garageband', 'logic', 'audio music apps', 'mainstage']);
const BUNDLE_SUFFIXES = ['.musiclibrary', '.app', '.band', '.logicx', '.bundle', '.photoslibrary', '.tvlibrary'];

function shouldSkipDirectory(name: string, atRoot: boolean): boolean {
  if (name.startsWith('.')) return true;
  const lower = name.toLowerCase();
  if (BUNDLE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  return atRoot && APP_DIR_NAMES.has(lower);
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(0, idx) : name;
}

/**
 * iTunes-style libraries are typically organized as:
 *   Artist/Album/01 Song.mp3
 * We use the path segments to infer metadata instantly.
 */
function inferFromPath(path: string, fileName: string): { title: string; artist: string; album: string } {
  const parts = path.split('/');
  const title = stripExtension(fileName).replace(/^\d+[\s.\-_]+/, '');

  if (parts.length >= 3) {
    return { artist: parts[parts.length - 3], album: parts[parts.length - 2], title };
  }
  if (parts.length >= 2) {
    return { artist: parts[parts.length - 2], album: 'Unknown Album', title };
  }
  return { artist: 'Unknown Artist', album: 'Unknown Album', title };
}

export interface FileEntry {
  path: string;
  handle: FileSystemFileHandle;
}

/**
 * Phase 1: Walk the directory tree as fast as possible.
 * Returns Song objects with metadata inferred from file paths.
 * No file reads or ID3 parsing — this is nearly instant even for 10k+ files.
 */
export async function collectFiles(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (count: number) => void
): Promise<Song[]> {
  const songs: Song[] = [];

  async function walk(handle: FileSystemDirectoryHandle, currentPath: string) {
    try {
      for await (const entry of (handle as any).values()) {
        if (shouldSkipDirectory(entry.name, currentPath === '')) continue;
        if (entry.kind === 'file') {
          if (AUDIO_EXTENSIONS.has(getExtension(entry.name))) {
            const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            const inferred = inferFromPath(fullPath, entry.name);
            songs.push({
              id: fullPath,
              title: inferred.title,
              artist: inferred.artist,
              album: inferred.album,
              duration: 0,
              source: 'local',
              fileHandle: entry as FileSystemFileHandle,
            });
            if (onProgress && songs.length % 200 === 0) {
              onProgress(songs.length);
            }
          }
        } else if (entry.kind === 'directory') {
          const childPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
          await walk(entry as FileSystemDirectoryHandle, childPath);
        }
      }
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'SecurityError') return;
      throw error;
    }
  }

  await walk(dirHandle, '');
  return songs;
}

const BATCH_SIZE = 50;
const YIELD_MS = 4; // yield to the browser between batches

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Phase 2: Parse ID3 tags in small batches, yielding to the main thread
 * between each batch so the UI stays responsive. Calls onBatch with
 * updated Song objects after each batch completes.
 */
export async function parseMetadataInBackground(
  songs: Song[],
  onBatch: (updated: Map<string, Partial<Song>>) => void,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  let done = 0;
  const total = songs.length;

  for (let i = 0; i < songs.length; i += BATCH_SIZE) {
    if (signal?.aborted) return;

    const batch = songs.slice(i, i + BATCH_SIZE);
    const updates = new Map<string, Partial<Song>>();

    await Promise.all(
      batch.map(async (song) => {
        try {
          if (!song.fileHandle) return;
          const file = await song.fileHandle.getFile();
          const metadata = await mm.parseBlob(file, { duration: true, skipCovers: true });

          const update: Partial<Song> = {};

          // ── Core tags ──────────────────────────────────────────────────────
          if (metadata.common.title) update.title = metadata.common.title;
          if (metadata.common.artist || metadata.common.albumartist) {
            update.artist = metadata.common.artist || metadata.common.albumartist!;
          }
          if (metadata.common.album) update.album = metadata.common.album;
          if (metadata.format.duration) update.duration = metadata.format.duration;
          if (metadata.common.track?.no) update.trackNumber = metadata.common.track.no;
          if (metadata.common.track?.of) update.totalTracks = metadata.common.track.of;
          if (metadata.common.year) update.year = metadata.common.year;
          if (metadata.common.genre?.[0]) update.genre = metadata.common.genre[0];

          // ── Extended tags ──────────────────────────────────────────────────
          if (metadata.common.albumartist) update.albumArtist = metadata.common.albumartist;
          if (metadata.common.composer?.[0]) update.composer = metadata.common.composer[0];
          if (metadata.common.disk?.no) update.diskNumber = metadata.common.disk.no;
          if (metadata.common.disk?.of) update.totalDiscs = metadata.common.disk.of;
          if (metadata.common.bpm) update.bpm = metadata.common.bpm;
          const common = metadata.common as unknown as Record<string, unknown>;
          if (common.initialkey) update.initialKey = String(common.initialkey);
          if (metadata.common.isrc) update.isrc = Array.isArray(metadata.common.isrc) ? metadata.common.isrc[0] : metadata.common.isrc;
          if (metadata.common.copyright) update.copyright = metadata.common.copyright;
          if (metadata.common.encodedby) update.encodedBy = metadata.common.encodedby;
          if (metadata.common.encodersettings) update.encoderSettings = metadata.common.encodersettings;
          const commentText = (metadata.common.comment as Array<{ text?: string }> | undefined)?.[0]?.text;
          if (commentText) update.comment = commentText;
          if (metadata.common.label?.[0]) update.label = metadata.common.label[0];
          const lyricsText = (metadata.common.lyrics as Array<{ text?: string }> | undefined)?.[0]?.text;
          if (lyricsText) update.lyrics = lyricsText;
          const rgt = (metadata.common.replaygain_track_gain as { dB?: number } | undefined)?.dB;
          if (rgt != null) update.replayGainTrack = rgt;
          const rga = (metadata.common.replaygain_album_gain as { dB?: number } | undefined)?.dB;
          if (rga != null) update.replayGainAlbum = rga;
          if (metadata.common.language) update.language = metadata.common.language;
          if (common.mood) update.mood = String(common.mood);
          if (metadata.common.musicbrainz_recordingid) update.musicbrainzRecordingId = metadata.common.musicbrainz_recordingid;
          if (metadata.common.musicbrainz_albumid) update.musicbrainzAlbumId = metadata.common.musicbrainz_albumid;
          if (metadata.common.musicbrainz_artistid?.[0]) update.musicbrainzArtistId = metadata.common.musicbrainz_artistid[0];
          if (metadata.common.musicbrainz_albumartistid?.[0]) update.musicbrainzAlbumArtistId = metadata.common.musicbrainz_albumartistid[0];

          // ── Format / technical ─────────────────────────────────────────────
          if (metadata.format.container) update.container = metadata.format.container;
          if (metadata.format.codec) update.codec = metadata.format.codec;
          if (metadata.format.bitrate) update.bitrate = metadata.format.bitrate;
          if (metadata.format.sampleRate) update.sampleRate = metadata.format.sampleRate;
          if (metadata.format.numberOfChannels) update.channels = metadata.format.numberOfChannels;
          if (metadata.format.lossless != null) update.lossless = metadata.format.lossless;
          if (metadata.format.codecProfile) update.codecProfile = metadata.format.codecProfile;

          if (Object.keys(update).length > 0) {
            updates.set(song.id, update);
          }
        } catch {
          // path-inferred metadata is already good enough
        }
      })
    );

    done += batch.length;
    if (updates.size > 0) {
      onBatch(updates);
    }
    if (onProgress) {
      onProgress(done, total);
    }

    // Yield to the browser so the UI thread can paint
    await sleep(YIELD_MS);
  }
}
