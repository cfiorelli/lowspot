import type { SpotifyAlbum, SpotifyArtist, SpotifyPlaylist, SpotifyTrack } from '../spotify/types';

export interface CachedLikedSong {
  added_at: string;
  track: SpotifyTrack;
}

export interface CachedLikedAlbum {
  added_at: string;
  album: SpotifyAlbum;
}

// Slim storage formats — only the fields we display, so 9000 songs stays well under
// localStorage's 5 MB limit. Raw Spotify API objects include available_markets
// (~100 country codes), preview_url, images, href, etc., which bloat each entry
// 5–10× compared to what we actually use.
interface StoredSong {
  added_at: string;
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  explicit: boolean;
  artists: Array<{ id: string; name: string }>;
}

interface StoredAlbum {
  added_at: string;
  id: string;
  name: string;
  album_type: string;
  release_date: string;
  total_tracks: number;
  artists: Array<{ id: string; name: string }>;
}

const KEYS = {
  likedSongs: 'lowspot:cache:liked-songs-v2',
  likedAlbums: 'lowspot:cache:liked-albums-v2',
  playlists: 'lowspot:cache:playlists',
};

function loadRaw<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveRaw<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn('[cache] localStorage write failed for', key, '—', error instanceof Error ? error.message : String(error));
  }
}

function slimArtist(a: SpotifyArtist): { id: string; name: string } {
  return { id: a.id, name: a.name };
}

function slimTrack(entry: CachedLikedSong): StoredSong {
  const t = entry.track;
  return {
    added_at: entry.added_at,
    id: t.id,
    name: t.name,
    uri: t.uri,
    duration_ms: t.duration_ms,
    explicit: t.explicit,
    artists: t.artists.map(slimArtist),
  };
}

function expandSong(s: StoredSong): CachedLikedSong {
  return {
    added_at: s.added_at,
    track: {
      id: s.id,
      name: s.name,
      uri: s.uri,
      duration_ms: s.duration_ms,
      explicit: s.explicit,
      type: 'track',
      artists: s.artists.map((a) => ({ ...a, type: 'artist' as const })),
      album: { id: '', name: '', album_type: '', artists: [], release_date: '', total_tracks: 0 },
    },
  };
}

function slimAlbum(entry: CachedLikedAlbum): StoredAlbum {
  const a = entry.album;
  return {
    added_at: entry.added_at,
    id: a.id,
    name: a.name,
    album_type: a.album_type,
    release_date: a.release_date,
    total_tracks: a.total_tracks,
    artists: a.artists.map(slimArtist),
  };
}

function expandAlbum(s: StoredAlbum): CachedLikedAlbum {
  return {
    added_at: s.added_at,
    album: {
      id: s.id,
      name: s.name,
      album_type: s.album_type,
      release_date: s.release_date,
      total_tracks: s.total_tracks,
      artists: s.artists.map((a) => ({ ...a, type: 'artist' as const })),
    },
  };
}

function isStoredSong(value: unknown): value is StoredSong {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' &&
    typeof v.uri === 'string' && typeof v.added_at === 'string' &&
    Array.isArray(v.artists);
}

function isStoredAlbum(value: unknown): value is StoredAlbum {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' &&
    typeof v.added_at === 'string' && Array.isArray(v.artists);
}

export function loadCachedLikedSongs(): CachedLikedSong[] {
  const raw = loadRaw<unknown>(KEYS.likedSongs);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): CachedLikedSong[] => isStoredSong(item) ? [expandSong(item)] : []);
}

export function saveCachedLikedSongs(items: CachedLikedSong[]): void {
  saveRaw(KEYS.likedSongs, items.map(slimTrack));
}

export function loadCachedLikedAlbums(): CachedLikedAlbum[] {
  const raw = loadRaw<unknown>(KEYS.likedAlbums);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): CachedLikedAlbum[] => isStoredAlbum(item) ? [expandAlbum(item)] : []);
}

export function saveCachedLikedAlbums(items: CachedLikedAlbum[]): void {
  saveRaw(KEYS.likedAlbums, items.map(slimAlbum));
}

function isSpotifyPlaylist(value: unknown): value is SpotifyPlaylist {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' &&
    typeof v.uri === 'string' && typeof v.tracks === 'object';
}

export function loadCachedPlaylists(): SpotifyPlaylist[] {
  const raw = loadRaw<unknown>(KEYS.playlists);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSpotifyPlaylist);
}

export function saveCachedPlaylists(items: SpotifyPlaylist[]): void {
  saveRaw(KEYS.playlists, items.filter(isSpotifyPlaylist));
}
