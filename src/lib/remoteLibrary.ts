import type { Song, SongLineage } from '../types';
import { decodeLineage } from './lineage';

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

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isTailnetHost(hostname: string): boolean {
  return hostname.endsWith('.ts.net');
}

/**
 * Turns what someone typed into a server origin. A bare host gets https:// when the
 * page itself is HTTPS or the host is a Tailscale name, and http:// otherwise.
 */
export function normalizeServerUrl(input: string, pageProtocol = window.location.protocol): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  let url: URL;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      url = new URL(trimmed);
    } else {
      const guess = new URL(`http://${trimmed}`);
      const secure = pageProtocol === 'https:' || isTailnetHost(guess.hostname);
      url = new URL(`${secure ? 'https' : 'http'}://${trimmed}`);
    }
  } catch {
    throw new Error('Enter the library server address, including http:// or https://');
  }
  // Browsers block http:// requests from an https:// page, except to this computer.
  if (pageProtocol === 'https:' && url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error('This page is HTTPS, so the browser blocks http:// servers. Use the library\'s https:// Tailscale address (run npm run share on the library computer).');
  }
  return url.origin;
}

function unreachableMessage(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.protocol === 'https:' && isTailnetHost(url.hostname) && url.port) {
      return `Could not reach that server. Tailscale Serve answers at https://${url.hostname} without :${url.port}.`;
    }
    if (isTailnetHost(url.hostname)) {
      return 'Could not reach that server. Check that Tailscale is connected on this device and that npm run share is running on the library computer.';
    }
  } catch {
    // same-origin library
  }
  return 'Could not reach that server.';
}

export async function probeLibrary(session: RemoteSession): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(session.baseUrl, '/api/health'), { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return false;
    const data = await res.json() as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
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
    throw new Error(unreachableMessage(baseUrl));
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
  const data = await res.json().catch(() => ({})) as Partial<RemoteLibraryPayload> & { error?: string; songs?: Array<Song & { lineage?: Song['lineage'] }> };
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

/**
 * Stream URL for a Chromecast. It cannot use a Tailscale name, so the library is asked
 * for its home-network address. Older servers without that answer get the usual address.
 */
export async function castStreamUrlFor(session: RemoteSession, songId: string): Promise<string> {
  try {
    const res = await fetch(apiUrl(session.baseUrl, '/api/cast-address'), {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = await res.json() as { urls?: string[] };
      const lan = data.urls?.[0];
      if (lan) return streamUrlFor({ ...session, baseUrl: lan }, songId);
    }
  } catch {
    // Fall through to the address this device uses.
  }
  return streamUrlFor(session, songId);
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
): Promise<{ blob: Blob; lineage: SongLineage | null }> {
  const res = await fetch(streamUrlFor(session, songId), { signal });
  if (res.status === 401) throw new RemoteAuthError();
  if (!res.ok || !res.body) throw new Error('Could not download that song.');
  const lineage = decodeLineage(res.headers.get('X-KyTunes-Lineage'));
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
  return { blob: new Blob(chunks as BlobPart[], { type }), lineage };
}
