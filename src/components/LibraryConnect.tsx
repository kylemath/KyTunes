import { useEffect, useState, type FormEvent } from 'react';
import { FolderOpen, Radio } from 'lucide-react';

interface LibraryConnectProps {
  canPickFolder: boolean;
  hasSavedFolder: boolean;
  sameOriginReady: boolean;
  savedServerUrl: string;
  error: string | null;
  connecting: boolean;
  onChooseFolder: () => void;
  onConnect: (baseUrl: string, password: string) => void;
  onPlayDemo: () => void;
}

export function LibraryConnect({
  canPickFolder,
  hasSavedFolder,
  sameOriginReady,
  savedServerUrl,
  error,
  connecting,
  onChooseFolder,
  onConnect,
  onPlayDemo,
}: LibraryConnectProps) {
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(savedServerUrl);
  const [otherServer, setOtherServer] = useState(!sameOriginReady);
  const [role, setRole] = useState<'slave' | 'server'>('slave');
  const [musicDir, setMusicDir] = useState('~/Music');
  const [hostError, setHostError] = useState<string | null>(null);
  const [hosting, setHosting] = useState(false);
  const showUrlField = !sameOriginReady || otherServer;
  const canHost = import.meta.env.DEV;

  useEffect(() => {
    if (!canHost) return;
    fetch('/dev-host')
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as { musicDir?: string };
        if (data.musicDir) setMusicDir(data.musicDir);
      })
      .catch(() => {});
  }, [canHost]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (connecting) return;
    onConnect(showUrlField ? serverUrl : '', password);
  };

  const becomeServer = async (event: FormEvent) => {
    event.preventDefault();
    setHostError(null);
    setHosting(true);
    try {
      const res = await fetch('/dev-host/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicDir, password }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Could not start the server.');
      onConnect('', password);
    } catch (startError) {
      setHostError(startError instanceof Error ? startError.message : 'Could not start the server.');
      setHosting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100 px-4 py-8">
      <div className="p-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg flex flex-col items-stretch max-w-md w-full">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-full flex items-center justify-center mb-6 self-center">
          <Radio size={32} />
        </div>
        <h1 className="text-2xl font-bold mb-2 text-center">Welcome to KyTunes</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6 text-center text-sm">
          This computer opens as a player. Join a library, or choose Server if this is the computer that should host the music.
        </p>

        {canHost && (
          <div className="mb-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRole('slave')}
              className={`px-3 py-2 text-sm rounded-lg border ${role === 'slave' ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}
            >
              Slave
            </button>
            <button
              type="button"
              onClick={() => setRole('server')}
              className={`px-3 py-2 text-sm rounded-lg border ${role === 'server' ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}
            >
              Server
            </button>
          </div>
        )}

        {(error || hostError) && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400 text-center">{hostError || error}</p>
        )}

        {canHost && role === 'server' ? (
          <form onSubmit={(event) => { void becomeServer(event); }} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600 dark:text-gray-300">Music folder on this computer</span>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                value={musicDir}
                onChange={(event) => setMusicDir(event.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600 dark:text-gray-300">Password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                required
              />
            </label>
            <button
              type="submit"
              disabled={hosting || connecting}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              {hosting || connecting ? 'Starting server…' : 'Start server'}
            </button>
          </form>
        ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          {sameOriginReady && !otherServer && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              A library server is already running at this address.
            </p>
          )}
          {showUrlField && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600 dark:text-gray-300">Library server</span>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="https://your-library.example"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                required
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600 dark:text-gray-300">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              required
            />
          </label>
          <button
            type="submit"
            disabled={connecting}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {connecting ? 'Connecting…' : 'Connect to library server'}
          </button>
          {sameOriginReady && (
            <button
              type="button"
              className="text-sm text-gray-500 hover:text-blue-600 dark:hover:text-blue-400"
              onClick={() => setOtherServer((value) => !value)}
            >
              {otherServer ? 'Use this server instead' : 'Use a different server'}
            </button>
          )}
        </form>
        )}

        <div className="flex items-center gap-3 my-5 text-xs uppercase tracking-wide text-gray-400">
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          or
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        </div>

        {canPickFolder ? (
          <button
            type="button"
            onClick={onChooseFolder}
            disabled={connecting}
            className="flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium transition-colors"
          >
            <FolderOpen size={18} />
            {hasSavedFolder ? 'Use saved music folder' : 'Select music folder'}
          </button>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
            This browser can’t open a music folder directly. Connect to the computer that has your library. Use Keep on a song when you want a copy stored on this device.
          </p>
        )}

        <button
          type="button"
          onClick={onPlayDemo}
          disabled={connecting}
          className="mt-3 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium transition-colors"
        >
          Play demo tracks
        </button>

        <p className="mt-6 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Slave joins a library that is already hosted. Server starts hosting on this computer and publishes it with Tailscale when that app is signed in.
          A saved library on this Mac still needs the password you chose the first time.
        </p>
      </div>
    </div>
  );
}
