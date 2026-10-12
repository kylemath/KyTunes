import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendBlock,
  createGenesis,
  decodeLineage,
  encodeLineage,
  extendLineage,
  findSaved,
  implicitLineage,
  verifyChain,
} from './lineage.mjs';

test('a new folder records the address it was first loaded on', () => {
  const chain = createGenesis('http://library.local:8787', 1000);
  assert.equal(verifyChain(chain), true);
  assert.equal(chain.blocks.length, 1);
  assert.equal(chain.blocks[0].address, 'http://library.local:8787');
  const original = implicitLineage(chain, 'Artist/Album/song.mp3');
  assert.equal(original.originAddress, 'http://library.local:8787');
  assert.equal(original.originSongId, 'Artist/Album/song.mp3');
  assert.deepEqual(original.addresses, ['http://library.local:8787']);
});

test('an incoming stream extends the chain back to the original library', () => {
  const chain = createGenesis('http://client.local:4173', 1000);
  const prior = {
    originAddress: 'http://origin.local:8787',
    originSongId: 'Artist/Album/song.mp3',
    addresses: ['http://origin.local:8787', 'http://middle.local:8787'],
    blockHash: 'a'.repeat(64),
  };
  const block = appendBlock(chain, {
    address: 'http://middle.local:8787',
    songId: prior.originSongId,
    localId: 'Incoming/middle.local_8787/Artist/Album/song.mp3',
    at: 2000,
  });
  const lineage = extendLineage({
    prior,
    sourceAddress: 'http://middle.local:8787',
    sourceSongId: 'Artist/Album/song.mp3',
    localAddress: chain.genesisAddress,
    blockHash: block.hash,
  });
  chain.files[block.localId] = lineage;
  assert.equal(verifyChain(chain), true);
  assert.equal(chain.blocks[1].prevHash, chain.blocks[0].hash);
  assert.equal(chain.blocks[1].address, 'http://middle.local:8787');
  assert.deepEqual(lineage.addresses, [
    'http://origin.local:8787',
    'http://middle.local:8787',
    'http://client.local:4173',
  ]);
  assert.equal(lineage.originSongId, 'Artist/Album/song.mp3');
  assert.equal(findSaved(chain, lineage.originAddress, lineage.originSongId), block.localId);
  assert.deepEqual(decodeLineage(encodeLineage(lineage)), lineage);
});

test('a changed block breaks the chain', () => {
  const chain = createGenesis('http://library.local:8787', 1000);
  appendBlock(chain, { address: 'http://other.local:8787', songId: 'a.mp3', localId: 'Incoming/a.mp3', at: 2000 });
  chain.blocks[1].address = 'http://forged.local:8787';
  assert.equal(verifyChain(chain), false);
});
