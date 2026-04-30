import type { SpotifyAlbum, SpotifyPlaylist, SpotifyTrack } from '../spotify/types';

export interface CachedLikedSong {
  added_at: string;
  track: SpotifyTrack;
}

export interface CachedLikedAlbum {
  added_at: string;
  album: SpotifyAlbum;
}

const KEYS = {
  likedSongs: 'lowspot:cache:liked-songs',
  likedAlbums: 'lowspot:cache:liked-albums',
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
  } catch {
    // Storage quota exceeded — silently skip
  }
}

export function loadCachedLikedSongs(): CachedLikedSong[] {
  const raw = loadRaw<unknown>(KEYS.likedSongs);
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item): CachedLikedSong[] => {
    if (isCachedLikedSong(item)) return [item];
    if (isSpotifyTrack(item)) return [{ added_at: '', track: item }];
    return [];
  });
}

export function saveCachedLikedSongs(items: CachedLikedSong[]): void {
  saveRaw(KEYS.likedSongs, items.filter(isCachedLikedSong));
}

export function loadCachedLikedAlbums(): CachedLikedAlbum[] {
  const raw = loadRaw<unknown>(KEYS.likedAlbums);
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item): CachedLikedAlbum[] => {
    if (isCachedLikedAlbum(item)) return [item];
    if (isSpotifyAlbum(item)) return [{ added_at: '', album: item }];
    return [];
  });
}

export function saveCachedLikedAlbums(items: CachedLikedAlbum[]): void {
  saveRaw(KEYS.likedAlbums, items.filter(isCachedLikedAlbum));
}

export function loadCachedPlaylists(): SpotifyPlaylist[] {
  const raw = loadRaw<unknown>(KEYS.playlists);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSpotifyPlaylist);
}

export function saveCachedPlaylists(items: SpotifyPlaylist[]): void {
  saveRaw(KEYS.playlists, items.filter(isSpotifyPlaylist));
}

function hasString(value: unknown, key: string): boolean {
  return typeof value === 'object' &&
    value !== null &&
    key in value &&
    typeof (value as Record<string, unknown>)[key] === 'string';
}

function isSpotifyTrack(value: unknown): value is SpotifyTrack {
  return hasString(value, 'id') &&
    hasString(value, 'name') &&
    hasString(value, 'uri') &&
    Array.isArray((value as Partial<SpotifyTrack>).artists);
}

function isSpotifyAlbum(value: unknown): value is SpotifyAlbum {
  return hasString(value, 'id') &&
    hasString(value, 'name') &&
    Array.isArray((value as Partial<SpotifyAlbum>).artists);
}

function isSpotifyPlaylist(value: unknown): value is SpotifyPlaylist {
  return hasString(value, 'id') &&
    hasString(value, 'name') &&
    hasString(value, 'uri') &&
    typeof (value as Partial<SpotifyPlaylist>).tracks === 'object';
}

function isCachedLikedSong(value: unknown): value is CachedLikedSong {
  return typeof value === 'object' &&
    value !== null &&
    'track' in value &&
    isSpotifyTrack((value as Partial<CachedLikedSong>).track) &&
    typeof (value as Partial<CachedLikedSong>).added_at === 'string';
}

function isCachedLikedAlbum(value: unknown): value is CachedLikedAlbum {
  return typeof value === 'object' &&
    value !== null &&
    'album' in value &&
    isSpotifyAlbum((value as Partial<CachedLikedAlbum>).album) &&
    typeof (value as Partial<CachedLikedAlbum>).added_at === 'string';
}
