import { useEffect, useRef, useState, useCallback } from 'react';
import type { PlayHistoryEntry, RepeatMode, Song } from '../types';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Shuffle, Repeat, Repeat1, ListPlus, SlidersHorizontal, Download, Check, Loader2 } from 'lucide-react';
import { PhoneShare } from './PhoneShare';

interface PlaylistItem {
  id: string;
  name: string;
  songIds: string[];
}

interface PlayerProps {
  currentSong: Song | null;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  onNext: () => void;
  onPrev: () => void;
  onTrackEnd?: () => void;
  onAnalyserReady?: (analyser: AnalyserNode) => void;
  shuffleOn?: boolean;
  onShuffleToggle?: () => void;
  repeatMode?: RepeatMode;
  onRepeatModeChange?: (mode: RepeatMode) => void;
  playlists?: PlaylistItem[];
  onAddToPlaylist?: (songId: string, playlistId: string) => void;
  onCreatePlaylistAndAdd?: (songId: string, name: string) => void;
  onTrackSessionComplete?: (entry: Omit<PlayHistoryEntry, 'id'>) => void;
  onArtistClick?: (artist: string) => void;
  onAlbumClick?: (album: string) => void;
  albumArtworkUrl?: string;
  artistAvatarUrl?: string;
  seekRef?: React.MutableRefObject<((time: number) => void) | null>;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  showSongDetails?: boolean;
  onSongDetailsToggle?: () => void;
  showVisualizer?: boolean;
  onVisualizerToggle?: () => void;
  /** How the current remote song is stored. Omitted for a local file. */
  keepState?: 'available' | 'kept' | 'saving';
  onToggleKeep?: () => void;
  resolveAudioUrl?: (song: Song) => Promise<{ url: string; revoke: boolean }>;
}

// ─── EQ definitions ──────────────────────────────────
const EQ_BANDS = [
  { freq: 60,    label: '60'   },
  { freq: 170,   label: '170'  },
  { freq: 350,   label: '350'  },
  { freq: 1000,  label: '1K'   },
  { freq: 3500,  label: '3.5K' },
  { freq: 10000, label: '10K'  },
] as const;

type EqGains = number[];

const EQ_PRESETS: Record<string, EqGains> = {
  Flat:   [0,  0,  0,  0,  0,  0],
  Loud:   [6,  4,  0, -1,  3,  5],
  Quiet:  [-2, 0,  3,  4,  2, -1],
  Bass:   [8,  5,  1,  0,  0,  0],
  Treble: [0,  0,  0,  1,  4,  7],
  Vocal:  [-2, 0,  3,  5,  3,  0],
};

