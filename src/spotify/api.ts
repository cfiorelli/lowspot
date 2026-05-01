import { RATE_LIMIT_BUDGET, RATE_LIMIT_WINDOW_MS, SPOTIFY_API_BASE } from '../utils/constants';
import { getSpotifyCooldown, setSpotifyCooldown } from '../utils/spotifyCooldown';
import type {
  Device,
  PlaybackState,
  QueueResponse,
  RecentlyPlayedItem,
  SearchResponse,
  SpotifyAlbum,
  SpotifyPlaylist,
  SpotifyTrack,
} from './types';

interface PageResponse<T> {
  items: T[];
  limit: number;
  next: string | null;
  offset: number;
  previous: string | null;
  total: number;
}

export class SpotifyRateLimitError extends Error {
  path: string;
  retryAfterMs: number;

  constructor(path: string, retryAfterMs: number) {
    super(`Spotify rate limit reached on ${path}. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`);
    this.name = 'SpotifyRateLimitError';
    this.path = path;
    this.retryAfterMs = retryAfterMs;
  }
}

export class SpotifyApiClient {
  private accessToken: string;
  private rateLimitedUntil = 0;
  private cancelled = false;

  // Sliding-window log: timestamps of recent requests.
  // Enforces RATE_LIMIT_BUDGET req / RATE_LIMIT_WINDOW_MS proactively.
  private requestLog: number[] = [];

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  setToken(token: string) {
    this.accessToken = token;
  }

