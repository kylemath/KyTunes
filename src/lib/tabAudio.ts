import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Listen to the sound of another browser tab (YouTube Music, for example) so the
 * visualizer can react to it. Uses the browser's screen-share picker; the person picks
 * a tab and ticks "Share tab audio". The captured sound is only analysed, never played
 * back here, so nothing echoes. The other tab keeps playing it as usual.
 */

export type TabAudioStatus = 'idle' | 'picking' | 'live';

/** True where the browser can share another tab's audio: desktop Chrome, Edge and their installed apps. */
export function tabAudioSupported(): boolean {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return false;
  // Phones and tablets either lack screen sharing or can't share a tab's sound.
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile) return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return false;
  return true;
}

export function useTabAudio() {
  const [status, setStatus] = useState<TabAudioStatus>('idle');
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [note, setNote] = useState('');
  const [label, setLabel] = useState('');
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setAnalyser(null);
    setLabel('');
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (!tabAudioSupported()) {
      setNote('Visualizing another tab works in Chrome or Edge on a computer.');
      return;
    }
    setNote('');
    setStatus('picking');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // Chrome only offers tab audio alongside video. The video is dropped right away.
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        // Chrome hints: start on the Tabs list, leave this window out, keep the tab audible.
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: 'include',
        suppressLocalAudioPlayback: false,
      } as DisplayMediaStreamOptions);
    } catch (e) {
      setStatus('idle');
      // Closing the picker or pressing Cancel lands here; that needs no message.
      const name = (e as DOMException)?.name;
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        setNote(`Couldn't share a tab: ${(e as Error)?.message || name || 'unknown error'}`);
      }
      return;
    }

    const audio = stream.getAudioTracks();
    stream.getVideoTracks().forEach((t) => t.stop());
    if (audio.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      setStatus('idle');
      setNote('No sound was shared. Pick the tab again and turn on "Share tab audio".');
      return;
    }

    // Replace any earlier capture.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close().catch(() => {});

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream(audio));
    const node = ctx.createAnalyser();
    node.fftSize = 2048;
    source.connect(node);
    // A silent path to the output keeps the graph running without playing the sound twice.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    if (ctx.state === 'suspended') void ctx.resume();

    streamRef.current = stream;
    ctxRef.current = ctx;
    // "Stop sharing" in the browser bar, or closing the shared tab, ends the track.
    audio[0].addEventListener('ended', () => {
      if (streamRef.current === stream) stop();
    });
    setLabel(audio[0].label || 'Another tab');
    setAnalyser(node);
    setStatus('live');
  }, [stop]);

  // Stop sharing when the visualizer closes.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close().catch(() => {});
  }, []);

  return { status, analyser, note, label, start, stop, clearNote: () => setNote('') };
}
