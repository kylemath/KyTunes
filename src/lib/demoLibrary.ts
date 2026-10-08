import type { Song } from '../types';

// Public-domain or CC0 recordings from Wikimedia Commons. The compositions are
// long out of copyright, and these particular performances were released with
// no restrictions (Musopen, the European Archive, or a public-domain mark).
const DEMO_TRACKS = [
  {
    file: 'bach-prelude-c.mp3',
    title: 'Prelude in C major, BWV 846',
    artist: 'Johann Sebastian Bach',
    album: 'The Well-Tempered Clavier, Book I',
    trackNumber: 1,
    duration: 254,
    comment: 'Public domain (CC0). Performance via Musopen.',
  },
  {
    file: 'mozart-eine-kleine-allegro.mp3',
    title: 'I. Allegro',
    artist: 'Wolfgang Amadeus Mozart',
    album: 'Eine kleine Nachtmusik',
    trackNumber: 1,
    duration: 253,
    comment: 'Public-domain recording from the European Archive.',
  },
  {
    file: 'beethoven-moonlight-adagio.mp3',
    title: 'I. Adagio sostenuto',
    artist: 'Ludwig van Beethoven',
    album: 'Moonlight Sonata',
    trackNumber: 1,
    duration: 336,
    comment: 'Public-domain recording. Paul Pitman for Musopen.',
  },
  {
    file: 'chopin-nocturne-op9-no2.mp3',
    title: 'Nocturne in E-flat major, Op. 9 No. 2',
    artist: 'Frédéric Chopin',
    album: 'Nocturnes, Op. 9',
    trackNumber: 2,
    duration: 272,
    comment: 'Public-domain recording. Frank Levy for Musopen.',
  },
  {
    file: 'vivaldi-spring-allegro.mp3',
    title: 'Spring, I. Allegro',
    artist: 'Antonio Vivaldi',
    album: 'The Four Seasons',
    trackNumber: 1,
    duration: 214,
    comment: 'Public-domain recording. The Modena Chamber Orchestra.',
  },
] as const;

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
    duration: track.duration,
    genre: 'Classical',
    comment: track.comment,
    streamUrl: `${base}demo/${track.file}`,
  }));
}
