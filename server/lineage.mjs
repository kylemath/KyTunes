/**
 * Append-only record of where a music folder came from and which libraries
 * it has streamed songs from. The block text and hash must match src/lib/lineage.ts.
 */

import { createHash } from 'node:crypto';

const GENESIS_PREV = '0'.repeat(64);

export function normalizeAddress(input) {
  if (typeof input !== 'string' || !input.trim()) return '';
  try {
    const withProto = /^https?:\/\//i.test(input.trim()) ? input.trim() : '';
    if (!withProto) return '';
    return new URL(withProto).origin;
  } catch {
    return '';
  }
}

export function blockPayload(block) {
  return `${block.index}\n${block.at}\n${block.address}\n${block.songId || ''}\n${block.localId || ''}\n${block.prevHash}`;
}

export function hashBlock(block) {
  return createHash('sha256').update(blockPayload(block)).digest('hex');
}

export function createGenesis(address, at = Date.now()) {
  const origin = normalizeAddress(address);
  if (!origin) throw new Error('The library address is missing.');
  const block = {
    index: 0,
    at,
    address: origin,
    songId: '',
    localId: '',
    prevHash: GENESIS_PREV,
    hash: '',
  };
  block.hash = hashBlock(block);
  return {
    version: 1,
    genesisAddress: origin,
    loadedAt: at,
    blocks: [block],
    files: {},
  };
}

export function verifyChain(chain) {
  if (!chain || chain.version !== 1 || !Array.isArray(chain.blocks) || chain.blocks.length === 0) return false;
  if (!chain.files || typeof chain.files !== 'object') return false;
  let prev = GENESIS_PREV;
  for (let i = 0; i < chain.blocks.length; i++) {
    const block = chain.blocks[i];
    if (!block || block.index !== i || block.prevHash !== prev) return false;
    if (block.hash !== hashBlock(block)) return false;
    prev = block.hash;
  }
  return chain.blocks[0].address === chain.genesisAddress;
}

export function appendBlock(chain, { address, songId = '', localId = '', at = Date.now() }) {
  const source = normalizeAddress(address);
  if (!source) throw new Error('The streamed library address is missing.');
  const prev = chain.blocks[chain.blocks.length - 1];
  const block = {
    index: prev.index + 1,
    at,
    address: source,
    songId,
    localId,
    prevHash: prev.hash,
    hash: '',
  };
  block.hash = hashBlock(block);
  chain.blocks.push(block);
  return block;
}

export function sanitizeLineage(value) {
  if (!value || typeof value !== 'object') return null;
  const originAddress = normalizeAddress(value.originAddress);
  const originSongId = typeof value.originSongId === 'string' ? value.originSongId.slice(0, 1024) : '';
  if (!originAddress || !originSongId) return null;
  if (!Array.isArray(value.addresses) || value.addresses.length === 0 || value.addresses.length > 64) return null;
  const addresses = [];
  for (const addr of value.addresses) {
    const norm = normalizeAddress(addr);
    if (!norm) return null;
    if (addresses[addresses.length - 1] !== norm) addresses.push(norm);
  }
  if (addresses[0] !== originAddress) return null;
  const blockHash = typeof value.blockHash === 'string' && /^[0-9a-f]{64}$/.test(value.blockHash) ? value.blockHash : '';
  return { originAddress, originSongId, addresses, blockHash };
}

export function extendLineage({ prior, sourceAddress, sourceSongId, localAddress, blockHash = '' }) {
  const source = normalizeAddress(sourceAddress);
  const local = normalizeAddress(localAddress);
  if (!source || !local) throw new Error('A library address is missing.');
  const priorOk = sanitizeLineage(prior);
  const originAddress = priorOk ? priorOk.originAddress : source;
  const originSongId = priorOk ? priorOk.originSongId : sourceSongId;
  if (!originSongId) throw new Error('The original song id is missing.');
  const addresses = [];
  const push = (addr) => {
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
  return { originAddress, originSongId, addresses, blockHash };
}

export function implicitLineage(chain, songId) {
  const saved = chain.files?.[songId];
  if (saved && sanitizeLineage(saved)) return saved;
  return {
    originAddress: chain.genesisAddress,
    originSongId: songId,
    addresses: [chain.genesisAddress],
    blockHash: chain.blocks[0].hash,
  };
}

export function findSaved(chain, originAddress, originSongId) {
  const origin = normalizeAddress(originAddress);
  for (const [localId, file] of Object.entries(chain.files || {})) {
    if (normalizeAddress(file.originAddress) === origin && file.originSongId === originSongId) return localId;
  }
  return '';
}

export function encodeLineage(lineage) {
  return Buffer.from(JSON.stringify(lineage)).toString('base64url');
}

export function decodeLineage(value) {
  if (typeof value !== 'string' || !value || value.length > 16384) return null;
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    return sanitizeLineage(JSON.parse(json));
  } catch {
    return null;
  }
}
