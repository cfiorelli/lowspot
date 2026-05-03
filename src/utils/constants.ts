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

// Playback polling: keep this conservative. Spotify rate limits are app-wide
// in a rolling 30 second window, and development-mode apps have lower quota.
// Do NOT lower without adjusting RATE_LIMIT_BUDGET.
export const POLL_INTERVAL_MS = 15_000;
export const PAUSED_PLAYBACK_POLL_INTERVAL_MS = 60_000;
export const IDLE_PLAYBACK_POLL_INTERVAL_MS = 120_000;

// Delay between library-sync page fetches. 1000ms is deliberately slower than
// the theoretical limit so playback, search, and UI probes still have room.
export const LIBRARY_PAGE_DELAY_MS = 1_000;

// Proactive client-side request budget for Spotify's rolling 30s window.
// Spotify does not publish the exact number and it varies by quota mode.
export const RATE_LIMIT_BUDGET = 40;
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
