import { RATE_LIMIT_BUDGET, RATE_LIMIT_WINDOW_MS, SPOTIFY_API_BASE } from '../utils/constants';
import { recordSpotifyDiagnostic } from '../utils/spotifyDiagnostics';
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

const REQUEST_LOG_KEY = 'lowspot:spotify-request-log';

let sharedRequestLog: number[] | null = null;

function readStoredRequestLog(): number[] {
  if (sharedRequestLog) return sharedRequestLog;
  if (typeof localStorage === 'undefined') {
    sharedRequestLog = [];
    return sharedRequestLog;
  }

  try {
    const raw = localStorage.getItem(REQUEST_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    sharedRequestLog = Array.isArray(parsed)
      ? parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      : [];
  } catch {
    sharedRequestLog = [];
  }

  return sharedRequestLog;
}

function writeStoredRequestLog(nextLog: number[]): void {
  sharedRequestLog = nextLog;
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(REQUEST_LOG_KEY, JSON.stringify(nextLog));
  } catch {
    // Losing telemetry is safer than blocking playback or library loading.
  }
}

export function getSpotifyRequestBudget() {
  const now = Date.now();
  const recent = readStoredRequestLog().filter((t) => t > now - RATE_LIMIT_WINDOW_MS);
  if (recent.length !== readStoredRequestLog().length) {
    writeStoredRequestLog(recent);
  }

  return {
    used: recent.length,
    budget: RATE_LIMIT_BUDGET,
    windowMs: RATE_LIMIT_WINDOW_MS,
    resetInMs: recent.length > 0 ? Math.max(0, recent[0] + RATE_LIMIT_WINDOW_MS - now) : 0,
  };
}

export class SpotifyRateLimitError extends Error {
  path: string;
  retryAfterMs: number;
  source: 'spotify' | 'local';
  strikes?: number;
  details?: string;

  constructor(
    path: string,
    retryAfterMs: number,
    source: 'spotify' | 'local',
    strikes?: number,
    details?: string,
  ) {
    super(`Spotify rate limit reached on ${path}. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`);
    this.name = 'SpotifyRateLimitError';
    this.path = path;
    this.retryAfterMs = retryAfterMs;
    this.source = source;
    this.strikes = strikes;
    this.details = details;
  }
}

export class SpotifyApiClient {
  private accessToken: string;
  private rateLimitedUntil = 0;
  private cancelled = false;
  private diagnosticContext = 'unknown';

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  setToken(token: string) {
    this.accessToken = token;
  }

  cancel() {
    this.cancelled = true;
  }

