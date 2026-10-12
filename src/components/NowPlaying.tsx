import { useState, useCallback, useEffect, useRef } from 'react';
import { Play, ListPlus, ListOrdered, Search, Music, Plus } from 'lucide-react';
import type { Song, SongPlayStats } from '../types';
import type { AlbumArtworkResult } from '../lib/artwork';
import { searchAlbumArtwork } from '../lib/artwork';

interface PlaylistItem { id: string; name: string; songIds: string[]; }

interface SongDetailsPaneProps {
  song: Song;
  isCurrentSong: boolean;
  stats?: SongPlayStats;
  playlists: PlaylistItem[];
  artworkUrl?: string;
  onArtworkFound: (artist: string, album: string, result: AlbumArtworkResult) => Promise<string>;
  artistUrl?: string;
  onArtistImageFound: (artist: string) => Promise<string>;
  onPlay: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: (songId: string, playlistId: string) => void;
  onCreatePlaylistAndAdd: (songId: string, name: string) => void;
  onArtistClick: (artist: string) => void;
  onAlbumClick: (album: string) => void;
  onLoadOriginal?: () => void;
}

function fmt(t: number) {
  if (!t || isNaN(t)) return '0:00';
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

function Row({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  if (value === undefined || value === null || value === '') return null;
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  return (
    <div className="flex gap-2 py-[3px] group">
      <span className="w-[110px] shrink-0 text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors leading-4 pt-px">
        {label}
      </span>
      <span className="text-[12px] text-gray-700 dark:text-gray-300 break-words min-w-0 leading-4">{display}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[9px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-600 mb-1 mt-3 pb-1 border-b border-gray-200 dark:border-gray-800">
        {title}
      </div>
      {children}
    </div>
  );
}

export function SongDetailsPane({
  song, isCurrentSong, stats, playlists,
  artworkUrl, onArtworkFound, artistUrl, onArtistImageFound,
  onPlay, onAddToQueue, onAddToPlaylist, onCreatePlaylistAndAdd,
  onArtistClick, onAlbumClick, onLoadOriginal,
}: SongDetailsPaneProps) {
  const [displayUrl, setDisplayUrl] = useState<string | undefined>(artworkUrl);
  const [artworkLoading, setArtworkLoading] = useState(false);
  const [artworkError, setArtworkError] = useState<string | null>(null);
  const [artistDisplayUrl, setArtistDisplayUrl] = useState<string | undefined>(artistUrl);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistError, setArtistError] = useState<string | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const playlistRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDisplayUrl(artworkUrl);
    setArtworkError(null);
    setArtworkLoading(false);
    setArtistDisplayUrl(artistUrl);
    setArtistError(null);
    setArtistLoading(false);
    setPlaylistOpen(false);
  }, [song.id, artworkUrl, artistUrl]);

  useEffect(() => {
    if (!playlistOpen) return;
    const handler = (e: MouseEvent) => {
      if (playlistRef.current && !playlistRef.current.contains(e.target as Node)) setPlaylistOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [playlistOpen]);

  const searchArt = useCallback(async () => {
    setArtworkLoading(true);
    setArtworkError(null);
    try {
      const result = await searchAlbumArtwork(song.album, song.artist);
      const savedUrl = await onArtworkFound(song.artist, song.album, result);
      setDisplayUrl(savedUrl);
    } catch (e) {
      setArtworkError(e instanceof Error ? e.message : 'No artwork found.');
    } finally {
      setArtworkLoading(false);
    }
  }, [song.album, song.artist, onArtworkFound]);

  const lookupArtistImage = useCallback(async () => {
    if (artistLoading) return;
    setArtistLoading(true);
    setArtistError(null);
    try {
      const url = await onArtistImageFound(song.artist);
      setArtistDisplayUrl(url);
    } catch (e) {
      setArtistError(e instanceof Error ? e.message : 'No artist image found.');
    } finally {
      setArtistLoading(false);
    }
  }, [song.artist, onArtistImageFound, artistLoading]);

  const bitrate = song.bitrate ? `${Math.round(song.bitrate / 1000)} kbps` : undefined;
  const sampleRate = song.sampleRate ? `${(song.sampleRate / 1000).toFixed(1)} kHz` : undefined;
  const trackStr = song.trackNumber != null
    ? `${song.trackNumber}${song.totalTracks ? ` / ${song.totalTracks}` : ''}`
    : undefined;
  const discStr = song.diskNumber != null
    ? `${song.diskNumber}${song.totalDiscs ? ` / ${song.totalDiscs}` : ''}`
    : undefined;
  const gainTrack = song.replayGainTrack != null ? `${song.replayGainTrack.toFixed(2)} dB` : undefined;
  const gainAlbum = song.replayGainAlbum != null ? `${song.replayGainAlbum.toFixed(2)} dB` : undefined;

  return (
    <div className="flex flex-col h-full bg-[#f5f5f5] dark:bg-[#111] border-l border-gray-200 dark:border-gray-800 overflow-hidden">

      {/* ── Artwork square ── */}
      <div className="relative shrink-0 bg-black overflow-hidden" style={{ paddingBottom: '100%' }}>
        <div className="absolute inset-0">
          {displayUrl ? (
            <img src={displayUrl} alt="Album artwork" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-gray-800 to-gray-900 select-none">
              <Music size={40} className="text-gray-600 mb-2" />
              <span className="text-[10px] text-gray-600 text-center px-4 leading-tight">{song.album}</span>
            </div>
          )}
          <div className="absolute bottom-2 left-2 right-2 flex gap-1.5 justify-end">
            <button
              type="button"
              onClick={searchArt}
              disabled={artworkLoading}
              title="Search artwork online"
              className="flex items-center gap-1 px-2 py-1 rounded bg-black/70 hover:bg-black/90 disabled:opacity-50 text-white text-[11px] backdrop-blur-sm"
            >
              <Search size={11} />
              {artworkLoading ? '...' : displayUrl ? 'Retry' : 'Artwork'}
            </button>
          </div>
          {artworkError && (
            <div className="absolute top-2 inset-x-2 text-[10px] text-red-300 bg-black/70 rounded px-2 py-1 text-center leading-tight">{artworkError}</div>
          )}
        </div>
      </div>

      {/* ── Title / artist / album ── */}
      <div className="shrink-0 px-3 pt-3 pb-1">
        <div className="font-semibold text-[15px] text-gray-900 dark:text-gray-100 leading-tight truncate" title={song.title}>
          {song.title}
        </div>
        <div className="mt-1.5 flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={lookupArtistImage}
            disabled={artistLoading}
            title={artistDisplayUrl ? `${song.artist} - click to refresh` : `Find image for ${song.artist}`}
            className="relative shrink-0 w-8 h-8 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[12px] font-bold text-gray-500 dark:text-gray-400 hover:ring-2 hover:ring-blue-500 transition disabled:opacity-60"
          >
            {artistDisplayUrl ? (
              <img src={artistDisplayUrl} alt={song.artist} className="w-full h-full object-cover" />
            ) : artistLoading ? (
              <span className="animate-spin text-[10px]">&#x21bb;</span>
            ) : (
              song.artist.charAt(0).toUpperCase()
            )}
          </button>
          <div className="flex flex-wrap items-baseline gap-x-1 text-[12px] text-gray-500 dark:text-gray-400 min-w-0">
            <button type="button" onClick={() => onArtistClick(song.artist)} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate">
              {song.artist}
            </button>
            {song.album && (
              <>
                <span className="opacity-40">--</span>
                <button type="button" onClick={() => onAlbumClick(song.album)} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate">
                  {song.album}
                </button>
              </>
            )}
          </div>
        </div>
        {artistError && <div className="mt-1 text-[10px] text-red-500 dark:text-red-400 leading-tight">{artistError}</div>}
      </div>

      {/* ── Action buttons: Play, Add to Queue, Add to Playlist ── */}
      <div className="shrink-0 px-3 py-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPlay}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isCurrentSong
              ? 'bg-blue-600/20 text-blue-600 dark:text-blue-400 border border-blue-500/30'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          <Play size={14} fill="currentColor" />
          {isCurrentSong ? 'Playing' : 'Play'}
        </button>
        <button
          type="button"
          onClick={onAddToQueue}
          title="Add to queue"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ListOrdered size={14} />
          Queue
        </button>
        <div className="relative ml-auto" ref={playlistRef}>
          <button
            type="button"
            onClick={() => setPlaylistOpen(v => !v)}
            title="Add to playlist"
            className="p-1.5 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white rounded hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
          >
            <ListPlus size={16} />
          </button>
          {playlistOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 z-50">
              <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">Add to playlist</div>
              {playlists.map(pl => (
                <button key={pl.id} type="button" onClick={() => { onAddToPlaylist(song.id, pl.id); setPlaylistOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">
                  {pl.name}
                </button>
              ))}
              <div className="px-2 pt-1 border-t border-gray-100 dark:border-gray-700">
                <div className="flex gap-1">
                  <input
                    type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { onCreatePlaylistAndAdd(song.id, newName.trim()); setNewName(''); setPlaylistOpen(false); } }}
                    placeholder="New playlist..."
                    className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  />
                  <button type="button" onClick={() => { if (newName.trim()) { onCreatePlaylistAndAdd(song.id, newName.trim()); setNewName(''); setPlaylistOpen(false); } }} className="p-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white">
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Metadata table ── */}
      <div className="flex-1 overflow-y-auto border-t border-gray-200 dark:border-gray-800 px-3 pb-4">
        <Section title="Identity">
          <Row label="Title" value={song.title} />
          <Row label="Artist" value={song.artist} />
          <Row label="Album Artist" value={song.albumArtist} />
          <Row label="Album" value={song.album} />
          <Row label="Year" value={song.year} />
          <Row label="Track" value={trackStr} />
          <Row label="Disc" value={discStr} />
          <Row label="Genre" value={song.genre} />
        </Section>

        <Section title="Composition">
          <Row label="Composer" value={song.composer} />
          <Row label="Key" value={song.initialKey} />
          <Row label="BPM" value={song.bpm} />
          <Row label="Mood" value={song.mood} />
          <Row label="Language" value={song.language} />
        </Section>

        <Section title="Technical">
          <Row label="Duration" value={fmt(song.duration)} />
          <Row label="Bitrate" value={bitrate} />
          <Row label="Sample Rate" value={sampleRate} />
          <Row label="Channels" value={song.channels} />
          <Row label="Codec" value={song.codec} />
          <Row label="Container" value={song.container} />
          <Row label="Profile" value={song.codecProfile} />
          <Row label="Lossless" value={song.lossless} />
        </Section>

        <Section title="Recording">
          <Row label="ISRC" value={song.isrc} />
          <Row label="Label" value={song.label} />
          <Row label="Copyright" value={song.copyright} />
          <Row label="Encoded By" value={song.encodedBy} />
          <Row label="Encoder" value={song.encoderSettings} />
          <Row label="Comment" value={song.comment} />
        </Section>

        {(gainTrack !== undefined || gainAlbum !== undefined) && (
          <Section title="ReplayGain">
            <Row label="Track Gain" value={gainTrack} />
            <Row label="Album Gain" value={gainAlbum} />
          </Section>
        )}

        {song.lyrics && (
          <Section title="Lyrics">
            <div className="text-[11px] text-gray-600 dark:text-gray-400 whitespace-pre-line leading-relaxed mt-1">{song.lyrics}</div>
          </Section>
        )}

        {(song.musicbrainzRecordingId || song.musicbrainzAlbumId || song.musicbrainzArtistId || song.musicbrainzAlbumArtistId) && (
          <Section title="MusicBrainz">
            <Row label="Recording" value={song.musicbrainzRecordingId} />
            <Row label="Album" value={song.musicbrainzAlbumId} />
            <Row label="Artist" value={song.musicbrainzArtistId} />
            <Row label="Album Artist" value={song.musicbrainzAlbumArtistId} />
          </Section>
        )}

        <Section title="Playback Stats">
          <Row label="Play Count" value={stats?.playCount ?? 0} />
          <Row label="Total Listened" value={fmt(stats?.totalListenedSeconds ?? 0)} />
          <Row label="Last Played" value={stats?.lastPlayedAt ? new Date(stats.lastPlayedAt).toLocaleString() : 'Never'} />
        </Section>

        <Section title="File">
          <div className="flex gap-2 py-[3px]">
            <span className="w-[110px] shrink-0 text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-500 leading-4 pt-px">Path</span>
            <span className="text-[12px] text-gray-700 dark:text-gray-300 break-all min-w-0 leading-4">{song.id}</span>
          </div>
        </Section>

        {song.lineage && (
          <Section title="Source">
            <Row label="Original" value={song.lineage.originAddress} />
            <Row label="First file" value={song.lineage.originSongId} />
            <Row label="Path" value={song.lineage.addresses.join(' → ')} />
            {onLoadOriginal && song.lineage.addresses.length > 1 && (
              <button type="button" onClick={onLoadOriginal} className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                Load original
              </button>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}
