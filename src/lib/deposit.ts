import type { SongLineage } from './lineage';
import {
  appendBlock,
  createGenesis,
  encodeLineage,
  extendLineage,
  findSaved,
  implicitLineage,
  normalizeAddress,
  verifyChain,
  type LibraryChain,
} from './lineage';
import type { RemoteSession } from './remoteLibrary';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.mp4', '.flac', '.wav', '.aac', '.ogg', '.opus', '.wma']);

export interface DepositResult {
  lineage: SongLineage;
  localId: string;
  where: 'server' | 'folder';
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function safeSongPath(songId: string): string | null {
  if (!songId || songId.includes('\0') || songId.includes('\\')) return null;
  const normalized = songId.replace(/^\.\/+/, '').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '.')) return null;
  if (!AUDIO_EXTENSIONS.has(extensionOf(normalized))) return null;
  return normalized.split('/').map((part) => part.replace(/^\.+/, '').trim().slice(0, 180)).filter(Boolean).join('/');
}

export function incomingPath(sourceAddress: string, songId: string): string | null {
  const relative = safeSongPath(songId);
  const source = normalizeAddress(sourceAddress);
  if (!relative || !source) return null;
  let host = 'library';
  try {
    host = new URL(source).host.replace(/[^a-zA-Z0-9._-]/g, '_');
  } catch {
    host = 'library';
  }
  return `Incoming/${host}/${relative}`;
}

async function readFolderChain(dir: FileSystemDirectoryHandle): Promise<LibraryChain | null> {
  try {
    const folder = await dir.getDirectoryHandle('.kytunes');
    const handle = await folder.getFileHandle('chain.json');
    const chain = JSON.parse(await (await handle.getFile()).text()) as LibraryChain;
    if (!await verifyChain(chain)) return null;
    return chain;
  } catch {
    return null;
  }
}

async function writeFolderChain(dir: FileSystemDirectoryHandle, chain: LibraryChain): Promise<void> {
  const folder = await dir.getDirectoryHandle('.kytunes', { create: true });
  const handle = await folder.getFileHandle('chain.json', { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(chain));
  await writable.close();
}

async function writeNestedFile(dir: FileSystemDirectoryHandle, relativePath: string, data: Blob): Promise<void> {
  const parts = relativePath.split('/');
  let current = dir;
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  const handle = await current.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function writableFolder(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const handle = dir as FileSystemDirectoryHandle & {
    queryPermission?: (opts: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: string }) => Promise<PermissionState>;
  };
  try {
    if (handle.queryPermission && await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
    if (handle.requestPermission && await handle.requestPermission({ mode: 'readwrite' }) === 'granted') return true;
  } catch {
    return false;
  }
  return false;
}

/** Record that this folder was loaded at `address`, the first time that chain is missing. */
export async function ensureFolderChain(dir: FileSystemDirectoryHandle, address: string): Promise<LibraryChain | null> {
  const existing = await readFolderChain(dir);
  if (existing) return existing;
  if (!await writableFolder(dir)) return null;
  try {
    const chain = await createGenesis(address);
    await writeFolderChain(dir, chain);
    return chain;
  } catch {
    return null;
  }
}

export function lineageForSong(chain: LibraryChain | null, songId: string): SongLineage | undefined {
  if (!chain) return undefined;
  return implicitLineage(chain, songId);
}

async function depositToServer(session: RemoteSession, blob: Blob, sourceAddress: string, sourceSongId: string, prior: SongLineage | null): Promise<DepositResult | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': blob.type || 'application/octet-stream',
    'X-KyTunes-Source': sourceAddress,
    'X-KyTunes-Song-Id': encodeURIComponent(sourceSongId),
  };
  if (prior) headers['X-KyTunes-Lineage'] = encodeLineage(prior);
  const base = session.baseUrl ? session.baseUrl.replace(/\/$/, '') : '';
  let res: Response;
  try {
    res = await fetch(`${base}/api/ingest`, { method: 'POST', headers, body: blob });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json() as { localId?: string; lineage?: SongLineage };
  const lineage = data.lineage;
  if (!lineage?.originAddress || !data.localId) return null;
  return { lineage, localId: data.localId, where: 'server' };
}

async function depositToFolder(dir: FileSystemDirectoryHandle, blob: Blob, sourceAddress: string, sourceSongId: string, prior: SongLineage | null, localAddress: string): Promise<DepositResult | null> {
  if (!await writableFolder(dir)) return null;
  const localId = incomingPath(sourceAddress, sourceSongId);
  if (!localId) return null;
  let chain = await readFolderChain(dir);
  if (!chain) chain = await createGenesis(localAddress);
  const draft = extendLineage({
    prior,
    sourceAddress,
    sourceSongId,
    localAddress: chain.genesisAddress,
  });
  const existing = findSaved(chain, draft.originAddress, draft.originSongId);
  if (existing) {
    return { lineage: implicitLineage(chain, existing), localId: existing, where: 'folder' };
  }
  const block = await appendBlock(chain, { address: sourceAddress, songId: sourceSongId, localId });
  const lineage = { ...draft, blockHash: block.hash };
  chain.files[localId] = lineage;
  await writeNestedFile(dir, localId, blob);
  await writeFolderChain(dir, chain);
  return { lineage, localId, where: 'folder' };
}

export async function depositIncoming(input: {
  blob: Blob;
  sourceAddress: string;
  sourceSongId: string;
  prior: SongLineage | null;
  localSession?: RemoteSession;
  dirHandle?: FileSystemDirectoryHandle | null;
  localAddress: string;
}): Promise<DepositResult | null> {
  if (input.localSession) {
    const saved = await depositToServer(input.localSession, input.blob, input.sourceAddress, input.sourceSongId, input.prior);
    if (saved) return saved;
  }
  if (input.dirHandle) {
    return depositToFolder(input.dirHandle, input.blob, input.sourceAddress, input.sourceSongId, input.prior, input.localAddress);
  }
  return null;
}

export function rememberedLineage(sourceAddress: string, sourceSongId: string, prior: SongLineage | null, localAddress: string): SongLineage | null {
  try {
    return extendLineage({ prior, sourceAddress, sourceSongId, localAddress });
  } catch {
    return null;
  }
}
