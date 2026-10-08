/**
 * Personal music library server.
 *
 * Scans one folder, requires a shared password, and streams audio with HTTP
 * range requests so other computers and a phone can play without downloading
 * the whole library. When `dist/` exists it also serves the built player.
 *
 *   npm run library -- --dir ~/Music --password 'choose-a-password'
 */
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { parseFile } from 'music-metadata';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'library.config.json');
const cachePath = path.join(root, 'library.cache.json');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.mp4', '.flac', '.wav', '.aac', '.ogg', '.opus', '.wma']);
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ENRICH_CONCURRENCY = 4;

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const AUDIO_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
};

const state = {
  songs: [],
  byId: new Map(),
  scanning: false,
  enriching: false,
  enrichDone: 0,
  enrichTotal: 0,
  generation: 0,
};

const loginFailures = new Map();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') out.dir = argv[++i];
    else if (arg === '--password') out.password = argv[++i];
    else if (arg === '--port') out.port = Number(argv[++i]);
    else if (arg === '--host') out.host = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`Usage: npm run library -- --dir ~/Music --password 'choose-a-password'

Options:
  --dir       Music folder to scan (saved for next time)
  --password  Shared password for every device (stored only as a hash)
  --port      Listen port (default 8787)
  --host      Listen address (default 0.0.0.0)
`);
}

function scryptAsync(password, salt, length) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scryptAsync(password, salt, 32);
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

async function verifyPassword(password, saltB64, hashB64) {
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function promptHidden(label) {
  if (!process.stdin.isTTY) {
    throw new Error('Pass --password when this is not an interactive terminal.');
  }
  process.stderr.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let value = '';
  await new Promise((resolve) => {
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onData);
        process.stderr.write('\n');
        resolve();
        return;
      }
      if (ch === '\u0003') process.exit(1);
      if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += ch;
    };
    process.stdin.on('data', onData);
  });
  return value.trim();
}

