export interface AlbumArtworkResult {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  releaseId: string;
  source: 'itunes' | 'musicbrainz';
}

// ── iTunes Search API ─────────────────────────────────────────────────────────
// Free, no API key, CORS-enabled, covers most mainstream releases.

interface iTunesResult {
  collectionId: number;
  collectionName: string;
  artistName: string;
  artworkUrl100?: string;
}

interface iTunesResponse {
  resultCount: number;
  results: iTunesResult[];
}

async function searchViaiTunes(album: string, artist: string): Promise<AlbumArtworkResult | null> {
  const term = `${artist} ${album}`.trim();
  const params = new URLSearchParams({ term, entity: 'album', media: 'music', limit: '10', country: 'US' });

  const res = await fetch(`https://itunes.apple.com/search?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);

  const data = await res.json() as iTunesResponse;
  if (!data.resultCount || data.results.length === 0) return null;

  const lAlbum = album.toLowerCase();
  const lArtist = artist.toLowerCase();

  // Prefer results that match both album and artist; fall back to any with artwork.
  const ranked = data.results
    .filter(r => r.artworkUrl100)
    .map(r => ({
      r,
      score:
        (r.collectionName.toLowerCase().includes(lAlbum) ? 2 : 0) +
        (r.artistName.toLowerCase().includes(lArtist) ? 2 : 0) +
        (r.collectionName.toLowerCase() === lAlbum ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.r;
  if (!best?.artworkUrl100) return null;

  // Apple artwork URLs end in e.g. "100x100bb.jpg" — swap the size token.
  const imageUrl = best.artworkUrl100.replace(/\d+x\d+bb\./, '600x600bb.');
  const thumbnailUrl = best.artworkUrl100.replace(/\d+x\d+bb\./, '300x300bb.');

  return {
    imageUrl,
    thumbnailUrl,
    sourceUrl: imageUrl,
    releaseId: String(best.collectionId),
    source: 'itunes',
  };
}

// ── MusicBrainz + Cover Art Archive ──────────────────────────────────────────

interface MusicBrainzRelease { id: string; score?: number; }
interface MusicBrainzSearchResponse { releases?: MusicBrainzRelease[]; }
interface CoverArtImage { image: string; front?: boolean; thumbnails?: Record<string, string | undefined>; }
interface CoverArtResponse { images?: CoverArtImage[]; }

async function searchViaMusicBrainz(album: string, artist: string): Promise<AlbumArtworkResult> {
  // Try progressively looser queries to maximise hit rate.
  const queries = [
    `release:"${album.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`,
    `release:${album.split(' ')[0]} AND artist:${artist.split(' ')[0]}`,
  ];

  for (const query of queries) {
    const params = new URLSearchParams({ query, fmt: 'json', limit: '5' });
    const searchRes = await fetch(`https://musicbrainz.org/ws/2/release?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'KyTunes/1.0 (kytunes)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!searchRes.ok) continue;

    const searchData = await searchRes.json() as MusicBrainzSearchResponse;
    const releases = (searchData.releases ?? []).sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));

    for (const release of releases) {
      const artRes = await fetch(`https://coverartarchive.org/release/${release.id}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!artRes.ok) continue;

      const artData = await artRes.json() as CoverArtResponse;
      const image = artData.images?.find(i => i.front) ?? artData.images?.[0];
      if (!image?.image) continue;

      return {
        imageUrl: image.image,
        thumbnailUrl: image.thumbnails?.['large'] ?? image.thumbnails?.['small'],
        sourceUrl: `https://coverartarchive.org/release/${release.id}/front`,
        releaseId: release.id,
        source: 'musicbrainz',
      };
    }
  }

  throw new Error('No artwork found in MusicBrainz / Cover Art Archive.');
}

// ── Artist image — TheAudioDB ─────────────────────────────────────────────────
// Free tier (key "2"), no account needed, CORS-enabled.
// Returns a square thumbnail used by Kodi, Navidrome, and many open-source players.

interface AudioDBArtist {
  strArtistThumb?: string;
  strArtistBanner?: string;
  strArtistFanart?: string;
}
interface AudioDBResponse { artists?: AudioDBArtist[]; }

export async function searchArtistImage(artist: string): Promise<string> {
  const errors: string[] = [];

  // 1. TheAudioDB — best free source for artist images
  try {
    const params = new URLSearchParams({ s: artist });
    const res = await fetch(`https://www.theaudiodb.com/api/v1/json/2/search.php?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json() as AudioDBResponse;
      const match = data.artists?.[0];
      const url = match?.strArtistThumb || match?.strArtistBanner || match?.strArtistFanart;
      if (url) return url;
      errors.push('TheAudioDB: no image for this artist');
    } else {
      errors.push(`TheAudioDB: HTTP ${res.status}`);
    }
  } catch (e) {
    errors.push(`TheAudioDB: ${e instanceof Error ? e.message : 'error'}`);
  }

  // 2. iTunes — search for the artist and grab artwork from their top album
  //    (a practical fallback when TheAudioDB doesn't have the artist)
  try {
    const params = new URLSearchParams({ term: artist, entity: 'musicArtist', media: 'music', limit: '1' });
    const res = await fetch(`https://itunes.apple.com/search?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      interface iTunesArtist { artistId: number; artistName: string; }
      const data = await res.json() as { resultCount: number; results: iTunesArtist[] };
      if (data.resultCount > 0) {
        const artistId = data.results[0].artistId;
        const albumParams = new URLSearchParams({ id: String(artistId), entity: 'topAlbum', limit: '1' });
        const albumRes = await fetch(`https://itunes.apple.com/lookup?${albumParams}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (albumRes.ok) {
          const albumData = await albumRes.json() as { results: Array<{ artworkUrl100?: string }> };
          const art = albumData.results?.find(r => r.artworkUrl100)?.artworkUrl100;
          if (art) return art.replace(/\d+x\d+bb\./, '600x600bb.');
        }
      }
    }
    errors.push('iTunes: no artist image found');
  } catch (e) {
    errors.push(`iTunes: ${e instanceof Error ? e.message : 'error'}`);
  }

  throw new Error(`No artist image found. (${errors.join(' · ')})`);
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function searchAlbumArtwork(album: string, artist: string): Promise<AlbumArtworkResult> {
  const errors: string[] = [];

  try {
    const result = await searchViaiTunes(album, artist);
    if (result) return result;
    errors.push('iTunes: no results');
  } catch (e) {
    errors.push(`iTunes: ${e instanceof Error ? e.message : 'error'}`);
  }

  try {
    return await searchViaMusicBrainz(album, artist);
  } catch (e) {
    errors.push(`MusicBrainz: ${e instanceof Error ? e.message : 'error'}`);
  }

  throw new Error(`No artwork found. (${errors.join(' · ')})`);
}
