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

/**
 * How many picture pixels one CSS pixel of the shared tab takes. Chrome may scale a tab
 * down (a Retina tab often arrives at 1920 wide), so measure YouTube Music's grey player
 * bar from the bottom of the picture rather than guess. Falls back to this screen's ratio.
 */
function measureScale(el: HTMLVideoElement, probe: CanvasRenderingContext2D): number {
  const vw = el.videoWidth, vh = el.videoHeight;
  const rows = Math.min(vh, 400);
  probe.canvas.width = 1;
  probe.canvas.height = rows;
  // Walk up a few columns from the bottom while the colour stays the bar's. Text or the
  // cover can cut one column short, so keep the tallest.
  let height = 0;
  for (const f of [0.03, 0.2, 0.45, 0.7, 0.97]) {
    const x = Math.min(vw - 1, Math.round(vw * f));
    probe.drawImage(el, x, vh - rows, 1, rows, 0, 0, 1, rows);
    const px = probe.getImageData(0, 0, 1, rows).data;
    const base = (rows - 2) * 4;
    let h = 0;
    for (let row = rows - 2; row >= 0; row--) {
      const i = row * 4;
      if (Math.abs(px[i] - px[base]) + Math.abs(px[i + 1] - px[base + 1]) + Math.abs(px[i + 2] - px[base + 2]) > 18) break;
      h++;
    }
    height = Math.max(height, h);
  }
  const scale = (height + 2) / BAR_HEIGHT;
  // Only trust a believable bar height; otherwise assume the tab arrived at full size.
  if (scale >= 0.5 && scale <= 3.2) return scale;
  return Math.min(window.devicePixelRatio || 1, vh / BAR_HEIGHT);
}

export function SharedTabNowPlaying({ video, onStop }: { video: MediaStreamTrack | null; onStop: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasPicture, setHasPicture] = useState(false);
  /** Click the picture to switch between the player bar and the whole tab. */
  const [whole, setWhole] = useState(false);
  const wholeRef = useRef(whole);
  useEffect(() => { wholeRef.current = whole; }, [whole]);
  const [info, setInfo] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    // Chrome only keeps decoding a video that is in the page, so park it off to the side.
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(el);
    el.srcObject = new MediaStream([video]);
    void el.play().catch(() => {});
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    let scale = 0;
    let measuredAt = 0;

    const draw = () => {
      const vw = el.videoWidth, vh = el.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!vw || !vh || !ctx || el.readyState < 2) return;
      // Match the canvas to its box, in device pixels.
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);

      if (wholeRef.current) {
        const k = Math.min(cw / vw, ch / vh);
        ctx.drawImage(el, 0, 0, vw, vh, 0, 0, vw * k, vh * k);
      } else {
        const now = performance.now();
        if (probe && (!scale || now - measuredAt > 5000)) {
          scale = measureScale(el, probe);
          measuredAt = now;
        }
        const sh = Math.min(vh, BAR_HEIGHT * scale);
        const sx = Math.min(INFO_LEFT * scale, Math.max(0, vw - sh));
        const sw = Math.min(vw - sx, sh * (cw / ch));
        const dw = Math.min(cw, sw * (ch / sh));
        ctx.drawImage(el, sx, vh - sh, sw, sh, 0, 0, dw, ch);
      }
      setInfo(`${vw}×${vh}${scale ? `, bar ${Math.round(BAR_HEIGHT * scale)}px` : ''}`);
      setHasPicture(true);
    };
    const timer = window.setInterval(draw, 500);
    el.addEventListener('loadeddata', draw);
    return () => {
      window.clearInterval(timer);
      el.srcObject = null;
      el.remove();
      setHasPicture(false);
    };
  }, [video]);

  return (
    <div className="relative flex h-full w-full items-center">
      <canvas
        ref={canvasRef}
        onClick={() => setWhole((w) => !w)}
        className={`h-full flex-1 min-w-0 cursor-pointer rounded ${hasPicture ? '' : 'hidden'}`}
        title={`${whole ? 'Showing the whole tab. Click to show just its player bar.' : 'Click to show the whole tab.'} (${info})`}
      />
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