  async withDiagnosticContext<T>(context: string, cb: () => Promise<T>): Promise<T> {
    const previousContext = this.diagnosticContext;
    this.diagnosticContext = context;
    try {
      return await cb();
    } finally {
      this.diagnosticContext = previousContext;
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Delay if we have issued RATE_LIMIT_BUDGET requests in the last RATE_LIMIT_WINDOW_MS.
  // This is the primary protection against 429s — prevents them from occurring.
  private async waitForBudget(path: string, method: string): Promise<void> {
    if (this.cancelled) throw new Error('cancelled');

    const now = Date.now();
    const requestLog = readStoredRequestLog().filter((t) => t > now - RATE_LIMIT_WINDOW_MS);

    if (requestLog.length < RATE_LIMIT_BUDGET) {
      requestLog.push(now);
      writeStoredRequestLog(requestLog);
      return;
    }

    writeStoredRequestLog(requestLog);
    const oldest = requestLog[0];
    const waitMs = oldest + RATE_LIMIT_WINDOW_MS - now + 100;
    console.info(
      '[spotify] proactive throttle —',
      requestLog.length,
      'req in last 30s, waiting',
      Math.ceil(waitMs / 1000) + 's',
    );
    void recordSpotifyDiagnostic({
      context: this.diagnosticContext,
      method,
      path,
      outcome: 'local-throttle',
      retryAfterMs: waitMs,
      budgetUsed: requestLog.length,
      budgetLimit: RATE_LIMIT_BUDGET,
    });
    await this.wait(Math.max(waitMs, 100));
    return this.waitForBudget(path, method);
  }

  private async doRequest<T>(path: string, init: RequestInit, attempt: number): Promise<T> {
    const method = init.method ?? 'GET';
    const startedAt = Date.now();

    // Cross-session persisted cooldown. If it is short enough, wait it out;
    // otherwise surface it to the caller so the UI can show a countdown.
    const persistedCooldown = getSpotifyCooldown(path);
    if (persistedCooldown) {
      const remainingMs = persistedCooldown.until - Date.now();
      if (remainingMs > 0) {
        void recordSpotifyDiagnostic({
          context: this.diagnosticContext,
          method,
          path: persistedCooldown.path,
          outcome: 'local-cooldown',
          retryAfterMs: remainingMs,
        });
        throw new SpotifyRateLimitError(
          persistedCooldown.path,
          remainingMs,
          'local',
          persistedCooldown.strikes,
        );
      }
    }

    // Proactive throttle runs immediately before fetch so skipped requests
    // during cooldowns do not consume local budget.
    await this.waitForBudget(path, method);

    if (this.cancelled) throw new Error('cancelled');

    // In-session rate-limit pause set by a 429 response — wait, then proceed.
    const pause = this.rateLimitedUntil - Date.now();
    if (pause > 0) {
      void recordSpotifyDiagnostic({
        context: this.diagnosticContext,
        method,
        path,
        outcome: 'local-cooldown',
        retryAfterMs: pause,
      });
      throw new SpotifyRateLimitError(path, pause, 'local');
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
      const message = error instanceof Error ? error.message : String(error);
      void recordSpotifyDiagnostic({
        context: this.diagnosticContext,
        method,
        path,
        outcome: 'network-error',
        durationMs: Date.now() - startedAt,
        error: message,
      });
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
      const body = await response.text().catch(() => '');
      void recordSpotifyDiagnostic({
        context: this.diagnosticContext,
        method,
        path,
        outcome: 'response',
        status: response.status,
        statusText: response.statusText,
        retryAfter: header,
        retryAfterMs: backoff,
        durationMs: Date.now() - startedAt,
        bodySnippet: body.slice(0, 500),
      });
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
      const cooldown = setSpotifyCooldown(path, backoff);
      this.rateLimitedUntil = Math.max(this.rateLimitedUntil, cooldown.until);
      throw new SpotifyRateLimitError(
        path,
        Math.max(1000, cooldown.until - Date.now()),
        'spotify',
        cooldown.strikes,
        body,
      );
    }

    if (response.status >= 500 && attempt < 3 && !this.cancelled) {
      void recordSpotifyDiagnostic({
        context: this.diagnosticContext,
        method,
        path,
        outcome: 'response',
        status: response.status,
        statusText: response.statusText,
        durationMs: Date.now() - startedAt,
      });
      await this.wait(Math.min(300 * 2 ** attempt, 5000));
      return this.doRequest(path, init, attempt + 1);
    }

    if (!response.ok) {
      const text = await response.text();
      void recordSpotifyDiagnostic({
        context: this.diagnosticContext,
        method,
        path,
        outcome: 'response',
        status: response.status,
        statusText: response.statusText,
        durationMs: Date.now() - startedAt,
        bodySnippet: text.slice(0, 500),
      });
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }

    void recordSpotifyDiagnostic({
      context: this.diagnosticContext,
      method,
      path,
      outcome: 'response',
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - startedAt,
    });

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

    return runSearch('track,album,artist,playlist', 10)
      .then((base) => normalize(base))
      .then(async (base) => {
        const coreCount =
          (base.tracks?.items.length ?? 0) +
          (base.albums?.items.length ?? 0) +
          (base.artists?.items.length ?? 0) +
          (base.playlists?.items.length ?? 0);

        if (coreCount > 0) return base;

        try {
          const tracksOnly = await runSearch('track', 20);
          return { ...base, tracks: tracksOnly.tracks ?? { items: [] } };
        } catch {
          return base;
        }
      });
  }
}
