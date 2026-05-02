export interface SpotifyCooldown {
  path: string;
  until: number;
  strikes?: number;
}

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || 'unknown-client';
const STORAGE_KEY = `lowspot:spotify-cooldowns:${CLIENT_ID}`;
const STRIKE_WINDOW_MS = 10 * 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

interface StoredCooldown {
  until: number;
  strikes: number;
  lastHitAt: number;
}

const isStoredCooldown = (value: unknown): value is StoredCooldown => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.until === 'number' &&
    typeof v.strikes === 'number' &&
    typeof v.lastHitAt === 'number';
};

const readAll = (): Record<string, StoredCooldown> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed).flatMap(([path, value]) => {
      if (typeof value === 'number') {
        return [[path, { until: value, strikes: 1, lastHitAt: now }]];
      }
      if (isStoredCooldown(value)) return [[path, value]];
      return [];
    }));
  } catch {
    return {};
  }
};

const writeAll = (cooldowns: Record<string, StoredCooldown>): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cooldowns));
  } catch {
    // Cooldown persistence is protective but non-critical.
  }
};

export const normalizeSpotifyPath = (path: string): string => {
  const pathname = path.split('?')[0] || path;
  if (pathname === '/me/tracks/contains') return pathname;
  if (pathname === '/me/tracks') return pathname;
  if (pathname === '/me/albums') return pathname;
  if (pathname === '/me/playlists') return pathname;
  if (pathname.startsWith('/me/player')) return pathname;
  if (pathname === '/search') return pathname;
  return pathname;
};

export const getSpotifyCooldown = (path: string): SpotifyCooldown | null => {
  const normalized = normalizeSpotifyPath(path);
  const cooldowns = readAll();
  const cooldown = cooldowns[normalized];
  const until = cooldown?.until ?? 0;

  if (until <= Date.now()) {
    if (until) {
      delete cooldowns[normalized];
      writeAll(cooldowns);
    }
    return null;
  }

  return { path: normalized, until, strikes: cooldown?.strikes };
};

export const setSpotifyCooldown = (path: string, retryAfterMs: number): SpotifyCooldown => {
  const normalized = normalizeSpotifyPath(path);
  const cooldowns = readAll();
  const now = Date.now();
  const previous = cooldowns[normalized];
  const previousHitIsRecent = previous ? now - previous.lastHitAt < STRIKE_WINDOW_MS : false;
  const strikes = previousHitIsRecent ? previous.strikes + 1 : 1;
  const serverBackoff = Math.max(1000, retryAfterMs);
  const localBackoff = Math.min(serverBackoff * 2 ** (strikes - 1), MAX_BACKOFF_MS);
  const until = now + Math.max(serverBackoff, localBackoff);
  cooldowns[normalized] = {
    until: Math.max(previous?.until ?? 0, until),
    strikes,
    lastHitAt: now,
  };
  writeAll(cooldowns);
  return { path: normalized, until: cooldowns[normalized].until, strikes };
};

export const getActiveSpotifyCooldowns = (): SpotifyCooldown[] => {
  const now = Date.now();
  const cooldowns = readAll();
  const active = Object.entries(cooldowns)
    .filter(([, cooldown]) => cooldown.until > now)
    .map(([path, cooldown]) => ({ path, until: cooldown.until, strikes: cooldown.strikes }))
    .sort((a, b) => b.until - a.until);

  if (active.length !== Object.keys(cooldowns).length) {
    writeAll(Object.fromEntries(active.map((cooldown) => [
      cooldown.path,
      { until: cooldown.until, strikes: cooldown.strikes ?? 1, lastHitAt: now },
    ])));
  }

  return active;
};

export const clearSpotifyCooldowns = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
};

export const formatCooldownRemaining = (until: number): string => {
  const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
};
