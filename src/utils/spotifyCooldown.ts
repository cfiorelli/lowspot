export interface SpotifyCooldown {
  path: string;
  until: number;
}

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || 'unknown-client';
const STORAGE_KEY = `lowspot:spotify-cooldowns:${CLIENT_ID}`;

const readAll = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
    );
  } catch {
    return {};
  }
};

const writeAll = (cooldowns: Record<string, number>): void => {
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
  const until = cooldowns[normalized] ?? 0;

  if (until <= Date.now()) {
    if (until) {
      delete cooldowns[normalized];
      writeAll(cooldowns);
    }
    return null;
  }

  return { path: normalized, until };
};

export const setSpotifyCooldown = (path: string, retryAfterMs: number): SpotifyCooldown => {
  const normalized = normalizeSpotifyPath(path);
  const cooldowns = readAll();
  const until = Date.now() + Math.max(1000, retryAfterMs);
  cooldowns[normalized] = Math.max(cooldowns[normalized] ?? 0, until);
  writeAll(cooldowns);
  return { path: normalized, until: cooldowns[normalized] };
};

export const getActiveSpotifyCooldowns = (): SpotifyCooldown[] => {
  const now = Date.now();
  const cooldowns = readAll();
  const active = Object.entries(cooldowns)
    .filter(([, until]) => until > now)
    .map(([path, until]) => ({ path, until }))
    .sort((a, b) => b.until - a.until);

  if (active.length !== Object.keys(cooldowns).length) {
    writeAll(Object.fromEntries(active.map((cooldown) => [cooldown.path, cooldown.until])));
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
