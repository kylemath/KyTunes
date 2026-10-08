import { useCallback, useEffect, useMemo, useRef } from 'react';
import { List } from 'react-window';
import type { FilterType, HistoryViewItem, Song, SortColumn, SortDirection } from '../types';
import { RefreshCw, ArrowUp, ArrowDown, ListPlus } from 'lucide-react';

interface LibraryProps {
  songs: Song[];
  historyItems?: HistoryViewItem[];
  mode?: FilterType;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn, direction: SortDirection) => void;
  onPlay: (song: Song) => void;
  onSelect?: (song: Song) => void;
  onAddToQueue?: (song: Song) => void;
  currentSongId?: string;
  selectedSongId?: string;
  contextSongId?: string;
  onRescan: () => void;
  compact?: boolean;
  keptIds?: ReadonlySet<string>;
}

const ROW_HEIGHT = 28;

function formatTime(time: number) {
  if (!time || isNaN(time)) return '';
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface SongRowExtraProps {
  songs: Song[];
  currentSongId?: string;
  selectedSongId?: string;
  onPlay: (song: Song) => void;
  onSelect?: (song: Song) => void;
  onAddToQueue?: (song: Song) => void;
  compact?: boolean;
  keptIds?: ReadonlySet<string>;
}

interface HistoryRowExtraProps {
  items: HistoryViewItem[];
  currentSongId?: string;
  selectedSongId?: string;
  onPlay: (song: Song) => void;
  onSelect?: (song: Song) => void;
}

function rowClassName(isCurrent: boolean, isSelected: boolean, isEven: boolean) {
  if (isCurrent) return 'bg-blue-600 text-white';
  if (isSelected) return 'bg-blue-500/15 ring-1 ring-inset ring-blue-500/40 text-gray-800 dark:text-gray-200';
  return isEven
    ? 'bg-white dark:bg-[#121212] text-gray-800 dark:text-gray-200 hover:bg-blue-500/10 dark:hover:bg-blue-600/10'
    : 'bg-[#f8f9fa] dark:bg-[#161616] text-gray-800 dark:text-gray-200 hover:bg-blue-500/10 dark:hover:bg-blue-600/10';
}

function SongRow(props: { ariaAttributes: { "aria-posinset": number; "aria-setsize": number; role: "listitem" }; index: number; style: React.CSSProperties } & SongRowExtraProps) {
  const { index, style, songs, currentSongId, selectedSongId, onPlay, onSelect, onAddToQueue, compact, keptIds } = props;
  const song = songs[index];
  if (!song) return null;
  const kept = keptIds?.has(song.id);

  return (
    <div
      style={style}
      className={`flex items-center px-4 text-sm cursor-default select-none group ${rowClassName(song.id === currentSongId, song.id === selectedSongId, index % 2 === 0)}`}
      onClick={() => { if (compact) onPlay(song); else onSelect?.(song); }}
      onDoubleClick={() => onPlay(song)}
    >
      <div className="w-8 flex-shrink-0 text-gray-400 text-xs">{index + 1}</div>
      <div className={`flex-1 pr-4 truncate font-medium ${compact ? 'min-w-0' : 'min-w-[150px]'}`}>
        {kept && <span className="mr-1 text-blue-500" title="Saved on this device">●</span>}
        {song.title}
      </div>
      <div className={`flex-1 pr-4 truncate ${compact ? 'min-w-0' : 'min-w-[120px]'}`}>{song.artist}</div>
      <div className="w-16 flex-shrink-0 text-right pr-4 tabular-nums">{formatTime(song.duration)}</div>
      <div className={`w-11 flex-shrink-0 text-right pr-3 tabular-nums text-gray-600 dark:text-gray-400 ${compact ? 'hidden' : ''}`}>
        {song.trackNumber != null && song.trackNumber > 0 ? song.trackNumber : ''}
      </div>
      <div className={`flex-1 min-w-[120px] pr-4 truncate ${compact ? 'hidden' : ''}`}>{song.album}</div>
      <div className={`w-24 flex-shrink-0 truncate ${compact ? 'hidden' : ''}`}>{song.genre || ''}</div>
      <div className="w-16 flex-shrink-0 flex justify-end">
        {onAddToQueue && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddToQueue(song); }}
            title="Add to queue"
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity"
          >
            <ListPlus size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function formatPlayedAt(time: number) {
  return new Date(time).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function HistoryRow(props: { ariaAttributes: { "aria-posinset": number; "aria-setsize": number; role: "listitem" }; index: number; style: React.CSSProperties } & HistoryRowExtraProps) {
  const { index, style, items, currentSongId, selectedSongId, onPlay, onSelect } = props;
  const item = items[index];
  if (!item) return null;

  return (
    <div
      style={style}
      className={`flex items-center px-4 text-sm cursor-default select-none ${rowClassName(item.song.id === currentSongId, item.song.id === selectedSongId, index % 2 === 0)}`}
      onClick={() => onSelect?.(item.song)}
      onDoubleClick={() => onPlay(item.song)}
    >
      <div className="w-8 flex-shrink-0 text-gray-400 text-xs">{index + 1}</div>
      <div className="flex-1 min-w-[180px] pr-4 truncate font-medium">{item.song.title}</div>
      <div className="w-40 flex-shrink-0 pr-4 truncate">{item.song.artist}</div>
      <div className="w-36 flex-shrink-0 pr-4 text-xs tabular-nums text-gray-500 dark:text-gray-400">{formatPlayedAt(item.entry.playedAt)}</div>
      <div className="w-20 flex-shrink-0 pr-4 text-right tabular-nums">{formatTime(item.entry.listenedSeconds)}</div>
      <div className="w-16 flex-shrink-0 pr-4 text-right tabular-nums">{item.stats?.playCount ?? 1}</div>
      <div className="flex-1 min-w-[140px] pr-4 truncate">{item.song.album}</div>
      <div className="w-16 flex-shrink-0"></div>
    </div>
  );
}

function SortHeader({
  label, column, currentColumn, direction, onSort, className = '',
}: {
  label: string; column: SortColumn; currentColumn: SortColumn; direction: SortDirection;
  onSort: (col: SortColumn, dir: SortDirection) => void; className?: string;
}) {
  const isActive = currentColumn === column;
  const handleClick = useCallback(() => {
    onSort(column, isActive && direction === 'asc' ? 'desc' : 'asc');
  }, [column, isActive, direction, onSort]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex items-center gap-0.5 hover:text-blue-600 dark:hover:text-blue-400 text-left ${className}`}
    >
      {label}
      {isActive && (direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  );
}

export function Library({
  songs, historyItems = [], mode = 'All',
  sortColumn, sortDirection, onSort,
  onPlay, onSelect, onAddToQueue,
  currentSongId, selectedSongId, contextSongId, onRescan,
  compact = false, keptIds,
}: LibraryProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const rowProps: SongRowExtraProps = { songs, currentSongId, selectedSongId, onPlay, onSelect, onAddToQueue, compact, keptIds };
  const historyRowProps: HistoryRowExtraProps = { items: historyItems, currentSongId, selectedSongId, onPlay, onSelect };
  const isHistoryMode = mode === 'History';
  const isQueueMode = mode === 'Queue';

  const contextIndex = useMemo(() => {
    if (!contextSongId) return -1;
    if (isHistoryMode) return historyItems.findIndex(item => item.song.id === contextSongId);
    return songs.findIndex(song => song.id === contextSongId);
  }, [contextSongId, historyItems, isHistoryMode, songs]);

  useEffect(() => {
    if (contextIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      const scrollContainer = bodyRef.current?.firstElementChild as HTMLElement | null;
      if (!scrollContainer) return;
      const viewportHeight = bodyRef.current?.clientHeight ?? 0;
      const targetTop = Math.max(0, contextIndex * ROW_HEIGHT - Math.max(0, viewportHeight / 2 - ROW_HEIGHT * 2));
      scrollContainer.scrollTo({ top: targetTop, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [contextIndex]);

  // Arrow-key navigation: move selectedSongId up/down
  useEffect(() => {
    const container = bodyRef.current;
    if (!container || !onSelect) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      e.preventDefault();

      const list = isHistoryMode ? historyItems.map(i => i.song) : songs;
      if (list.length === 0) return;

      const currentIdx = selectedSongId ? list.findIndex(s => s.id === selectedSongId) : -1;

      if (e.key === 'Enter' && currentIdx >= 0) {
        onPlay(list[currentIdx]);
        return;
      }

      let nextIdx: number;
      if (e.key === 'ArrowDown') {
        nextIdx = currentIdx < list.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : list.length - 1;
      }
      onSelect(list[nextIdx]);

      // Scroll the row into view
      const scrollContainer = bodyRef.current?.firstElementChild as HTMLElement | null;
      if (scrollContainer) {
        const rowTop = nextIdx * ROW_HEIGHT;
        const viewportH = bodyRef.current?.clientHeight ?? 0;
        const scrollTop = scrollContainer.scrollTop;
        if (rowTop < scrollTop) {
          scrollContainer.scrollTo({ top: rowTop, behavior: 'smooth' });
        } else if (rowTop + ROW_HEIGHT > scrollTop + viewportH) {
          scrollContainer.scrollTo({ top: rowTop + ROW_HEIGHT - viewportH, behavior: 'smooth' });
        }
      }
    };

    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
  }, [songs, historyItems, isHistoryMode, selectedSongId, onSelect, onPlay]);

  return (
    <div className="flex-1 flex flex-col overflow-x-auto bg-gray-50 dark:bg-[#1a1a1a]">
      <div className={`${compact ? 'min-w-0' : isHistoryMode ? 'min-w-[840px]' : 'min-w-[760px]'} flex-1 flex flex-col min-h-0 bg-white dark:bg-[#121212]`}>
        {/* Table Header */}
        <div className="flex items-center px-4 py-2 border-b border-gray-200 dark:border-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-[#1a1a1a] shrink-0">
          <div className="w-8 flex-shrink-0"></div>
          {isHistoryMode ? (
            <>
              <div className="flex-1 min-w-[180px] pr-4">
                <SortHeader label="Name" column="title" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} />
              </div>
              <div className="w-40 flex-shrink-0 pr-4">
                <SortHeader label="Artist" column="artist" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} />
              </div>
              <div className="w-36 flex-shrink-0 pr-4">
                <SortHeader label="Played" column="playedAt" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} />
              </div>
              <div className="w-20 flex-shrink-0 pr-4 text-right">
                <SortHeader label="Listened" column="listenedSeconds" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} className="ml-auto" />
              </div>
              <div className="w-16 flex-shrink-0 pr-4 text-right">
                <SortHeader label="Plays" column="playCount" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} className="ml-auto" />
              </div>
              <div className="flex-1 min-w-[140px] pr-4">
                <SortHeader label="Album" column="album" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} />
              </div>
            </>
          ) : (
            <>
              <div className={`flex-1 pr-4 ${compact ? 'min-w-0' : 'min-w-[150px]'}`}>
                <SortHeader label="Name" column="title" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} />
              </div>
              <div className={`flex-1 pr-4 ${compact ? 'min-w-0' : 'min-w-[120px]'}`}>
                <SortHeader label="Artist" column="artist" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} />
              </div>
              <div className="w-16 flex-shrink-0 text-right pr-4">
                <SortHeader label="Time" column="duration" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} />
              </div>
              <div className={`w-11 flex-shrink-0 text-right pr-3 ${compact ? 'hidden' : ''}`}>
                <SortHeader label="#" column="trackNumber" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} className="ml-auto" />
              </div>
              <div className={`flex-1 min-w-[120px] pr-4 ${compact ? 'hidden' : ''}`}>
                <SortHeader label="Album" column="album" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} />
              </div>
              <div className={`w-24 flex-shrink-0 ${compact ? 'hidden' : ''}`}>
                <SortHeader label="Genre" column="genre" currentColumn={sortColumn} direction={sortDirection} onSort={onSort} />
              </div>
            </>
          )}
          <div className="w-16 flex-shrink-0 flex justify-end">
            <button onClick={onRescan} className="hover:text-blue-500 transition-colors" title="Rescan Library">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Virtualized Table Body */}
        <div ref={bodyRef} tabIndex={0} className="flex-1 overflow-hidden min-h-0 bg-white dark:bg-[#121212] outline-none">
          {isHistoryMode ? (
            historyItems.length > 0 ? (
              <List rowComponent={HistoryRow} rowCount={historyItems.length} rowHeight={ROW_HEIGHT} rowProps={historyRowProps} overscanCount={20} style={{ height: '100%', width: '100%' }} />
            ) : (
              <div className="p-8 text-center text-gray-500">No play history yet.</div>
            )
          ) : songs.length > 0 ? (
            <List rowComponent={SongRow} rowCount={songs.length} rowHeight={ROW_HEIGHT} rowProps={rowProps} overscanCount={20} style={{ height: '100%', width: '100%' }} />
          ) : (
            <div className="p-8 text-center text-gray-500">
              {isQueueMode ? 'Queue is empty.' : 'No songs found.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
