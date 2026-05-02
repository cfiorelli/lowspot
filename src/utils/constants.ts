export const APP_NAME = 'lowspot';

export const SPOTIFY_ACCOUNTS_BASE = 'https://accounts.spotify.com';
export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

export const REQUIRED_SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-recently-played',
  'streaming',
] as const;

// Playback polling: 8s keeps us well within Spotify's rate limits.
// Do NOT lower without adjusting RATE_LIMIT_BUDGET.
export const POLL_INTERVAL_MS = 8_000;

// Delay between library-sync page fetches. 500ms ≈ 60 req/30s for sync,
// leaving budget for polling + user actions.
export const LIBRARY_PAGE_DELAY_MS = 500;

// Proactive client-side rate limit. Spotify's window is ~30s.
// Cap at 100 req/30s (empirical limit ~180) to prevent 429s entirely.
export const RATE_LIMIT_BUDGET = 100;
export const RATE_LIMIT_WINDOW_MS = 30_000;

// The app starts in the compact/collapsed view. The codebase calls that mode "lean".
export const DEFAULT_MODE = 'lean' as const;

export const LOGIN_SIZE = { width: 640, height: 560 };
export const COLLAPSED_SIZE = { width: 900, height: 300 };
export const LEAN_SIZE = COLLAPSED_SIZE;
export const EXPANDED_SIZE = { width: 1080, height: 760 };

export const MIN_SIZE = { width: 560, height: 300 };

export const NAV_ITEMS = [
  'Now Playing',
  'Search',
  'Liked Songs',
  'Liked Albums',
  'Playlists',
  'Podcasts',
  'Audiobooks',
  'Queue',
  'Recently Played',
  'Settings',
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
