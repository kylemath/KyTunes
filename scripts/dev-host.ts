import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'library.config.json');

export interface HostStatus {
  configured: boolean;
  musicDir: string;
  running: boolean;
  hosting: boolean;
}

let libraryChild: ChildProcess | null = null;
let shareStartedByUs = false;

const tailscaleBins = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  'tailscale',
];

function execFileAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 8000, maxBuffer: 2_000_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function tailscaleBin(): Promise<string | null> {
  for (const bin of tailscaleBins) {
    if (bin === 'tailscale') return bin;
    try {
      await fs.access(bin);
      return bin;
    } catch {
      // try the next install location
    }
  }
  return null;
}

async function libraryPort(): Promise<number> {
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as { port?: number };
    if (typeof config.port === 'number') return config.port;
  } catch {
    // not configured yet
  }
  return 8787;
}

async function libraryRunning(): Promise<boolean> {
  const port = await libraryPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function expandHome(dir: string): string {
  if (dir === '~') return os.homedir();
  if (dir.startsWith('~/')) return path.join(os.homedir(), dir.slice(2));
  return dir;
}

export async function hostStatus(): Promise<HostStatus> {
  let musicDir = '';
  let configured = false;
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as { musicDir?: string; passwordHash?: string };
    configured = Boolean(config.musicDir && config.passwordHash);
    musicDir = typeof config.musicDir === 'string' ? config.musicDir : '';
  } catch {
    configured = false;
  }
  return {
    configured,
    musicDir,
    running: await libraryRunning(),
    hosting: Boolean(libraryChild && libraryChild.exitCode == null && !libraryChild.killed),
  };
}

async function waitUntilRunning(): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (await libraryRunning()) return true;
    if (libraryChild && libraryChild.exitCode != null) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return libraryRunning();
}

async function publishTailscale(): Promise<void> {
  const bin = await tailscaleBin();
  if (!bin) return;
  const port = String(await libraryPort());
  let status = '{}';
  try {
    status = await execFileAsync(bin, ['serve', 'status', '--json']);
  } catch {
    status = '{}';
  }
  if (status.includes(`127.0.0.1:${port}`)) return;
  await execFileAsync(bin, ['serve', '--bg', port]);
  shareStartedByUs = true;
}

export async function startHost({ musicDir, password }: { musicDir?: string; password?: string } = {}): Promise<HostStatus> {
  if (await libraryRunning()) return hostStatus();
  const env = { ...process.env };
  delete env.LIBRARY_DIR;
  delete env.LIBRARY_PASSWORD;
  if (typeof musicDir === 'string' && musicDir.trim()) {
    const resolved = path.resolve(expandHome(musicDir.trim()));
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('That music path is not a folder.');
    env.LIBRARY_DIR = resolved;
  }
  if (typeof password === 'string' && password) {
    env.LIBRARY_PASSWORD = password;
  }
  libraryChild = spawn(process.execPath, [path.join(root, 'server/library-server.mjs')], {
    cwd: root,
    env,
    detached: true,
    stdio: 'ignore',
  });
  libraryChild.unref();
  const up = await waitUntilRunning();
  if (!up) {
    libraryChild = null;
    throw new Error('The library server did not start. Check the music folder and password.');
  }
  try {
    await publishTailscale();
  } catch {
    // hosting still works on this computer if Tailscale is unavailable
  }
  return hostStatus();
}

export async function stopHost(): Promise<HostStatus> {
  if (libraryChild?.pid && libraryChild.exitCode == null) {
    try {
      process.kill(libraryChild.pid);
    } catch {
      // already stopped
    }
  }
  libraryChild = null;
  if (shareStartedByUs) {
    const bin = await tailscaleBin();
    if (bin) {
      try {
        await execFileAsync(bin, ['serve', 'reset']);
      } catch {
        // serve may already be off
      }
    }
    shareStartedByUs = false;
  }
  return hostStatus();
}
