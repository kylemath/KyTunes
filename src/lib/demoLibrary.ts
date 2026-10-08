import type { Song } from '../types';

const DEMO_TRACKS = [
  { file: 'north-window.wav', title: 'North Window', artist: 'KyTunes Demo', album: 'Window Songs', trackNumber: 1 },
  { file: 'kitchen-radio.wav', title: 'Kitchen Radio', artist: 'KyTunes Demo', album: 'Window Songs', trackNumber: 2 },
  { file: 'night-bus.wav', title: 'Night Bus', artist: 'KyTunes Demo', album: 'Night Bus', trackNumber: 1 },
] as const;

export const DEMO_DURATION = 8;

export function isGithubPages(): boolean {
  return window.location.hostname.endsWith('github.io');
}

export function demoSongs(): Song[] {
  const base = import.meta.env.BASE_URL;
  return DEMO_TRACKS.map((track) => ({
    id: `demo/${track.file}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    trackNumber: track.trackNumber,
    duration: DEMO_DURATION,
    genre: 'Demo',
    streamUrl: `${base}demo/${track.file}`,
  }));
}
