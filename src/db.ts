import { get, set, del } from 'idb-keyval';
import type { PlaybackPreferences, PlayHistoryState, Playlist, Song } from './types';
import type { RemoteSession } from './lib/remoteLibrary';

const DIRECTORY_HANDLE_KEY = 'music_directory_handle';
const SONGS_CACHE_KEY = 'music_songs_cache';
const PLAYLISTS_KEY = 'music_playlists';
const PLAY_HISTORY_KEY = 'music_play_history';
const PLAYBACK_PREFERENCES_KEY = 'music_playback_preferences';

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle) {
  await set(DIRECTORY_HANDLE_KEY, handle);
}

export async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return await get(DIRECTORY_HANDLE_KEY);
}

// We can't easily serialize FileSystemFileHandle in the cache alongside the rest of the song,
// but actually, IndexedDB *can* store FileSystemFileHandle!
export async function saveSongsCache(songs: any[]) {
  await set(SONGS_CACHE_KEY, songs);
}

export async function getSongsCache(): Promise<any[] | undefined> {
  return await get(SONGS_CACHE_KEY);
}

export async function getPlaylists(): Promise<Playlist[]> {
  const list = await get<Playlist[]>(PLAYLISTS_KEY);
  return list ?? [];
}

export async function savePlaylists(playlists: Playlist[]) {
  await set(PLAYLISTS_KEY, playlists);
}

export async function getPlayHistory(): Promise<PlayHistoryState> {
  const history = await get<PlayHistoryState>(PLAY_HISTORY_KEY);
  return history ?? { entries: [], stats: {} };
}

export async function savePlayHistory(history: PlayHistoryState) {
  await set(PLAY_HISTORY_KEY, history);
}

export async function getPlaybackPreferences(): Promise<PlaybackPreferences> {
  const prefs = await get<PlaybackPreferences>(PLAYBACK_PREFERENCES_KEY);
  return {
    shuffleOn: prefs?.shuffleOn ?? false,
    repeatMode: prefs?.repeatMode ?? 'off',
    showSongDetails: prefs?.showSongDetails ?? true,
  };
}

export async function savePlaybackPreferences(preferences: PlaybackPreferences): Promise<void> {
  await set(PLAYBACK_PREFERENCES_KEY, preferences);
}

// ── Album artwork (stored as Blob, keyed per album) ─────────────────────────
// Each album gets its own IndexedDB entry so reads are O(1) and we never
// load unrelated artwork when the user switches songs.

function artworkDbKey(artist: string, album: string): string {
  return `artwork_blob::${artist.toLowerCase().trim()}::${album.toLowerCase().trim()}`;
}

export async function getArtworkBlob(artist: string, album: string): Promise<Blob | undefined> {
  return await get<Blob>(artworkDbKey(artist, album));
}

export async function saveArtworkBlob(artist: string, album: string, blob: Blob): Promise<void> {
  await set(artworkDbKey(artist, album), blob);
}

// ── Artist images ─────────────────────────────────────────────────────────────
// Artist image CDNs (e.g. TheAudioDB's r2.theaudiodb.com) don't send
// Access-Control-Allow-Origin headers, so we can't fetch() their blobs.
// <img src> loads cross-origin images fine without CORS, so we store the
// URL string instead of a blob and let the browser handle the network request.

function artistUrlDbKey(artist: string): string {
  return `artist_url::${artist.toLowerCase().trim()}`;
}

export async function getArtistUrl(artist: string): Promise<string | undefined> {
  return await get<string>(artistUrlDbKey(artist));
}

export async function saveArtistUrl(artist: string, url: string): Promise<void> {
  await set(artistUrlDbKey(artist), url);
}

// ── Artist grouping overrides ─────────────────────────────────────────────────
// Record<variantName, canonicalName> — populated by the LLM grouping feature
// or by manual edits.  Applied on top of local normalization in artistNorm.ts.

const QUEUE_KEY = 'music_queue';

export async function getQueue(): Promise<string[]> {
  return (await get<string[]>(QUEUE_KEY)) ?? [];
}

export async function saveQueue(songIds: string[]): Promise<void> {
  await set(QUEUE_KEY, songIds);
}

const ARTIST_OVERRIDES_KEY = 'artist_group_overrides';

export async function getArtistGroupOverrides(): Promise<Record<string, string>> {
  return (await get<Record<string, string>>(ARTIST_OVERRIDES_KEY)) ?? {};
}

export async function saveArtistGroupOverrides(
  overrides: Record<string, string>,
): Promise<void> {
  await set(ARTIST_OVERRIDES_KEY, overrides);
}

// ── Where the library comes from ─────────────────────────────────────────────
// 'choose' means the welcome screen should stay up even if a folder was saved.

const LIBRARY_SOURCE_KEY = 'music_library_source';
const REMOTE_SESSION_KEY = 'music_remote_session';
const REMOTE_SONGS_CACHE_KEY = 'music_remote_songs_cache';
const KEPT_IDS_KEY = 'music_kept_song_ids';

export type LibrarySource = 'local' | 'remote' | 'choose';

export async function getLibrarySource(): Promise<LibrarySource | undefined> {
  return await get<LibrarySource>(LIBRARY_SOURCE_KEY);
}

export async function saveLibrarySource(source: LibrarySource): Promise<void> {
  await set(LIBRARY_SOURCE_KEY, source);
}

export async function getRemoteSession(): Promise<RemoteSession | undefined> {
  return await get<RemoteSession>(REMOTE_SESSION_KEY);
}

export async function saveRemoteSession(session: RemoteSession): Promise<void> {
  await set(REMOTE_SESSION_KEY, session);
}

export async function getRemoteSongsCache(): Promise<Song[] | undefined> {
  return await get<Song[]>(REMOTE_SONGS_CACHE_KEY);
}

export async function saveRemoteSongsCache(songs: Song[]): Promise<void> {
  const plain = songs.map((song) => {
    const copy: Song = { ...song };
    delete copy.fileHandle;
    delete copy.streamUrl;
    return copy;
  });
  await set(REMOTE_SONGS_CACHE_KEY, plain);
}

function keptAudioKey(songId: string): string {
  return `kept_audio::${songId}`;
}

export async function getKeptSongIds(): Promise<string[]> {
  return (await get<string[]>(KEPT_IDS_KEY)) ?? [];
}

export async function getKeptAudio(songId: string): Promise<Blob | undefined> {
  return await get<Blob>(keptAudioKey(songId));
}

export async function saveKeptAudio(songId: string, blob: Blob): Promise<void> {
  await set(keptAudioKey(songId), blob);
  const ids = new Set(await getKeptSongIds());
  ids.add(songId);
  await set(KEPT_IDS_KEY, [...ids]);
}

export async function deleteKeptAudio(songId: string): Promise<void> {
  await del(keptAudioKey(songId));
  const ids = (await getKeptSongIds()).filter((id) => id !== songId);
  await set(KEPT_IDS_KEY, ids);
}