async function loadConfig(args) {
  let existing = null;
  try {
    existing = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch {
    existing = null;
  }

  const musicDir = args.dir || process.env.LIBRARY_DIR || existing?.musicDir;
  let password = args.password || process.env.LIBRARY_PASSWORD || '';
  if (!password && !existing?.passwordHash) {
    try {
      password = await promptHidden('Library password: ');
    } catch (error) {
      console.error(error.message);
      printHelp();
      process.exit(1);
    }
  }
  if (!musicDir) {
    console.error('Choose the folder that holds your music.\n');
    printHelp();
    process.exit(1);
  }
  if (!password && !existing?.passwordHash) {
    console.error('A password is required the first time you start the server.\n');
    printHelp();
    process.exit(1);
  }

  const resolvedDir = path.resolve(musicDir);
  let dirStat;
  try {
    dirStat = await fs.stat(resolvedDir);
  } catch {
    console.error(`Music folder not found: ${resolvedDir}`);
    process.exit(1);
  }
  if (!dirStat.isDirectory()) {
    console.error(`Not a folder: ${resolvedDir}`);
    process.exit(1);
  }

  let passwordSalt = existing?.passwordSalt;
  let passwordHash = existing?.passwordHash;
  if (password) {
    const hashed = await hashPassword(password);
    passwordSalt = hashed.salt;
    passwordHash = hashed.hash;
  }

  const config = {
    musicDir: resolvedDir,
    passwordSalt,
    passwordHash,
    tokenSecret: existing?.tokenSecret || randomBytes(32).toString('base64'),
    port: args.port || existing?.port || 8787,
    host: args.host || existing?.host || '0.0.0.0',
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}

function signToken(secret, expiresAt) {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(secret, token) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

function extensionOf(name) {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function stripExtension(name) {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(0, idx) : name;
}

function inferFromPath(relPath, fileName) {
  const parts = relPath.split('/');
  const title = stripExtension(fileName).replace(/^\d+[\s.\-_]+/, '');
  if (parts.length >= 3) return { artist: parts[parts.length - 3], album: parts[parts.length - 2], title };
  if (parts.length >= 2) return { artist: parts[parts.length - 2], album: 'Unknown Album', title };
  return { artist: 'Unknown Artist', album: 'Unknown Album', title };
}

function toRel(musicDir, full) {
  return path.relative(musicDir, full).split(path.sep).join('/');
}

function resolveTrack(musicDir, id) {
  if (!id || id.includes('\0') || id.includes('\\')) return null;
  if (path.isAbsolute(id)) return null;
  const normalized = path.posix.normalize(id);
  if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')) return null;
  const full = path.resolve(musicDir, ...normalized.split('/'));
  const rootDir = path.resolve(musicDir);
  if (full !== rootDir && !full.startsWith(rootDir + path.sep)) return null;
  if (!AUDIO_EXTENSIONS.has(extensionOf(full))) return null;
  return full;
}

// App data that macOS keeps in ~/Music. These are not listening libraries, and
// folders like GarageBand are often blocked with EPERM.
const APP_DIR_NAMES = new Set([
  'garageband',
  'logic',
  'audio music apps',
  'mainstage',
]);

const BUNDLE_SUFFIXES = [
  '.musiclibrary',
  '.app',
  '.band',
  '.logicx',
  '.bundle',
  '.photoslibrary',
  '.tvlibrary',
];

function shouldSkipDirectory(name, atRoot) {
  if (name.startsWith('.')) return true;
  const lower = name.toLowerCase();
  if (BUNDLE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  return atRoot && APP_DIR_NAMES.has(lower);
}

async function walkLibrary(musicDir, onFile) {
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOENT')) {
        console.log(`Skipping unreadable folder: ${dir}`);
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const atRoot = rel === '';
      if (shouldSkipDirectory(entry.name, atRoot)) {
        if (atRoot && APP_DIR_NAMES.has(entry.name.toLowerCase())) {
          console.log(`Skipping app folder: ${entry.name}`);
        }
        continue;
      }
      const full = path.join(dir, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, childRel);
      } else if (entry.isFile() && AUDIO_EXTENSIONS.has(extensionOf(entry.name))) {
        onFile(full, childRel, entry.name);
      }
    }
  }
  await walk(musicDir, '');
}

function songFromMetadata(metadata) {
  const update = {};
  if (metadata.common.title) update.title = metadata.common.title;
  if (metadata.common.artist || metadata.common.albumartist) {
    update.artist = metadata.common.artist || metadata.common.albumartist;
  }
  if (metadata.common.album) update.album = metadata.common.album;
  if (metadata.format.duration) update.duration = metadata.format.duration;
  if (metadata.common.track?.no) update.trackNumber = metadata.common.track.no;
  if (metadata.common.track?.of) update.totalTracks = metadata.common.track.of;
  if (metadata.common.year) update.year = metadata.common.year;
  if (metadata.common.genre?.[0]) update.genre = metadata.common.genre[0];
  if (metadata.common.albumartist) update.albumArtist = metadata.common.albumartist;
  if (metadata.common.composer?.[0]) update.composer = metadata.common.composer[0];
  if (metadata.common.disk?.no) update.diskNumber = metadata.common.disk.no;
  if (metadata.common.disk?.of) update.totalDiscs = metadata.common.disk.of;
  if (metadata.common.bpm) update.bpm = metadata.common.bpm;
  if (metadata.format.container) update.container = metadata.format.container;
  if (metadata.format.codec) update.codec = metadata.format.codec;
  if (metadata.format.bitrate) update.bitrate = metadata.format.bitrate;
  if (metadata.format.sampleRate) update.sampleRate = metadata.format.sampleRate;
  if (metadata.format.numberOfChannels) update.channels = metadata.format.numberOfChannels;
  if (metadata.format.lossless != null) update.lossless = metadata.format.lossless;
  return update;
}

async function writeCache() {
  const payload = { savedAt: Date.now(), songs: state.songs };
  const tmp = `${cachePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload));
  await fs.rename(tmp, cachePath);
}

async function loadCache() {
  try {
    const data = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (!Array.isArray(data.songs)) return;
    state.songs = data.songs.filter((song) => song && typeof song.id === 'string');
    state.byId = new Map(state.songs.map((song) => [song.id, song]));
    console.log(`Loaded ${state.songs.length} cached songs`);
  } catch {
    // first run
  }
}

async function scan(config) {
  const generation = ++state.generation;
  state.scanning = true;
  state.enriching = false;
  const found = [];
  try {
    await walkLibrary(config.musicDir, (_full, rel, name) => {
      const inferred = inferFromPath(rel, name);
      found.push({
        id: rel,
        title: inferred.title,
        artist: inferred.artist,
        album: inferred.album,
        duration: 0,
        source: 'remote',
      });
    });
  } catch (error) {
    console.error('Scan failed:', error);
    state.scanning = false;
    return;
  }
  if (generation !== state.generation) return;

  state.songs = found;
  state.byId = new Map(found.map((song) => [song.id, song]));
  state.scanning = false;
  state.enriching = true;
  state.enrichDone = 0;
  state.enrichTotal = found.length;
  console.log(`Found ${found.length} audio files. Reading tags...`);
  await writeCache().catch((error) => console.error('Cache write failed:', error));

  let cursor = 0;
  async function worker() {
    while (cursor < found.length) {
      if (generation !== state.generation) return;
      const song = found[cursor++];
      const full = resolveTrack(config.musicDir, song.id);
      if (!full) {
        state.enrichDone++;
        continue;
      }
      try {
        const metadata = await Promise.race([
          parseFile(full, { duration: true, skipCovers: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
        ]);
        if (generation !== state.generation) return;
        Object.assign(song, songFromMetadata(metadata));
      } catch {
        // path-inferred metadata stays
      }
      if (generation !== state.generation) return;
      state.enrichDone++;
      if (state.enrichDone % 100 === 0) {
        console.log(`Tags ${state.enrichDone} / ${state.enrichTotal}`);
        await writeCache().catch(() => {});
      }
    }
  }

  await Promise.all(Array.from({ length: ENRICH_CONCURRENCY }, () => worker()));
  if (generation !== state.generation) return;
  state.enriching = false;
  await writeCache().catch((error) => console.error('Cache write failed:', error));
  console.log(`Library ready: ${state.songs.length} songs`);
}

function libraryPayload() {
  return {
    songs: state.songs,
    scanning: state.scanning,
    enriching: state.enriching,
    enrichDone: state.enrichDone,
    enrichTotal: state.enrichTotal,
  };
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function tooManyLogins(ip) {
  const entry = loginFailures.get(ip);
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    loginFailures.delete(ip);
    return false;
  }
  return entry.count >= 8;
}

function noteLoginFailure(ip) {
  const entry = loginFailures.get(ip) || { count: 0, resetAt: Date.now() + 60_000 };
  if (entry.resetAt < Date.now()) {
    entry.count = 0;
    entry.resetAt = Date.now() + 60_000;
  }
  entry.count++;
  loginFailures.set(ip, entry);
}

function applyCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length, Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function authorized(req, url, config) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const token = bearer || url.searchParams.get('token') || '';
  return verifyToken(config.tokenSecret, token);
}

async function streamFile(req, res, filePath) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    sendJson(res, 404, { error: 'File not found' });
    return;
  }
  const type = AUDIO_TYPES[extensionOf(filePath)] || 'application/octet-stream';
  const total = stat.size;
  const range = req.headers.range;
  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    });
    res.end();
    return;
  }
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : total - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    end = Math.min(end, total - 1);
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    });
    const stream = createReadStream(filePath, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return;
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': total,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  });
  const stream = createReadStream(filePath);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function safeStaticPath(distDir, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded.replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) return path.join(distDir, 'index.html');
  const full = path.resolve(distDir, rel);
  if (full !== distDir && !full.startsWith(distDir + path.sep)) return null;
  return full;
}

async function serveStatic(res, distDir, urlPath) {
  const full = safeStaticPath(distDir, urlPath);
  if (!full) {
    sendJson(res, 400, { error: 'Bad path' });
    return;
  }
  try {
    const stat = await fs.stat(full);
    const filePath = stat.isDirectory() ? path.join(full, 'index.html') : full;
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable';
    res.writeHead(200, {
      'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': filePath.includes(`${path.sep}assets${path.sep}`) ? cache : 'no-cache',
    });
    res.end(data);
  } catch {
    try {
      const html = await fs.readFile(path.join(distDir, 'index.html'));
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': html.length,
        'Cache-Control': 'no-cache',
      });
      res.end(html);
    } catch {
      const message = 'Library API is running. Build the player with npm run build, or open the Vite dev server.';
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(message);
    }
  }
}

function lanUrls(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      urls.push(`http://${entry.address}:${port}`);
    }
  }
  return urls;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const config = await loadConfig(args);
  await loadCache();
  void scan(config);

  const distDir = path.join(root, 'dist');
  const server = createServer(async (req, res) => {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname === '/api/health') {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const ip = clientIp(req);
        if (tooManyLogins(ip)) {
          sendJson(res, 429, { error: 'Too many sign-in attempts. Wait a minute and try again.' });
          return;
        }
        let body;
        try {
          body = JSON.parse((await readBody(req)).toString() || '{}');
        } catch {
          sendJson(res, 400, { error: 'Expected a JSON password.' });
          return;
        }
        const password = typeof body.password === 'string' ? body.password : '';
        const ok = password && await verifyPassword(password, config.passwordSalt, config.passwordHash);
        if (!ok) {
          noteLoginFailure(ip);
          sendJson(res, 401, { error: 'Wrong password.' });
          return;
        }
        loginFailures.delete(ip);
        const expiresAt = Date.now() + TOKEN_TTL_MS;
        sendJson(res, 200, { token: signToken(config.tokenSecret, expiresAt), expiresAt });
        return;
      }
      if (url.pathname === '/api/library' && req.method === 'GET') {
        if (!authorized(req, url, config)) {
          sendJson(res, 401, { error: 'Sign in required.' });
          return;
        }
        sendJson(res, 200, libraryPayload());
        return;
      }
      if (url.pathname === '/api/rescan' && req.method === 'POST') {
        if (!authorized(req, url, config)) {
          sendJson(res, 401, { error: 'Sign in required.' });
          return;
        }
        void scan(config);
        sendJson(res, 202, { ok: true });
        return;
      }
      if (url.pathname === '/api/stream' && (req.method === 'GET' || req.method === 'HEAD')) {
        if (!authorized(req, url, config)) {
          sendJson(res, 401, { error: 'Sign in required.' });
          return;
        }
        const filePath = resolveTrack(config.musicDir, url.searchParams.get('id') || '');
        if (!filePath) {
          sendJson(res, 400, { error: 'Unknown song.' });
          return;
        }
        await streamFile(req, res, filePath);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      await serveStatic(res, distDir, url.pathname);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      console.error(error);
      sendJson(res, 500, { error: 'Server error' });
    }
  });

  server.listen(config.port, config.host, () => {
    console.log('');
    console.log(`Music folder: ${config.musicDir}`);
    console.log(`On this computer: http://127.0.0.1:${config.port}`);
    for (const lan of lanUrls(config.port)) console.log(`On your network:   ${lan}`);
    console.log('');
    console.log('Open one of those addresses on another computer or your phone,');
    console.log('or run the player and choose Connect to library server.');
    console.log('Away from home, put this machine on Tailscale and use `tailscale serve`');
    console.log('so the phone gets HTTPS and can install the player to the home screen.');
    console.log('');
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
