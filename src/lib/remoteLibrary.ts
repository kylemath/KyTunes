import type { Song } from '../types';

export interface RemoteSession {
  /** Empty string means the page and the library are the same origin. */
  baseUrl: string;
  token: string;
  expiresAt: number;
}

export interface RemoteLibraryPayload {
  songs: Song[];
  scanning: boolean;
  enriching: boolean;
  enrichDone: number;
  enrichTotal: number;
}

export class RemoteAuthError extends Error {
  constructor(message = 'Sign in required.') {
    super(message);
    this.name = 'RemoteAuthError';
  }
}

function apiUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return new URL(withProto).origin;
  } catch {
    throw new Error('Enter the library server address, including http:// or https://');
  }
}

export async function probeSameOriginLibrary(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const data = await res.json() as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

export async function loginRemote(baseUrl: string, password: string): Promise<RemoteSession> {
  let res: Response;
  try {
    res = await fetch(apiUrl(baseUrl, '/api/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new Error('Could not reach that server.');
  }
  const data = await res.json().catch(() => ({})) as { error?: string; token?: string; expiresAt?: number };
  if (!res.ok || !data.token || !data.expiresAt) {
    throw new Error(data.error || `Sign-in failed (${res.status})`);
  }
  return { baseUrl, token: data.token, expiresAt: data.expiresAt };
}

export async function fetchRemoteLibrary(session: RemoteSession): Promise<RemoteLibraryPayload> {
  let res: Response;
  try {
    res = await fetch(apiUrl(session.baseUrl, '/api/library'), {
      headers: { Authorization: `Bearer ${session.token}` },
    });
  } catch {
    throw new Error('Could not reach the library server.');
  }
  const data = await res.json().catch(() => ({})) as Partial<RemoteLibraryPayload> & { error?: string };
  if (res.status === 401) throw new RemoteAuthError(data.error);
  if (!res.ok || !Array.isArray(data.songs)) {
    throw new Error(data.error || `Could not load the library (${res.status})`);
  }
  return {
    songs: data.songs,
    scanning: Boolean(data.scanning),
    enriching: Boolean(data.enriching),
    enrichDone: data.enrichDone ?? 0,
    enrichTotal: data.enrichTotal ?? 0,
  };
}

export async function requestRemoteRescan(session: RemoteSession): Promise<void> {
  const res = await fetch(apiUrl(session.baseUrl, '/api/rescan'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (res.status === 401) throw new RemoteAuthError();
  if (!res.ok) throw new Error('Could not rescan the library.');
}

export function streamUrlFor(session: RemoteSession, songId: string): string {
  const base = session.baseUrl || window.location.origin;
  const url = new URL('/api/stream', base.endsWith('/') ? base : `${base}/`);
  url.searchParams.set('id', songId);
  url.searchParams.set('token', session.token);
  return url.toString();
}

export function attachRemote(session: RemoteSession, songs: Song[]): Song[] {
  return songs.map((song) => ({
    ...song,
    source: 'remote',
    fileHandle: undefined,
    streamUrl: streamUrlFor(session, song.id),
  }));
}

export async function downloadRemoteSong(
  session: RemoteSession,
  songId: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(streamUrlFor(session, songId), { signal });
  if (res.status === 401) throw new RemoteAuthError();
  if (!res.ok || !res.body) throw new Error('Could not download that song.');
  const total = Number(res.headers.get('Content-Length') || 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
  }
  const type = res.headers.get('Content-Type') || 'audio/mpeg';
  return new Blob(chunks as BlobPart[], { type });
}
