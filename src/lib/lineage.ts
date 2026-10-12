/**
 * Append-only record of where a music folder came from and which libraries
 * it has streamed songs from. The block text and hash must match server/lineage.mjs.
 */

import type { SongLineage } from '../types';

export type { SongLineage };

export interface ChainBlock {
  index: number;
  at: number;
  address: string;
  songId: string;
  localId: string;
  prevHash: string;
  hash: string;
}

export interface LibraryChain {
  version: 1;
  genesisAddress: string;
  loadedAt: number;
  blocks: ChainBlock[];
  files: Record<string, SongLineage>;
}

const GENESIS_PREV = '0'.repeat(64);

export function normalizeAddress(input: string): string {
  if (typeof input !== 'string' || !input.trim()) return '';
  try {
    const withProto = /^https?:\/\//i.test(input.trim()) ? input.trim() : '';
    if (!withProto) return '';
    return new URL(withProto).origin;
  } catch {
    return '';
  }
}

export function blockPayload(block: Pick<ChainBlock, 'index' | 'at' | 'address' | 'songId' | 'localId' | 'prevHash'>): string {
  return `${block.index}\n${block.at}\n${block.address}\n${block.songId || ''}\n${block.localId || ''}\n${block.prevHash}`;
}

export async function hashBlock(block: Pick<ChainBlock, 'index' | 'at' | 'address' | 'songId' | 'localId' | 'prevHash'>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(blockPayload(block)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createGenesis(address: string, at = Date.now()): Promise<LibraryChain> {
  const origin = normalizeAddress(address);
  if (!origin) throw new Error('The library address is missing.');
  const block: ChainBlock = {
    index: 0,
    at,
    address: origin,
    songId: '',
    localId: '',
    prevHash: GENESIS_PREV,
    hash: '',
  };
  block.hash = await hashBlock(block);
  return {
    version: 1,
    genesisAddress: origin,
    loadedAt: at,
    blocks: [block],
    files: {},
  };
}

export async function verifyChain(chain: LibraryChain): Promise<boolean> {
  if (!chain || chain.version !== 1 || !Array.isArray(chain.blocks) || chain.blocks.length === 0) return false;
  if (!chain.files || typeof chain.files !== 'object') return false;
  let prev = GENESIS_PREV;
  for (let i = 0; i < chain.blocks.length; i++) {
    const block = chain.blocks[i];
    if (!block || block.index !== i || block.prevHash !== prev) return false;
    if (block.hash !== await hashBlock(block)) return false;
    prev = block.hash;
  }
  return chain.blocks[0].address === chain.genesisAddress;
}

export async function appendBlock(chain: LibraryChain, input: { address: string; songId?: string; localId?: string; at?: number }): Promise<ChainBlock> {
  const source = normalizeAddress(input.address);
  if (!source) throw new Error('The streamed library address is missing.');
  const prev = chain.blocks[chain.blocks.length - 1];
  const block: ChainBlock = {
    index: prev.index + 1,
    at: input.at ?? Date.now(),
    address: source,
    songId: input.songId || '',
    localId: input.localId || '',
    prevHash: prev.hash,
    hash: '',
  };
  block.hash = await hashBlock(block);
  chain.blocks.push(block);
  return block;
}

export function sanitizeLineage(value: unknown): SongLineage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<SongLineage>;
  const originAddress = normalizeAddress(record.originAddress || '');
  const originSongId = typeof record.originSongId === 'string' ? record.originSongId.slice(0, 1024) : '';
  if (!originAddress || !originSongId) return null;
  if (!Array.isArray(record.addresses) || record.addresses.length === 0 || record.addresses.length > 64) return null;
  const addresses: string[] = [];
  for (const addr of record.addresses) {
    const norm = normalizeAddress(typeof addr === 'string' ? addr : '');
    if (!norm) return null;
    if (addresses[addresses.length - 1] !== norm) addresses.push(norm);
  }
  if (addresses[0] !== originAddress) return null;
  const blockHash = typeof record.blockHash === 'string' && /^[0-9a-f]{64}$/.test(record.blockHash) ? record.blockHash : '';
  return { originAddress, originSongId, addresses, blockHash };
}

export function extendLineage(input: {
  prior: SongLineage | null;
  sourceAddress: string;
  sourceSongId: string;
  localAddress: string;
  blockHash?: string;
}): SongLineage {
  const source = normalizeAddress(input.sourceAddress);
  const local = normalizeAddress(input.localAddress);
  if (!source || !local) throw new Error('A library address is missing.');
  const priorOk = sanitizeLineage(input.prior);
  const originAddress = priorOk ? priorOk.originAddress : source;
  const originSongId = priorOk ? priorOk.originSongId : input.sourceSongId;
  if (!originSongId) throw new Error('The original song id is missing.');
  const addresses: string[] = [];
  const push = (addr: string) => {
    const norm = normalizeAddress(addr);
    if (!norm || addresses[addresses.length - 1] === norm) return;
    addresses.push(norm);
  };
  push(originAddress);
  if (priorOk) {
    for (const addr of priorOk.addresses) push(addr);
  }
  push(source);
  push(local);
  return { originAddress, originSongId, addresses, blockHash: input.blockHash || '' };
}

export function implicitLineage(chain: LibraryChain, songId: string): SongLineage {
  const saved = sanitizeLineage(chain.files?.[songId]);
  if (saved) return saved;
  return {
    originAddress: chain.genesisAddress,
    originSongId: songId,
    addresses: [chain.genesisAddress],
    blockHash: chain.blocks[0].hash,
  };
}

export function findSaved(chain: LibraryChain, originAddress: string, originSongId: string): string {
  const origin = normalizeAddress(originAddress);
  for (const [localId, file] of Object.entries(chain.files || {})) {
    if (normalizeAddress(file.originAddress) === origin && file.originSongId === originSongId) return localId;
  }
  return '';
}

export function encodeLineage(lineage: SongLineage): string {
  const bytes = new TextEncoder().encode(JSON.stringify(lineage));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeLineage(value: string | null): SongLineage | null {
  if (!value || value.length > 16384) return null;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return sanitizeLineage(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
