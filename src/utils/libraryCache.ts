import { Store } from '@tauri-apps/plugin-store';
import type { SpotifyAlbum, SpotifyArtist, SpotifyPlaylist, SpotifyTrack } from '../spotify/types';

export interface CachedLikedSong {
  added_at: string;
  track: SpotifyTrack;
}

export interface CachedLikedAlbum {
  added_at: string;
  album: SpotifyAlbum;
}

type CacheBackend = 'tauriStore' | 'indexedDB' | 'localStorage';

export interface CacheWriteResult {
  ok: boolean;
  backend: CacheBackend | 'none';
  error?: string;
}

export type CacheKind = 'likedSongs' | 'likedAlbums' | 'playlists';

export interface CacheMeta {
  syncedAt: number;
  total?: number;
  complete?: boolean;
}

// Slim storage formats: only the fields the UI/playback path needs.
// The raw Spotify objects carry large available_markets/images/href payloads.
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

const DB_NAME = 'lowspot-library-cache';
const DB_VERSION = 1;
const DB_STORE = 'snapshots';
const STORE_FILE = 'lowspot_library_cache.json';

const KEYS = {
  likedSongs: 'lowspot:cache:liked-songs-v2',
  likedAlbums: 'lowspot:cache:liked-albums-v2',
  playlists: 'lowspot:cache:playlists',
};

const META_KEYS: Record<CacheKind, string> = {
  likedSongs: `${KEYS.likedSongs}:meta`,
  likedAlbums: `${KEYS.likedAlbums}:meta`,
  playlists: `${KEYS.playlists}:meta`,
};

let dbPromise: Promise<IDBDatabase | null> | null = null;
let storePromise: Promise<Store | null> | null = null;

const storageError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const canUseLocalStorage = (): boolean => typeof localStorage !== 'undefined';

const canUseIndexedDb = (): boolean => typeof indexedDB !== 'undefined';

const getTauriStore = async (): Promise<Store | null> => {
  if (storePromise) return storePromise;

  storePromise = Store.load(STORE_FILE).catch((error) => {
    console.warn('[cache] Tauri Store unavailable:', storageError(error));
    return null;
  });

  return storePromise;
};

const openCacheDb = (): Promise<IDBDatabase | null> => {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => {
      console.warn('[cache] IndexedDB open failed:', storageError(request.error));
      resolve(null);
    };

    request.onblocked = () => {
      console.warn('[cache] IndexedDB upgrade is blocked by another lowspot window.');
    };
  });

  return dbPromise;
};

interface IndexedDbRead<T> {
  found: boolean;
  value?: T;
}

async function readIndexedDb<T>(key: string): Promise<IndexedDbRead<T>> {
  const db = await openCacheDb();
  if (!db) return { found: false };

  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const request = tx.objectStore(DB_STORE).get(key);

    request.onsuccess = () => {
      if (request.result === undefined) {
        resolve({ found: false });
        return;
      }

      resolve({ found: true, value: request.result as T });
    };

    request.onerror = () => {
      console.warn('[cache] IndexedDB read failed for', key, '-', storageError(request.error));
      resolve({ found: false });
    };
  });
}

async function writeIndexedDb<T>(key: string, data: T): Promise<void> {
  const db = await openCacheDb();
  if (!db) throw new Error('IndexedDB unavailable');

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const request = tx.objectStore(DB_STORE).put(data, key);

    request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.oncomplete = () => resolve();
  });
}

async function readTauriStore<T>(key: string): Promise<IndexedDbRead<T>> {
  const store = await getTauriStore();
  if (!store) return { found: false };

  try {
    const value = await store.get<T>(key);
    return value === undefined || value === null
      ? { found: false }
      : { found: true, value };
  } catch (error) {
    console.warn('[cache] Tauri Store read failed for', key, '-', storageError(error));
    return { found: false };
  }
}

async function writeTauriStore<T>(key: string, data: T): Promise<void> {
  const store = await getTauriStore();
  if (!store) throw new Error('Tauri Store unavailable');

  await store.set(key, data);
  await store.save();
}

