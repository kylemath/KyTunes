import type { Song } from '../types';
import { demoSongs } from './demoLibrary';
import { streamUrlFor, type RemoteSession } from './remoteLibrary';

/** Songs that live on this device: demos, a chosen folder, and downloaded tracks. */
export const LOCAL_LIBRARY_ID = '0';

export interface ConnectedLibrary {
  id: string;
  name: string;
  baseUrl: string;
  session: RemoteSession;
  songs: Song[];
  /** True only after this session has reached the server. Not saved. */
  reachable?: boolean;
  scanning?: boolean;
  enriching?: boolean;
}

export interface KeptSongRecord {
  /** Player id. Also the key for the saved audio. */
  id: string;
  remoteId: string;
  originLibraryId: string;
  baseUrl: string;
  song: Song;
}

export function libraryName(baseUrl: string): string {
  if (!baseUrl) return 'This computer';
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function nextLibraryId(libraries: { id: string }[]): string {
  const nums = libraries.map((library) => Number(library.id)).filter((n) => Number.isInteger(n) && n > 0);
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

export function playerSongId(libraryId: string, remoteId: string): string {
  return `${libraryId}:${remoteId}`;
}

function withoutRuntimeFields(song: Song): Song {
  const copy: Song = { ...song };
  delete copy.fileHandle;
  delete copy.streamUrl;
  return copy;
}

export function plainLibrary(library: ConnectedLibrary): ConnectedLibrary {
  const stored: ConnectedLibrary = { ...library, songs: library.songs.map(withoutRuntimeFields) };
  delete stored.reachable;
  return stored;
}

export function plainKeptRecord(record: KeptSongRecord): KeptSongRecord {
  return { ...record, song: withoutRuntimeFields({ ...record.song, libraryId: LOCAL_LIBRARY_ID, source: 'local' }) };
}

export function mergeCatalog(input: {
  folderSongs: Song[];
  kept: KeptSongRecord[];
  libraries: ConnectedLibrary[];
}): Song[] {
  const demos = demoSongs().map((song) => ({ ...song, libraryId: LOCAL_LIBRARY_ID, source: 'local' as const }));
  const folder = input.folderSongs.map((song) => ({
    ...song,
    libraryId: LOCAL_LIBRARY_ID,
    source: 'local' as const,
  }));
  const keptSongs = input.kept.map((record) => ({
    ...record.song,
    id: record.id,
    libraryId: LOCAL_LIBRARY_ID,
    originLibraryId: record.originLibraryId,
    remoteId: record.remoteId,
    source: 'local' as const,
    streamUrl: undefined,
    fileHandle: undefined,
  }));
  const keptKeys = new Set(input.kept.map((record) => `${record.originLibraryId}:${record.remoteId}`));
  const keptOrigins = new Set(input.kept.flatMap((record) => {
    const lineage = record.song.lineage;
    return lineage ? [`${lineage.originAddress}\n${lineage.originSongId}`] : [];
  }));
  const remote: Song[] = [];
  for (const library of input.libraries) {
    // Keep listing an unreachable library's last known songs, so the list does not
    // vanish when the connection drops. They are marked offline until it comes back.
    const offline = library.reachable === false;
    for (const song of library.songs) {
      const remoteId = song.remoteId || song.id;
      if (keptKeys.has(`${library.id}:${remoteId}`)) continue;
      if (song.lineage && keptOrigins.has(`${song.lineage.originAddress}\n${song.lineage.originSongId}`)) continue;
      remote.push({
        ...song,
        id: playerSongId(library.id, remoteId),
        remoteId,
        libraryId: library.id,
        source: 'remote',
        offline,
        fileHandle: undefined,
        streamUrl: streamUrlFor(library.session, remoteId),
      });
    }
  }
  const seen = new Set<string>();
  const all = [...keptSongs, ...folder, ...demos, ...remote];
  return all.filter((song) => {
    if (seen.has(song.id)) return false;
    seen.add(song.id);
    return true;
  });
}
