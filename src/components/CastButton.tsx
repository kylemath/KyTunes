import { Cast } from 'lucide-react';
import { toggleCast, useCast } from '../lib/cast';

/** Shown only when the browser supports Cast and a Chromecast is on the network. */
export function CastButton({ size = 20, className = '' }: { size?: number; className?: string }) {
  const cast = useCast();
  if (!cast.available) return null;
  const on = cast.connected || cast.connecting;
  const title = cast.connected
    ? `Playing on ${cast.deviceName || 'Chromecast'}. Click to stop casting.`
    : cast.connecting ? 'Connecting…' : 'Play on a Chromecast';
  return (
    <button
      type="button"
      onClick={() => { void toggleCast(); }}
      className={`${className} ${on ? 'text-blue-600 dark:text-blue-400 bg-blue-500/20' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white'} ${cast.connecting ? 'animate-pulse' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={cast.connected}
    >
      <Cast size={size} />
    </button>
  );
}