function readLocalStorage<T>(key: string): T | null {
  if (!canUseLocalStorage()) return null;

  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage<T>(key: string, data: T): CacheWriteResult {
  if (!canUseLocalStorage()) {
    return { ok: false, backend: 'none', error: 'localStorage unavailable' };
  }

  try {
    localStorage.setItem(key, JSON.stringify(data));
    return { ok: true, backend: 'localStorage' };
  } catch (error) {
    return { ok: false, backend: 'none', error: storageError(error) };
  }
}

function removeLocalStorage(key: string): void {
  if (!canUseLocalStorage()) return;

  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup only.
  }
}

async function loadRaw<T>(key: string): Promise<T | null> {
  const stored = await readTauriStore<T>(key);
  if (stored.found) return stored.value ?? null;

  const indexed = await readIndexedDb<T>(key);
  if (indexed.found) {
    const value = indexed.value ?? null;
    if (value !== null) {
      await saveRaw(key, value);
    }
    return value;
  }

  const local = readLocalStorage<T>(key);
  if (!local) return null;

  const migrated = await saveRaw(key, local);
  if (migrated.ok && migrated.backend === 'indexedDB') {
    removeLocalStorage(key);
  }

  return local;
}

async function saveRaw<T>(key: string, data: T): Promise<CacheWriteResult> {
  try {
    await writeTauriStore(key, data);
    removeLocalStorage(key);
    return { ok: true, backend: 'tauriStore' };
  } catch (storeError) {
    console.warn('[cache] Tauri Store write failed for', key, '-', storageError(storeError));
  }

  try {
    await writeIndexedDb(key, data);
    removeLocalStorage(key);
    return { ok: true, backend: 'indexedDB' };
  } catch (indexedDbError) {
    console.warn('[cache] IndexedDB write failed for', key, '-', storageError(indexedDbError));
  }

  const local = writeLocalStorage(key, data);
  if (!local.ok) {
    console.warn('[cache] localStorage write failed for', key, '-', local.error ?? 'unknown error');
  }
  return local;
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

export async function loadCachedLikedSongs(): Promise<CachedLikedSong[]> {
  const raw = await loadRaw<unknown>(KEYS.likedSongs);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): CachedLikedSong[] => isStoredSong(item) ? [expandSong(item)] : []);
}

export async function saveCachedLikedSongs(items: CachedLikedSong[]): Promise<CacheWriteResult> {
  return saveRaw(KEYS.likedSongs, items.map(slimTrack));
}

export async function loadCachedLikedAlbums(): Promise<CachedLikedAlbum[]> {
  const raw = await loadRaw<unknown>(KEYS.likedAlbums);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): CachedLikedAlbum[] => isStoredAlbum(item) ? [expandAlbum(item)] : []);
}

export async function saveCachedLikedAlbums(items: CachedLikedAlbum[]): Promise<CacheWriteResult> {
  return saveRaw(KEYS.likedAlbums, items.map(slimAlbum));
}

function isSpotifyPlaylist(value: unknown): value is SpotifyPlaylist {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' &&
    typeof v.uri === 'string' && typeof v.tracks === 'object';
}

export async function loadCachedPlaylists(): Promise<SpotifyPlaylist[]> {
  const raw = await loadRaw<unknown>(KEYS.playlists);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSpotifyPlaylist);
}

export async function saveCachedPlaylists(items: SpotifyPlaylist[]): Promise<CacheWriteResult> {
  return saveRaw(KEYS.playlists, items.filter(isSpotifyPlaylist));
}

function isCacheMeta(value: unknown): value is CacheMeta {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.syncedAt === 'number' && Number.isFinite(v.syncedAt);
}

export async function loadCacheMeta(kind: CacheKind): Promise<CacheMeta | null> {
  const raw = await loadRaw<unknown>(META_KEYS[kind]);
  return isCacheMeta(raw) ? raw : null;
}

export async function saveCacheMeta(kind: CacheKind, meta: CacheMeta): Promise<CacheWriteResult> {
  return saveRaw(META_KEYS[kind], meta);
}