  cancel() {
    this.cancelled = true;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Delay if we have issued RATE_LIMIT_BUDGET requests in the last RATE_LIMIT_WINDOW_MS.
  // This is the primary protection against 429s — prevents them from occurring.
  private async waitForBudget(): Promise<void> {
    if (this.cancelled) throw new Error('cancelled');

    const now = Date.now();
    this.requestLog = this.requestLog.filter((t) => t > now - RATE_LIMIT_WINDOW_MS);

    if (this.requestLog.length < RATE_LIMIT_BUDGET) {
      this.requestLog.push(now);
      return;
    }

    const oldest = this.requestLog[0];
    const waitMs = oldest + RATE_LIMIT_WINDOW_MS - now + 100;
    console.info(
      '[spotify] proactive throttle —',
      this.requestLog.length,
      'req in last 30s, waiting',
      Math.ceil(waitMs / 1000) + 's',
    );
    await this.wait(Math.max(waitMs, 100));
    return this.waitForBudget();
  }

  private async doRequest<T>(path: string, init: RequestInit, attempt: number): Promise<T> {
    // Proactive throttle runs first — keeps us under the budget.
    await this.waitForBudget();

    if (this.cancelled) throw new Error('cancelled');

    // Cross-session persisted cooldown. If it is short enough, wait it out;
    // otherwise surface it to the caller so the UI can show a countdown.
    const persistedCooldown = getSpotifyCooldown(path);
    if (persistedCooldown) {
      const remainingMs = persistedCooldown.until - Date.now();
      if (remainingMs > 30_000) {
        throw new SpotifyRateLimitError(persistedCooldown.path, remainingMs);
      }
      if (remainingMs > 0) {
        console.info('[spotify] persisted cooldown', path, '— waiting', Math.ceil(remainingMs / 1000) + 's');
        await this.wait(remainingMs);
      }
    }

    // In-session rate-limit pause set by a 429 response — wait, then proceed.
    const pause = this.rateLimitedUntil - Date.now();
    if (pause > 0) {
      console.info('[spotify] in-session pause', Math.ceil(pause / 1000) + 's before', path);
      await this.wait(pause);
    }

    if (this.cancelled) throw new Error('cancelled');

    let response: Response;
    try {
      response = await fetch(`${SPOTIFY_API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      if (attempt < 3 && !this.cancelled) {
        await this.wait(Math.min(300 * 2 ** attempt, 5000));
        return this.doRequest(path, init, attempt + 1);
      }
      throw error;
    }

    if (response.status === 429) {
      const header = response.headers.get('Retry-After');
      const retryAfterSec =
        header !== null && Number.isFinite(Number(header)) ? Math.max(1, Number(header)) : null;
      // 30s flat fallback — matches Spotify's rolling window length.
      const backoff = retryAfterSec !== null ? retryAfterSec * 1000 : 30_000;
      console.warn(
        '[spotify] 429',
        path,
        '— Retry-After:',
        header ?? '(absent)',
        '— attempt:',
        attempt,
        '— backoff:',
        Math.round(backoff / 1000) + 's',
      );
      this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + backoff);
      setSpotifyCooldown(path, backoff);
      if (attempt < 3 && !this.cancelled) {
        // Next call's in-session pause check will handle the wait.
        return this.doRequest(path, init, attempt + 1);
      }
      throw new SpotifyRateLimitError(path, backoff);
    }

    if (response.status >= 500 && attempt < 3 && !this.cancelled) {
      await this.wait(Math.min(300 * 2 ** attempt, 5000));
      return this.doRequest(path, init, attempt + 1);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.doRequest(path, init, 0);
  }

  getProfile() {
    return this.request<{ id: string; email: string; display_name: string }>('/me');
  }

  getPlaybackState() {
    return this.request<PlaybackState>('/me/player');
  }

  getCurrentPlayback() {
    return this.request<PlaybackState>('/me/player/currently-playing');
  }

  getDevices() {
    return this.request<{ devices: Device[] }>('/me/player/devices');
  }

  transferPlayback(deviceId: string, play = false) {
    return this.request<void>('/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [deviceId], play }),
    });
  }

  play(deviceId?: string, uris?: string[], contextUri?: string) {
    const params = new URLSearchParams();
    if (deviceId) params.set('device_id', deviceId);

    const body: Record<string, unknown> = {};
    if (uris && uris.length > 0) body.uris = uris;
    if (contextUri) body.context_uri = contextUri;

    return this.request<void>(`/me/player/play${params.toString() ? `?${params.toString()}` : ''}`, {
      method: 'PUT',
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    });
  }

  pause() {
    return this.request<void>('/me/player/pause', { method: 'PUT' });
  }

  next() {
    return this.request<void>('/me/player/next', { method: 'POST' });
  }

  previous() {
    return this.request<void>('/me/player/previous', { method: 'POST' });
  }

  seek(positionMs: number) {
    return this.request<void>(`/me/player/seek?position_ms=${positionMs}`, { method: 'PUT' });
  }

  setShuffle(enabled: boolean) {
    return this.request<void>(`/me/player/shuffle?state=${enabled}`, { method: 'PUT' });
  }

  setRepeat(state: 'off' | 'track' | 'context') {
    return this.request<void>(`/me/player/repeat?state=${state}`, { method: 'PUT' });
  }

  setVolume(volumePercent: number) {
    return this.request<void>(`/me/player/volume?volume_percent=${volumePercent}`, { method: 'PUT' });
  }

  getQueue() {
    return this.request<QueueResponse>('/me/player/queue');
  }

  getRecentlyPlayed(limit = 30) {
    return this.request<{ items: RecentlyPlayedItem[] }>(`/me/player/recently-played?limit=${limit}`);
  }

  getLikedSongs(limit = 50, offset = 0) {
    return this.request<PageResponse<{ added_at: string; track: SpotifyTrack | null }>>(
      `/me/tracks?limit=${limit}&offset=${offset}`,
    );
  }

  getLikedAlbums(limit = 50, offset = 0) {
    return this.request<PageResponse<{ added_at: string; album: SpotifyAlbum | null }>>(
      `/me/albums?limit=${limit}&offset=${offset}`,
    );
  }

  getPlaylists(limit = 50, offset = 0) {
    return this.request<PageResponse<SpotifyPlaylist>>(`/me/playlists?limit=${limit}&offset=${offset}`);
  }

  isTrackSaved(trackId: string) {
    return this.request<boolean[]>(`/me/tracks/contains?ids=${trackId}`);
  }

  saveTrack(trackId: string) {
    return this.request<void>(`/me/tracks?ids=${trackId}`, { method: 'PUT' });
  }

  removeTrack(trackId: string) {
    return this.request<void>(`/me/tracks?ids=${trackId}`, { method: 'DELETE' });
  }

  search(query: string) {
    const runSearch = (types: string, limit: number) => {
      const params = new URLSearchParams({ q: query, type: types, limit: String(limit) });
      return this.request<SearchResponse>(`/search?${params.toString()}`);
    };

    const normalize = (result: SearchResponse): SearchResponse => ({
      tracks: result.tracks ?? { items: [] },
      albums: result.albums ?? { items: [] },
      artists: result.artists ?? { items: [] },
      playlists: result.playlists ?? { items: [] },
      shows: result.shows ?? { items: [] },
      audiobooks: result.audiobooks ?? { items: [] },
    });

    return runSearch('track,album,artist,playlist', 20)
      .then((base) => normalize(base))
      .then(async (base) => {
        let merged = base;

        try {
          const extra = await runSearch('show,audiobook', 10);
          merged = {
            ...merged,
            shows: extra.shows ?? { items: [] },
            audiobooks: extra.audiobooks ?? { items: [] },
          };
        } catch {
          // Ignore unavailable extra content categories.
        }

        const coreCount =
          (merged.tracks?.items.length ?? 0) +
          (merged.albums?.items.length ?? 0) +
          (merged.artists?.items.length ?? 0) +
          (merged.playlists?.items.length ?? 0);

        if (coreCount > 0) return merged;

        try {
          const tracksOnly = await runSearch('track', 50);
          return { ...merged, tracks: tracksOnly.tracks ?? { items: [] } };
        } catch {
          return merged;
        }
      });
  }
}
