import { Store } from '@tauri-apps/plugin-store';

export interface SpotifyDiagnosticEntry {
  id: string;
  timestamp: number;
  context: string;
  method: string;
  path: string;
  outcome: 'response' | 'local-cooldown' | 'local-throttle' | 'network-error';
  status?: number;
  statusText?: string;
  retryAfter?: string | null;
  retryAfterMs?: number;
  durationMs?: number;
  bodySnippet?: string;
  error?: string;
  budgetUsed?: number;
  budgetLimit?: number;
}

const STORE_FILE = 'lowspot_spotify_diagnostics.json';
const STORE_KEY = 'spotify_request_diagnostics';
const LOCAL_STORAGE_KEY = 'lowspot:spotify-diagnostics';
const MAX_ENTRIES = 200;

let storePromise: Promise<Store | null> | null = null;
let memoryEntries: SpotifyDiagnosticEntry[] | null = null;
let writeQueue: Promise<void> = Promise.resolve();

const getStore = async (): Promise<Store | null> => {
  if (storePromise) return storePromise;

  storePromise = Store.load(STORE_FILE).catch(() => null);
  return storePromise;
};

const isEntry = (value: unknown): value is SpotifyDiagnosticEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' &&
    typeof v.timestamp === 'number' &&
    typeof v.context === 'string' &&
    typeof v.method === 'string' &&
    typeof v.path === 'string' &&
    typeof v.outcome === 'string';
};

const readLocalStorage = (): SpotifyDiagnosticEntry[] => {
  if (typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
};

const writeLocalStorage = (entries: SpotifyDiagnosticEntry[]): void => {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Diagnostics are helpful, but they should never break the app.
  }
};

export const loadSpotifyDiagnostics = async (): Promise<SpotifyDiagnosticEntry[]> => {
  if (memoryEntries) return memoryEntries;

  const store = await getStore();
  if (store) {
    try {
      const stored = await store.get<unknown>(STORE_KEY);
      memoryEntries = Array.isArray(stored) ? stored.filter(isEntry) : [];
      return memoryEntries;
    } catch {
      // Fall through to localStorage.
    }
  }

  memoryEntries = readLocalStorage();
  return memoryEntries;
};

const saveSpotifyDiagnostics = async (entries: SpotifyDiagnosticEntry[]): Promise<void> => {
  memoryEntries = entries.slice(-MAX_ENTRIES);

  const store = await getStore();
  if (store) {
    try {
      await store.set(STORE_KEY, memoryEntries);
      await store.save();
      return;
    } catch {
      // Fall through to localStorage.
    }
  }

  writeLocalStorage(memoryEntries);
};

const makeId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const recordSpotifyDiagnostic = async (
  entry: Omit<SpotifyDiagnosticEntry, 'id' | 'timestamp'> & { timestamp?: number },
): Promise<void> => {
  const nextEntry = {
    id: makeId(),
    timestamp: entry.timestamp ?? Date.now(),
    ...entry,
  };

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const entries = await loadSpotifyDiagnostics();
      await saveSpotifyDiagnostics([...entries, nextEntry]);
    })
    .catch(() => undefined);

  await writeQueue;
};

export const clearSpotifyDiagnostics = async (): Promise<void> => {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => saveSpotifyDiagnostics([]))
    .catch(() => undefined);

  await writeQueue;
};
