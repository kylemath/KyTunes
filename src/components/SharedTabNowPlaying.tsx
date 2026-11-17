import { useEffect, useRef, useState } from 'react';
import { MonitorSpeaker, X } from 'lucide-react';

/**
 * Shows what's playing in a shared tab. Browsers don't tell another page the song's
 * title, so this draws the shared tab's own player bar (the strip along the bottom of
 * YouTube Music, with the cover, title and artist) from the shared picture.
 */

/** YouTube Music's player bar: 72px tall, with the song info starting after the play controls. */
const BAR_HEIGHT = 72;
const INFO_LEFT = 280;

export function SharedTabNowPlaying({ video, onStop }: { video: MediaStreamTrack | null; onStop: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasPicture, setHasPicture] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.srcObject = new MediaStream([video]);
    void el.play().catch(() => {});

    const draw = () => {
      const vw = el.videoWidth, vh = el.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!vw || !vh || !ctx) return;
      // Match the canvas to its box, in device pixels.
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      // A shared tab arrives at its own pixel size, so CSS pixels there scale by this screen's ratio.
      const scale = Math.min(dpr, vh / BAR_HEIGHT);
      const sh = Math.min(vh, BAR_HEIGHT * scale);
      const sx = Math.min(INFO_LEFT * scale, Math.max(0, vw - sh));
      const sw = Math.min(vw - sx, sh * (cw / ch));
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      const dw = Math.min(cw, sw * (ch / sh));
      ctx.drawImage(el, sx, vh - sh, sw, sh, 0, 0, dw, ch);
      setHasPicture(true);
    };
    const timer = window.setInterval(draw, 500);
    el.addEventListener('loadeddata', draw);
    return () => {
      window.clearInterval(timer);
      el.srcObject = null;
      setHasPicture(false);
    };
  }, [video]);

  return (
    <div className="relative flex h-full w-full items-center">
      <canvas ref={canvasRef} className={`h-full flex-1 min-w-0 rounded ${hasPicture ? '' : 'hidden'}`} />
      {!hasPicture && (
        <div className="flex flex-1 items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <MonitorSpeaker size={16} className="shrink-0" />
          <span className="truncate">Playing from a shared tab</span>
        </div>
      )}
      <button
        type="button"
        onClick={onStop}
        className="ml-2 inline-flex shrink-0 items-center gap-1 rounded border border-green-500 bg-green-500/10 px-2 py-1 text-xs text-green-700 hover:bg-green-500/20 dark:text-green-400"
        title="Stop sharing the tab and go back to KyTunes"
      >
        <MonitorSpeaker size={12} />
        Tab
        <X size={12} />
      </button>
    </div>
  );
}