export function Player({
  currentSong,
  isPlaying,
  setIsPlaying,
  onNext,
  onPrev,
  onTrackEnd,
  onAnalyserReady,
  shuffleOn = false,
  onShuffleToggle,
  repeatMode = 'off',
  onRepeatModeChange,
  playlists = [],
  onAddToPlaylist,
  onCreatePlaylistAndAdd,
  onTrackSessionComplete,
  onArtistClick,
  onAlbumClick,
  albumArtworkUrl,
  artistAvatarUrl,
  seekRef,
  onTimeUpdate,
  showSongDetails,
  onSongDetailsToggle,
  showVisualizer,
  onVisualizerToggle,
  keepState,
  onToggleKeep,
  resolveAudioUrl,
}: PlayerProps) {
  const audioRef    = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef   = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const eqRef   = useRef<HTMLDivElement>(null);

  const currentTimeRef = useRef(0);
  const durationRef    = useRef(0);
  const lastNotifyRef  = useRef(0);
  const activeSessionRef = useRef<{
    songId: string; playedAt: number; songDuration: number; reported: boolean;
  } | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);
  const [volume,  setVolume]  = useState(0.25);
  const [muted,   setMuted]   = useState(false);
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [newPlaylistName,  setNewPlaylistName]  = useState('');
  const [eqOpen,   setEqOpen]   = useState(false);
  const [eqGains,  setEqGains]  = useState<EqGains>([...EQ_PRESETS.Flat]);
  const [eqPreset, setEqPreset] = useState('Flat');

  // ── Expose seek to parent via seekRef ──────────────────────────────────────
  useEffect(() => {
    if (!seekRef) return;
    seekRef.current = (time: number) => {
      if (audioRef.current) {
        audioRef.current.currentTime = time;
        setCurrentTime(time);
        currentTimeRef.current = time;
      }
    };
    return () => { if (seekRef) seekRef.current = null; };
  }, [seekRef]);

  // ── Audio context + EQ chain ───────────────────────────────────────────────
  const ensureAudioContext = useCallback(() => {
    if (audioCtxRef.current || !audioRef.current) return;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaElementSource(audioRef.current);
    sourceRef.current = source;

    const filters = EQ_BANDS.map((band, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = band.freq;
      f.Q.value = 1.0;
      f.gain.value = eqGains[i];
      return f;
    });
    eqFiltersRef.current = filters;

    let prev: AudioNode = source;
    for (const f of filters) { prev.connect(f); prev = f; }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;
    prev.connect(analyser);
    analyser.connect(ctx.destination);
    onAnalyserReady?.(analyser);
  }, [onAnalyserReady]);

  useEffect(() => {
    eqFiltersRef.current.forEach((f, i) => {
      if (eqGains[i] !== undefined) f.gain.value = eqGains[i];
    });
  }, [eqGains]);

  useEffect(() => {
    const song = currentSong;
    if (!song || !audioRef.current) return;
    const created: { url: string | null } = { url: null };
    let cancelled = false;
    const loadAudio = async () => {
      try {
        ensureAudioContext();
        let url: string | null = null;
        if (resolveAudioUrl) {
          const resolved = await resolveAudioUrl(song);
          if (cancelled) {
            if (resolved.revoke) URL.revokeObjectURL(resolved.url);
            return;
          }
          url = resolved.url;
          if (resolved.revoke) created.url = resolved.url;
        } else if (song.fileHandle) {
          const file = await song.fileHandle.getFile();
          if (cancelled) return;
          url = URL.createObjectURL(file);
          created.url = url;
        } else if (song.streamUrl) {
          url = song.streamUrl;
        }
        if (!url || !audioRef.current || cancelled) return;
        audioRef.current.src = url;
        audioRef.current.volume = volume;
        if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
        if (isPlaying) audioRef.current.play().catch(console.error);
      } catch (e) { console.error('Failed to load audio', e); }
    };
    loadAudio();
    return () => {
      cancelled = true;
      if (created.url) URL.revokeObjectURL(created.url);
    };
    // Reload only when the track or its stream address changes, not when tags update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id, currentSong?.streamUrl]);

  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
        audioRef.current.play().catch(console.error);
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => setIsPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => setIsPlaying(false));
    navigator.mediaSession.setActionHandler('nexttrack', () => onNext());
    navigator.mediaSession.setActionHandler('previoustrack', () => onPrev());

    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
    };
  }, [onNext, onPrev, setIsPlaying]);

  // ── Playback event handlers ────────────────────────────────────────────────
  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const t = audioRef.current.currentTime;
    currentTimeRef.current = t;
    setCurrentTime(t);
    // Throttle parent notifications to ~2 Hz to avoid expensive App re-renders
    const now = Date.now();
    if (now - lastNotifyRef.current > 500) {
      lastNotifyRef.current = now;
      onTimeUpdate?.(t, durationRef.current);
    }
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    const d = audioRef.current.duration;
    durationRef.current = d;
    setDuration(d);
    onTimeUpdate?.(currentTimeRef.current, d);
    if (activeSessionRef.current) activeSessionRef.current.songDuration = d;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    if (audioRef.current) { audioRef.current.currentTime = t; setCurrentTime(t); }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value));
    setMuted(false);
  };

  // ── Session reporting ──────────────────────────────────────────────────────
  const reportActiveSession = useCallback((listenedSeconds?: number) => {
    const session = activeSessionRef.current;
    if (!session || session.reported) return;
    const elapsed = Math.max(
      listenedSeconds ?? audioRef.current?.currentTime ?? currentTimeRef.current,
      currentTimeRef.current,
    );
    if (elapsed < 0.5) return;
    onTrackSessionComplete?.({
      songId: session.songId,
      playedAt: session.playedAt,
      listenedSeconds: elapsed,
      songDuration: session.songDuration || durationRef.current || 0,
    });
    session.reported = true;
  }, [onTrackSessionComplete]);

  const handleTrackEnded = useCallback(() => {
    reportActiveSession(durationRef.current || currentTimeRef.current);
    if (repeatMode === 'one' && currentSong && audioRef.current) {
      audioRef.current.currentTime = 0;
      currentTimeRef.current = 0;
      setCurrentTime(0);
      activeSessionRef.current = {
        songId: currentSong.id,
        playedAt: Date.now(),
        songDuration: durationRef.current || currentSong.duration || 0,
        reported: false,
      };
      audioRef.current.play().catch(console.error);
      return;
    }
    onTrackEnd?.();
  }, [currentSong, onTrackEnd, repeatMode, reportActiveSession]);

  useEffect(() => {
    const prev = activeSessionRef.current;
    if (prev && prev.songId !== currentSong?.id) reportActiveSession();
    if (!currentSong) {
      activeSessionRef.current = null;
      currentTimeRef.current = 0;
      durationRef.current = 0;
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    activeSessionRef.current = {
      songId: currentSong.id,
      playedAt: Date.now(),
      songDuration: currentSong.duration || 0,
      reported: false,
    };
    currentTimeRef.current = 0;
    durationRef.current = currentSong.duration || 0;
    setCurrentTime(0);
    setDuration(currentSong.duration || 0);
  }, [currentSong, reportActiveSession]);

  useEffect(() => () => reportActiveSession(), [reportActiveSession]);

  // ── Playlist menu close-on-outside-click ──────────────────────────────────
  useEffect(() => {
    if (!playlistMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setPlaylistMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [playlistMenuOpen]);

  useEffect(() => {
    if (!eqOpen) return;
    const close = (e: MouseEvent) => {
      if (eqRef.current && !eqRef.current.contains(e.target as Node)) setEqOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [eqOpen]);

  useEffect(() => { setPlaylistMenuOpen(false); }, [currentSong?.id]);

  // ── EQ ─────────────────────────────────────────────────────────────────────
  const applyPreset = (name: string) => {
    const g = EQ_PRESETS[name];
    if (g) { setEqGains([...g]); setEqPreset(name); }
  };

  const handleBandChange = (i: number, v: number) => {
    setEqGains(prev => { const n = [...prev]; n[i] = v; return n; });
    setEqPreset('Custom');
  };

  const fmt = (t: number) => {
    if (!t || isNaN(t)) return '0:00';
    return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  };

  return (
    <div className="h-20 max-md:h-auto bg-gray-100 dark:bg-[#181818] grid grid-cols-[minmax(max-content,1fr)_minmax(0,36rem)_minmax(max-content,1fr)] max-md:grid-cols-1 items-center gap-4 max-md:gap-2 px-6 max-md:px-3 max-md:py-2 min-w-0 shrink-0 z-20 shadow-sm border-b border-gray-200 dark:border-gray-800">

      {/* ── Transport controls ── */}
      <div className="flex items-center gap-2 max-md:gap-1 max-md:justify-center justify-self-start max-md:justify-self-center max-md:overflow-x-auto">
        <button
          onClick={onShuffleToggle}
          className={`p-1.5 rounded transition ${shuffleOn ? 'text-blue-600 dark:text-blue-400 bg-blue-500/20' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white'}`}
          title="Shuffle"
        >
          <Shuffle size={20} />
        </button>
        <PhoneShare />
        <button
          onClick={() => onRepeatModeChange?.(repeatMode === 'context' ? 'off' : 'context')}
          className={`p-1.5 rounded transition ${repeatMode === 'context' ? 'text-blue-600 dark:text-blue-400 bg-blue-500/20' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white'}`}
          title="Repeat current view"
        >
          <Repeat size={20} />
        </button>
        <button
          onClick={() => onRepeatModeChange?.(repeatMode === 'one' ? 'off' : 'one')}
          className={`p-1.5 rounded transition ${repeatMode === 'one' ? 'text-blue-600 dark:text-blue-400 bg-blue-500/20' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white'}`}
          title="Repeat current song"
        >
          <Repeat1 size={20} />
        </button>
        <button className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition" onClick={onPrev}>
          <SkipBack size={24} fill="currentColor" />
        </button>
        <button
          className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition"
          onClick={() => setIsPlaying(!isPlaying)}
        >
          {isPlaying
            ? <Pause size={20} fill="currentColor" />
            : <Play  size={20} fill="currentColor" className="ml-1" />}
        </button>
        <button className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition" onClick={onNext}>
          <SkipForward size={24} fill="currentColor" />
        </button>
      </div>

      {/* ── Center LCD ── */}
      <div className="min-w-0 w-full overflow-hidden">
        <div className="bg-[#e4e4e4] dark:bg-[#282828] border border-gray-300 dark:border-black rounded w-full h-14 flex items-center px-2 relative overflow-hidden shadow-inner">
          {currentSong ? (
            <>
              {/* Album art thumbnail */}
              <div className="shrink-0 w-10 h-10 rounded overflow-hidden bg-gray-300 dark:bg-gray-700 mr-2">
                {albumArtworkUrl ? (
                  <img src={albumArtworkUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-[8px]">&#9835;</div>
                )}
              </div>
              {/* Artist avatar */}
              <div className="shrink-0 w-7 h-7 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 mr-2">
                {artistAvatarUrl ? (
                  <img src={artistAvatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[9px] font-bold text-gray-400">{currentSong.artist.charAt(0).toUpperCase()}</div>
                )}
              </div>
              {/* Title + artist/album text */}
              <div className="flex-1 min-w-0 flex flex-col justify-center pr-14">
                <div className="font-medium text-sm truncate">{currentSong.title}</div>
                <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                  <button type="button" className="truncate max-w-[45%] hover:text-blue-600 dark:hover:text-blue-400 transition-colors" onClick={() => onArtistClick?.(currentSong.artist)}>{currentSong.artist}</button>
                  <span className="shrink-0">-</span>
                  <button type="button" className="truncate max-w-[45%] hover:text-blue-600 dark:hover:text-blue-400 transition-colors" onClick={() => onAlbumClick?.(currentSong.album)}>{currentSong.album}</button>
                </div>
              </div>

              <div className="absolute bottom-1 left-14 text-[10px] text-gray-500">{fmt(currentTime)}</div>
              <div className="absolute bottom-1 right-4 text-[10px] text-gray-500">-{fmt(duration - currentTime)}</div>

              {keepState && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleKeep?.(); }}
                  disabled={keepState === 'saving'}
                  className="absolute top-1 right-8 z-10 p-1 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700 disabled:opacity-60"
                  title={keepState === 'kept' ? 'Saved on this device. Click to remove the copy.' : keepState === 'saving' ? 'Saving on this device…' : 'Keep a copy on this device'}
                >
                  {keepState === 'saving' ? <Loader2 size={16} className="animate-spin" /> : keepState === 'kept' ? <Check size={16} /> : <Download size={16} />}
                </button>
              )}

              {/* Playlist button */}
              {(onAddToPlaylist || onCreatePlaylistAndAdd) && (
                <div className="absolute top-1 right-2 z-10" ref={menuRef}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPlaylistMenuOpen(v => !v); }}
                    className="p-1 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700"
                    title="Add to playlist"
                  >
                    <ListPlus size={16} />
                  </button>
                  {playlistMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50">
                      <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                        Add to playlist
                      </div>
                      {playlists.map(pl => (
                        <button
                          key={pl.id}
                          onClick={() => {
                            if (currentSong && onAddToPlaylist) onAddToPlaylist(currentSong.id, pl.id);
                            setPlaylistMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          {pl.name}
                        </button>
                      ))}
                      <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1 px-2">
                        <input
                          type="text"
                          value={newPlaylistName}
                          onChange={e => setNewPlaylistName(e.target.value)}
                          placeholder="New playlist name"
                          className="w-full px-2 py-1 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                        />
                        <button
                          onClick={() => {
                            if (currentSong && newPlaylistName.trim() && onCreatePlaylistAndAdd) {
                              onCreatePlaylistAndAdd(currentSong.id, newPlaylistName.trim());
                              setNewPlaylistName('');
                              setPlaylistMenuOpen(false);
                            }
                          }}
                          className="mt-1 w-full py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                        >
                          Create &amp; add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="absolute bottom-0 left-0 w-full h-1 bg-gray-300 dark:bg-gray-700">
                <div className="h-full bg-blue-500" style={{ width: `${(currentTime / duration) * 100}%` }} />
              </div>
              <input
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                step="0.1"
                className="absolute bottom-0 left-0 w-full h-4 opacity-0 cursor-pointer"
              />
            </>
          ) : (
            <div className="text-center text-gray-400 dark:text-gray-500 text-sm">KyTunes</div>
          )}
        </div>
      </div>

      {/* ── EQ · Volume · Now Playing · Logo ── */}
      <div className="flex items-center justify-end gap-2 justify-self-end max-md:hidden">

        {/* Song Details pane toggle */}
        <button
          type="button"
          onClick={onSongDetailsToggle}
          className={`px-2 py-1 text-xs rounded border transition-colors ${
            showSongDetails
              ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
              : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800'
          }`}
          title="Toggle Song Details panel"
        >
          Song Details
        </button>
        <button
        type="button"
        onClick={onVisualizerToggle}
        className={`px-2 py-1 text-xs rounded border transition-colors ${
          showVisualizer
            ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
            : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800'
      }`}
        title="Toggle Visualizer"
      >
      Visualizer
        </button>

        {/* Equalizer */}
        <div className="relative" ref={eqRef}>
          <button
            onClick={() => setEqOpen(v => !v)}
            className={`p-1.5 rounded transition ${eqOpen || eqPreset !== 'Flat' ? 'text-blue-600 dark:text-blue-400 bg-blue-500/20' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white'}`}
            title="Equalizer"
          >
            <SlidersHorizontal size={18} />
          </button>
          {eqOpen && (
            <div className="absolute right-0 top-full mt-2 bg-white dark:bg-[#1e1e1e] border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 p-3 w-[280px]">
              <div className="flex flex-wrap gap-1 mb-3">
                {Object.keys(EQ_PRESETS).map(name => (
                  <button
                    key={name}
                    onClick={() => applyPreset(name)}
                    className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
                      eqPreset === name
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {name}
                  </button>
                ))}
                {eqPreset === 'Custom' && (
                  <span className="px-2 py-0.5 text-[11px] rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-transparent">
                    Custom
                  </span>
                )}
              </div>
              <div className="flex items-end justify-between gap-1">
                {EQ_BANDS.map((band, i) => (
                  <div key={band.freq} className="flex flex-col items-center gap-1">
                    <span className="text-[9px] text-gray-500 tabular-nums w-7 text-center">
                      {eqGains[i] > 0 ? '+' : ''}{eqGains[i].toFixed(0)}
                    </span>
                    <input
                      type="range" min={-12} max={12} step={1} value={eqGains[i]}
                      onChange={e => handleBandChange(i, Number(e.target.value))}
                      className="eq-slider accent-blue-500"
                      style={{
                        writingMode: 'vertical-lr' as React.CSSProperties['writingMode'],
                        direction: 'rtl',
                        width: '18px',
                        height: '80px',
                        appearance: 'slider-vertical' as React.CSSProperties['appearance'],
                      }}
                    />
                    <span className="text-[9px] text-gray-400 dark:text-gray-500">{band.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1 px-1">
                <span className="text-[8px] text-gray-400">-12 dB</span>
                <span className="text-[8px] text-gray-400">0</span>
                <span className="text-[8px] text-gray-400">+12 dB</span>
              </div>
            </div>
          )}
        </div>

        {/* Volume */}
        <button onClick={() => setMuted(m => !m)} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition">
          {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <input
          type="range" min="0" max="1" step="0.01"
          value={muted ? 0 : volume}
          onChange={handleVolumeChange}
          className="w-24 accent-blue-500 cursor-pointer"
        />

        {/* Logo */}
        <span className="ml-2 relative select-none" aria-label="KyTunes">
          <span className="text-xl font-extrabold tracking-tight" style={{ color: 'transparent', textShadow: '0 1px 1px rgba(255,255,255,0.25)' }}>
            KyTunes
          </span>
          <span
            className="absolute inset-0 text-xl font-extrabold tracking-tight"
            style={{ background: 'linear-gradient(180deg,#a8a8a8 0%,#6a6a6a 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            KyTunes
          </span>
        </span>
      </div>

      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleTrackEnded}
        crossOrigin="anonymous"
      />
    </div>
  );
}
