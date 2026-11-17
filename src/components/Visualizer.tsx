import { useEffect, useRef, useState, useCallback } from 'react';
import { Play as PlayIcon, Zap, Maximize2, Minimize2, Code2, MonitorSpeaker, X } from 'lucide-react';
import { tabAudioSupported, type TabAudio } from '../lib/tabAudio';
import { DEFAULT_SKETCH, PRESET_SKETCHES } from '../lib/defaultSketches';
import { CodeEditor } from './CodeEditor';
import { ResizeHandle } from './ResizeHandle';
import { MiniP5Preview } from './MiniP5Preview';

declare const p5: any;

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isMaximized?: boolean;
  onMaximizeToggle?: () => void;
  /** Sound shared from another tab. While live, the sketches react to it instead of the player. */
  tab: TabAudio;
}

interface AudioData {
  fft: Uint8Array;
  waveform: Float32Array;
  volume: number;
  bpm: number;
}

export function Visualizer({ analyser: playerAnalyser, isMaximized = false, onMaximizeToggle, tab }: VisualizerProps) {
  const canShareTab = tabAudioSupported();
  const analyser = tab.analyser ?? playerAnalyser;
  const visualizerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const p5InstanceRef = useRef<any>(null);
  const audioDataRef = useRef<AudioData>({
    fft: new Uint8Array(1024),
    waveform: new Float32Array(1024),
    volume: 0,
    bpm: 120,
  });
  const rafRef = useRef<number>(0);

  // BPM detection state
  const kickOnsetTimesRef  = useRef<number[]>([]);
  const prevKickEnergyRef  = useRef<number>(0);
  const lastOnsetTimeRef   = useRef<number>(0);
  const detectedBpmRef     = useRef<number>(120);

  const [code, setCode] = useState(DEFAULT_SKETCH);
  const codeRef = useRef(code);
  codeRef.current = code;
  const [error, setError] = useState<string | null>(null);
  const [selectedPresetName, setSelectedPresetName] = useState<string>('Synaptic Garden');
  const [canvasHeight, setCanvasHeight] = useState(200);
  const [codePanelWidth, setCodePanelWidth] = useState(360);
  const [autorun, setAutorun] = useState(false);
  const [showCodeEditor, setShowCodeEditor] = useState(false);

  // Continuously read analyser data
  useEffect(() => {
    if (!analyser) return;

    const fftBuf = new Uint8Array(analyser.frequencyBinCount);
    const wavBuf = new Float32Array(analyser.fftSize);

    function tick() {
      analyser!.getByteFrequencyData(fftBuf);
      analyser!.getFloatTimeDomainData(wavBuf);

      let sum = 0;
      for (let i = 0; i < wavBuf.length; i++) sum += wavBuf[i] * wavBuf[i];
      const volume = Math.sqrt(sum / wavBuf.length);

      // ── Kick-drum onset detection for BPM ──────────────────────────────
      // Use low FFT bins (~20–180 Hz) where kick drum energy lives.
      const KICK_LO = 1, KICK_HI = Math.min(8, fftBuf.length - 1);
      let kickSum = 0;
      for (let i = KICK_LO; i <= KICK_HI; i++) kickSum += fftBuf[i];
      const kickE = kickSum / (KICK_HI - KICK_LO + 1) / 255; // 0..1

      const now = performance.now();
      const isOnset =
        kickE > 0.07 &&                              // absolute floor (ignore silence)
        kickE > prevKickEnergyRef.current * 1.35 &&  // energy jumped ≥35%
        now - lastOnsetTimeRef.current > 215;        // min 215 ms gap (~280 BPM ceiling)

      if (isOnset) {
        lastOnsetTimeRef.current = now;
        const onsets = kickOnsetTimesRef.current;
        onsets.push(now);
        if (onsets.length > 16) onsets.shift();

        // IOI histogram: bucket all pairwise intervals into ~5-BPM-wide bins
        if (onsets.length >= 4) {
          const buckets: Record<number, number> = {};
          for (let i = 0; i < onsets.length; i++) {
            for (let j = i + 1; j < onsets.length; j++) {
              const gap = onsets[j] - onsets[i];
              if (gap < 215 || gap > 3000) continue;
              let candidate = 60000 / gap;
              // Fold into 70–180 BPM range
              while (candidate < 70)  candidate *= 2;
              while (candidate > 180) candidate /= 2;
              const bin = Math.round(candidate / 5) * 5;
              buckets[bin] = (buckets[bin] || 0) + 1;
            }
          }
          // Pick the highest-vote bin
          let bestBpm = detectedBpmRef.current, bestVotes = 0;
          for (const key of Object.keys(buckets)) {
            const votes = buckets[+key];
            if (votes > bestVotes) { bestVotes = votes; bestBpm = +key; }
          }
          // Exponential moving average to smooth jitter
          detectedBpmRef.current = detectedBpmRef.current * 0.82 + bestBpm * 0.18;
        }
      }
      prevKickEnergyRef.current = kickE;
      // ───────────────────────────────────────────────────────────────────

      audioDataRef.current = {
        fft: fftBuf,
        waveform: wavBuf,
        volume,
        bpm: detectedBpmRef.current,
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser]);

  const destroySketch = useCallback(() => {
    if (p5InstanceRef.current) {
      p5InstanceRef.current.remove();
      p5InstanceRef.current = null;
    }
  }, []);

  const runSketch = useCallback((sketchCode: string) => {
    destroySketch();
    setError(null);

    const container = canvasContainerRef.current;
    if (!container) return;

    container.querySelectorAll('canvas').forEach(c => c.remove());

    const W = container.clientWidth;
    const H = container.clientHeight;

    if (W === 0 || H === 0) return;

    try {
      // eslint-disable-next-line no-new-func
      const compiledInit = new Function(
        '__scope__',
        `with(__scope__) {\n${sketchCode}\nreturn { setup: typeof setup === 'function' ? setup : undefined, draw: typeof draw === 'function' ? draw : undefined };\n}`
      );

      const sketch = (p: any) => {
        const scopeProxy = new Proxy(p, {
          get(_target, prop: string) {
            if (prop === 'fft')      return audioDataRef.current.fft;
            if (prop === 'waveform') return audioDataRef.current.waveform;
            if (prop === 'volume')   return audioDataRef.current.volume;
            if (prop === 'bpm')      return audioDataRef.current.bpm;
            if (prop === 'W') return W;
            if (prop === 'H') return H;

            const val = (p as any)[prop];
            if (typeof val === 'function') return val.bind(p);
            return val;
          },
          has(_target, prop: string) {
            if (['fft', 'waveform', 'volume', 'bpm', 'W', 'H'].includes(prop)) return true;
            return prop in p;
          },
        });

        let userFns: any;
        try {
          userFns = compiledInit(scopeProxy);
        } catch (e: any) {
          setError(e.message);
          return;
        }

        if (userFns.setup) {
          p.setup = function () {
            try { userFns.setup(); }
            catch (e: any) { setError(e.message); }
          };
        } else {
          p.setup = () => { p.createCanvas(W, H); };
        }

        if (userFns.draw) {
          p.draw = function () {
            try { userFns.draw(); }
            catch (e: any) { setError(e.message); p.noLoop(); }
          };
        }
      };

      p5InstanceRef.current = new p5(sketch, container);
    } catch (e: any) {
      setError(e.message);
    }
  }, [destroySketch]);

  // Run sketch on mount and when container resizes (e.g. fullscreen)
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const timer = setTimeout(() => runSketch(code), 200);
    const ro = new ResizeObserver(() => {
      runSketch(codeRef.current);
    });
    ro.observe(container);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      destroySketch();
    };
  }, []);

  // Autorun: debounced run when code changes
  useEffect(() => {
    if (!autorun) return;
    const timer = setTimeout(() => runSketch(code), 400);
    return () => clearTimeout(timer);
  }, [autorun, code, runSketch]);

  const handleRun = () => runSketch(code);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = code.substring(0, start) + '  ' + code.substring(end);
      setCode(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  const loadPreset = (name: string) => {
    const preset = PRESET_SKETCHES[name];
    if (preset) {
      setCode(preset);
      runSketch(preset);
      setSelectedPresetName(name);
    }
  };

  const handleCanvasResize = useCallback((delta: number) => {
    setCanvasHeight((h) => Math.max(120, Math.min(500, h + delta)));
  }, []);

  const handleCodePanelResize = useCallback((delta: number) => {
    setCodePanelWidth((w) => Math.max(220, Math.min(640, w + delta)));
  }, []);

  return (
    <div ref={visualizerRef} className="flex flex-col h-full min-w-0 bg-gray-50 dark:bg-[#121212]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-[#1a1a1a]">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Visualizer
        </div>
        <div className="flex items-center gap-2">
          {canShareTab && (
            tab.status === 'live' ? (
              <button
                type="button"
                onClick={tab.stop}
                className="inline-flex max-w-[16rem] items-center gap-1 px-2 py-1 text-xs rounded border border-green-500 text-green-700 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20 transition-colors"
                title={`Visualizing ${tab.label}. Click to stop.`}
              >
                <MonitorSpeaker size={12} className="shrink-0" />
                <span className="truncate">Tab audio</span>
                <X size={12} className="shrink-0" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void tab.start()}
                disabled={tab.status === 'picking'}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors disabled:opacity-60"
                title='Visualize sound from another tab, like YouTube Music. Pick the tab and turn on "Share tab audio".'
              >
                <MonitorSpeaker size={12} />
                {tab.status === 'picking' ? 'Choosing…' : 'Visualize a tab'}
              </button>
            )
          )}
          {!isMaximized && (
            <button
              type="button"
              onClick={() => setShowCodeEditor((v) => !v)}
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
                showCodeEditor
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-500/10'
                  : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800'
              }`}
              title={showCodeEditor ? 'Hide live code' : 'Show live code'}
            >
              <Code2 size={12} />
              Code
            </button>
          )}
          <button
            type="button"
            onClick={onMaximizeToggle ?? (() => {})}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {isMaximized ? 'Restore' : 'Maximize'}
          </button>
        </div>
      </div>
      <div
        className={`flex min-h-0 min-w-0 overflow-hidden ${isMaximized ? 'flex-1 flex-col' : 'flex-1 flex-row'}`}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            ref={canvasContainerRef}
            className={`relative mx-2 mt-2 overflow-hidden rounded-3xl bg-black ${
              isMaximized ? 'mb-2 min-h-0 flex-1' : 'shrink-0'
            }`}
            style={isMaximized ? undefined : { height: canvasHeight }}
          >
            {!analyser && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4 text-center text-sm text-gray-600">
                {canShareTab ? 'Play a song, or visualize another tab, to activate' : 'Play a song to activate'}
              </div>
            )}
            {tab.note && (
              <div className="absolute inset-x-2 top-2 z-20 flex items-start gap-2 rounded-lg bg-gray-900/90 px-3 py-2 text-xs text-gray-100">
                <span className="flex-1">{tab.note}</span>
                <button type="button" onClick={tab.clearNote} className="shrink-0 text-gray-400 hover:text-white" title="Dismiss">
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          {!isMaximized && <ResizeHandle onDrag={handleCanvasResize} vertical />}

          {!isMaximized && (
            <div className="flex min-h-0 flex-1 flex-col border-t border-gray-200 bg-gray-50 px-2 py-2 shadow-inner dark:border-gray-800 dark:bg-[#1a1a1a]">
              <div
                className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto overflow-x-hidden pb-1 scrollbar-thin"
                style={{ scrollbarWidth: 'thin' }}
              >
                {Object.keys(PRESET_SKETCHES).map((name) => {
                  const isSelected = selectedPresetName === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => loadPreset(name)}
                      className={`w-full overflow-hidden rounded-md border text-left shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-[#1a1a1a] ${
                        isSelected
                          ? 'border-blue-500 ring-1 ring-blue-500/50'
                          : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
                      }`}
                    >
                      <div className="relative aspect-video w-full bg-black">
                        <div className="absolute inset-0">
                          <MiniP5Preview sketchCode={PRESET_SKETCHES[name]!} audioDataRef={audioDataRef} />
                        </div>
                        <div
                          className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/95 via-black/45 to-transparent"
                          aria-hidden
                        />
                        <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1 pt-5">
                          <p className="truncate text-left text-[10px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                            {name}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {!isMaximized && showCodeEditor && (
          <>
            <ResizeHandle onDrag={handleCodePanelResize} />
            <div
              className="flex min-h-0 shrink-0 flex-col border-l border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-[#121212]"
              style={{ width: codePanelWidth }}
            >
              <div className="z-10 flex shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-100 px-3 py-1.5 shadow-sm dark:border-gray-800 dark:bg-[#1a1a1a]">
                <button
                  onClick={handleRun}
                  className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  title="Run (Cmd+Enter)"
                >
                  <PlayIcon size={12} className="text-green-600 dark:text-green-400" /> Run
                </button>
                <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={autorun}
                    onChange={(e) => setAutorun(e.target.checked)}
                    className="rounded border-gray-400 dark:border-gray-500"
                  />
                  <Zap size={12} className="text-amber-500" />
                  <span>Autorun</span>
                </label>
                {error ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2" title={error}>
                    <div className="error-dance shrink-0" aria-hidden>
                      <svg viewBox="0 0 64 64" className="h-8 w-8 text-red-500 dark:text-red-400">
                        <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="2" />
                        <path d="M 22 26 L 26 30 M 26 26 L 22 30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M 38 26 L 42 30 M 42 26 L 38 30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M 20 44 Q 32 52 44 44" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                        <ellipse cx="28" cy="18" rx="3" ry="4" fill="currentColor" opacity="0.6" />
                        <ellipse cx="36" cy="18" rx="3" ry="4" fill="currentColor" opacity="0.6" />
                      </svg>
                    </div>
                    <span className="truncate text-xs text-red-500 dark:text-red-400">{error}</span>
                  </div>
                ) : null}
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <CodeEditor value={code} onChange={setCode} onKeyDown={handleKeyDown} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
