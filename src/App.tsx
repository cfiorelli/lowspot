import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { buildAuthorizeUrl, exchangeCodeForTokens, openAuthorizeUrl, parseCallbackUrl, refreshAccessToken } from './auth/spotifyAuth';
import { clearTokens, loadTokens, saveTokens } from './auth/tokenStorage';
import { ExpandedView } from './components/ExpandedView';
import { LeanBar } from './components/LeanBar';
import { LoginScreen } from './components/LoginScreen';
import { buildRowsForNav } from './components/rows';
import { StatusStrip } from './components/StatusStrip';
import { SpotifyApiClient, SpotifyRateLimitError } from './spotify/api';
import { connectPlaybackSdk } from './spotify/webPlaybackSDK';
import {
  mockLikedAlbums,
  mockLikedSongs,
  mockPlayback,
  mockPlaylists,
  mockQueue,
  mockRecentlyPlayed,
  mockSearch,
} from './spotify/mockData';
import { useAppStore } from './state/store';
import { EXPANDED_SIZE, LEAN_SIZE, LIBRARY_PAGE_DELAY_MS, LOGIN_SIZE, MIN_SIZE, POLL_INTERVAL_MS } from './utils/constants';
import {
  loadCachedLikedSongs, saveCachedLikedSongs,
  loadCachedLikedAlbums, saveCachedLikedAlbums,
  loadCachedPlaylists, saveCachedPlaylists,
} from './utils/libraryCache';
import { formatCooldownRemaining, getActiveSpotifyCooldowns } from './utils/spotifyCooldown';
import { registerShortcuts } from './utils/shortcuts';
import './styles/app.css';
import './styles/lean.css';
import './styles/expanded.css';

const LIBRARY_PAGE_SIZE = 50;
// No cap on first-run pages: we paginate until the end with 500ms delays
// (60 req/30s), well within the 100 req/30s proactive budget in api.ts.
const MAX_INITIAL_LIBRARY_PAGES = Infinity;
// Incrementally fetch up to 1000 new songs since last sync.
const MAX_INCREMENTAL_LIBRARY_PAGES = 20;
const MOCK_MODE = import.meta.env.VITE_LOWSPOT_MOCK === '1';

const countSearchResults = (results: ReturnType<typeof mockSearch>): number =>
  (results.tracks?.items.length ?? 0) +
  (results.albums?.items.length ?? 0) +
  (results.artists?.items.length ?? 0) +
  (results.playlists?.items.length ?? 0) +
  (results.shows?.items.length ?? 0) +
  (results.audiobooks?.items.length ?? 0);

function App() {
  const {
    mode,
    activeNav,
    authReady,
    profile,
    tokens,
    playback,
    queue,
    recentlyPlayed,
    playlists,
    likedAlbums,
    likedSongs,
    currentTrackLiked,
    searchResults,
    searchQuery,
    selectedRow,
    sdkMessage,
    errorMessage,
    infoMessage,
    statusLog,
    setMode,
    setActiveNav,
    setAuthReady,
    setProfile,
    setTokens,
    setPlayback,
    setQueue,
    setRecentlyPlayed,
    setPlaylists,
    setLikedAlbums,
    setLikedSongs,
    setCurrentTrackLiked,
    setSearchResults,
    setSearchQuery,
    setSelectedRow,
    setSdkMessage,
    setErrorMessage,
    setInfoMessage,
    clearStatusLog,
  } = useAppStore();

  const apiRef = useRef<SpotifyApiClient | null>(null);
  const setupInProgressRef = useRef(false);
  const refreshRef = useRef(false);
  const refreshPlaybackPendingRef = useRef(false);
  const sectionLoadPendingRef = useRef(false);
  const sdkDeviceIdRef = useRef<string | null>(null);
  const sdkDisconnectRef = useRef<(() => void) | null>(null);
  const playbackPollTickRef = useRef(0);
  const [pendingShuffle, setPendingShuffle] = useState<boolean | null>(null);
  const [pendingRepeat, setPendingRepeat] = useState<'off' | 'track' | 'context' | null>(null);
  const [loadingSection, setLoadingSection] = useState<typeof activeNav | null>(null);
  const [sectionMessage, setSectionMessage] = useState('');
  const [cooldownSummary, setCooldownSummary] = useState('');
  const [sdkConnecting, setSdkConnecting] = useState(false);
  const [sdkDeviceId, setSdkDeviceId] = useState<string | null>(null);

  const completeAuth = async (code: string, state?: string | null) => {
    try {
      const newTokens = await exchangeCodeForTokens(code, state);
      await saveTokens(newTokens);
      setTokens(newTokens);
      setErrorMessage('');
      setInfoMessage('Spotify login complete.');
      if (!isTauri()) {
        window.history.replaceState({}, '', '/');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Login failed.');
    }
  };

  const tableRows = useMemo(
    () => buildRowsForNav(activeNav, likedSongs, likedAlbums, playlists, searchResults, queue, recentlyPlayed, playback),
    [activeNav, likedSongs, likedAlbums, playlists, searchResults, queue, recentlyPlayed, playback],
  );

  const loadMockSection = (nav: typeof activeNav) => {
    setLoadingSection(null);
    setErrorMessage('');

    if (nav === 'Now Playing') {
      setPlayback(useAppStore.getState().playback ?? mockPlayback);
      setSectionMessage('');
      return;
    }

    if (nav === 'Liked Songs') {
      setLikedSongs(mockLikedSongs);
      setSectionMessage(`Mock mode loaded ${mockLikedSongs.length} liked songs.`);
      return;
    }

    if (nav === 'Liked Albums') {
      setLikedAlbums(mockLikedAlbums);
      setSectionMessage(`Mock mode loaded ${mockLikedAlbums.length} liked albums.`);
      return;
    }

    if (nav === 'Playlists') {
      setPlaylists(mockPlaylists);
      setSectionMessage(`Mock mode loaded ${mockPlaylists.length} playlists.`);
      return;
    }

    if (nav === 'Queue') {
      setQueue(mockQueue);
      setSectionMessage(`Mock mode loaded ${mockQueue.queue.length} queued tracks.`);
      return;
    }

    if (nav === 'Recently Played') {
      setRecentlyPlayed(mockRecentlyPlayed);
      setSectionMessage(`Mock mode loaded ${mockRecentlyPlayed.length} recent plays.`);
      return;
    }

    setSectionMessage('');
  };

  const playMockTrack = (trackUri?: string) => {
    const track = mockLikedSongs.find((item) => item.uri === trackUri) ?? mockLikedSongs[0];
    setPlayback({
      ...mockPlayback,
      shuffle_state: playback?.shuffle_state ?? mockPlayback.shuffle_state,
      repeat_state: playback?.repeat_state ?? mockPlayback.repeat_state,
      device: playback?.device ?? mockPlayback.device,
      item: track,
      progress_ms: 0,
      is_playing: true,
    });
    setInfoMessage(`Mock playing: ${track.name}`);
  };

  const stepMockPlayback = (direction: 1 | -1) => {
    const currentId = playback?.item?.id;
    const index = mockLikedSongs.findIndex((track) => track.id === currentId);
    const nextIndex = index === -1
      ? 0
      : (index + direction + mockLikedSongs.length) % mockLikedSongs.length;
    playMockTrack(mockLikedSongs[nextIndex].uri);
  };

  const withApi = async <T,>(cb: (api: SpotifyApiClient) => Promise<T>): Promise<T | null> => {
    if (!apiRef.current) {
      return null;
    }

    try {
      const result = await cb(apiRef.current);
      setErrorMessage('');
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unexpected Spotify API error.';
      if (error instanceof SpotifyRateLimitError) {
        setErrorMessage(`Spotify is rate limiting lowspot on ${error.path}. Try again in ${formatCooldownRemaining(Date.now() + error.retryAfterMs)}.`);
      } else if (msg.startsWith('403')) {
        setErrorMessage('Spotify returned 403 — playback controls require Spotify Premium, or the token lacks a required scope.');
      } else {
        setErrorMessage(msg);
      }
      return null;
    }
  };

  const resizeForMode = async (nextMode: 'login' | 'lean' | 'expanded') => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.setMinSize(new LogicalSize(MIN_SIZE.width, MIN_SIZE.height));
      const size = nextMode === 'login' ? LOGIN_SIZE : nextMode === 'lean' ? LEAN_SIZE : EXPANDED_SIZE;
      await appWindow.setSize(new LogicalSize(size.width, size.height));
    } catch {
      // Browser mode fallback: skip window API without blocking app.
    }
  };

  const normalizePlaybackError = (message: string): string => {
    if (/string did not match the expected pattern/i.test(message)) {
      return 'Playback device was not ready. Please try again.';
    }
    if (/\b502\b|bad gateway/i.test(message)) {
      return 'Spotify playback endpoint is temporarily unavailable. Please try again.';
    }
    if (/no active device/i.test(message)) {
      return 'No active Spotify playback device found. Start playback in Spotify and try again.';
    }
    return message;
  };

  const shouldRetryPlaybackError = (message: string): boolean =>
    /string did not match the expected pattern|\b502\b|bad gateway|no active device/i.test(message);

  const runPlaybackCommand = async (
    operation: string,
    command: (api: SpotifyApiClient) => Promise<void>,
    options?: { forcePlayOnTransfer?: boolean; ensurePlayingAfterCommand?: boolean },
  ): Promise<boolean> => {
    const api = apiRef.current;
    if (!api) {
      return false;
    }

    const runOnce = async () => {
      const latestPlayback = useAppStore.getState().playback;
      const sdkDeviceId = sdkDeviceIdRef.current;
      const activeDeviceId = latestPlayback?.device?.id;
      let targetDeviceId = sdkDeviceId ?? activeDeviceId ?? null;

      if (!targetDeviceId) {
        const devices = await api.getDevices();
        const fallback =
          devices.devices.find((device) => device.is_active && !device.is_restricted) ??
          devices.devices.find((device) => !device.is_restricted);

        if (fallback?.id) {
          targetDeviceId = fallback.id;
          sdkDeviceIdRef.current = fallback.id;
        }
      }

      if (!targetDeviceId) {
        throw new Error('No active device');
      }

      console.info('[playback-command:start]', {
        operation,
        sdkDeviceId,
        activeDeviceId,
        targetDeviceId,
      });

      if (targetDeviceId && activeDeviceId !== targetDeviceId) {
        const shouldPlay = options?.forcePlayOnTransfer ? true : (latestPlayback?.is_playing ?? false);
        await api.transferPlayback(targetDeviceId, shouldPlay);
      }

      await command(api);

      if (options?.ensurePlayingAfterCommand) {
        await api.play(targetDeviceId ?? undefined);
      }
    };

    setErrorMessage('');

    try {
      await runOnce();
      void refreshPlayback();
      return true;
    } catch (error) {
      const firstMessage = error instanceof Error ? error.message : 'Unexpected Spotify API error.';
      console.warn('[playback-command:error]', {
        operation,
        error: firstMessage,
      });

      if (shouldRetryPlaybackError(firstMessage)) {
        try {
          await refreshPlayback();
          await new Promise((resolve) => setTimeout(resolve, 250));
          await runOnce();
          void refreshPlayback();
          return true;
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : firstMessage;
          console.warn('[playback-command:retry-failed]', {
            operation,
            error: retryMessage,
          });
          setErrorMessage(normalizePlaybackError(retryMessage));
          return false;
        }
      }

      setErrorMessage(normalizePlaybackError(firstMessage));
      return false;
    }
  };

  const refreshPlayback = async () => {
    if (refreshPlaybackPendingRef.current) return;
    refreshPlaybackPendingRef.current = true;
    try {
      await withApi(async (api) => {
        const trackId = useAppStore.getState().playback?.item?.id;
        const queuePollDue = useAppStore.getState().activeNav === 'Queue' || playbackPollTickRef.current % 4 === 0;
        playbackPollTickRef.current += 1;

        const playbackState = await api.getPlaybackState().catch(() => null);
        const queueState = queuePollDue ? await api.getQueue().catch(() => null) : null;

        if (playbackState) {
          setPlayback(playbackState);
          const newTrackId = playbackState.item?.id;

          if (newTrackId && newTrackId !== trackId) {
            try {
              const liked = await api.isTrackSaved(newTrackId);
              setCurrentTrackLiked(Boolean(liked[0]));
            } catch {
              setCurrentTrackLiked(false);
            }
          }
        }

        if (queueState) {
          setQueue(queueState);
        }
      });
    } finally {
      refreshPlaybackPendingRef.current = false;
    }
  };

  const hydrateSession = async () => {
    if (MOCK_MODE) {
      setProfile({ id: 'mock-user', email: 'mock@lowspot.local', display_name: 'Mock Spotify User' });
      setPlayback(mockPlayback);
      setQueue(mockQueue);
      setRecentlyPlayed(mockRecentlyPlayed);
      setPlaylists(mockPlaylists);
      setLikedAlbums(mockLikedAlbums);
      setLikedSongs(mockLikedSongs);
      setInfoMessage('Mock Spotify mode active. No Spotify API calls will be made.');
      setAuthReady(true);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (code) {
      await completeAuth(code, state);
    } else {
      const stored = await loadTokens();
      if (stored) {
        setTokens(stored);
      }
    }

    setAuthReady(true);
  };

  const ensureFreshToken = async () => {
    if (!tokens || refreshRef.current) {
      return;
    }

    if (tokens.expiresAt > Date.now() + 45_000) {
      return;
    }

    try {
      refreshRef.current = true;
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      const merged = {
        ...tokens,
        ...refreshed,
      };
      await saveTokens(merged);
      setTokens(merged);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh Spotify token.');
      await clearTokens();
      setTokens(null);
      setProfile(null);
    } finally {
      refreshRef.current = false;
    }
  };

  const setupApiAndLoad = async () => {
    if (!tokens) {
      apiRef.current?.cancel();
      apiRef.current = null;
      return;
    }

    // Already initialised — just keep the token fresh.
    if (apiRef.current) {
      await ensureFreshToken();
      const refreshed = useAppStore.getState().tokens;
      if (refreshed) apiRef.current.setToken(refreshed.accessToken);
      return;
    }

    if (setupInProgressRef.current) return;
    setupInProgressRef.current = true;

    try {
      await ensureFreshToken();
      const activeTokens = useAppStore.getState().tokens;
      if (!activeTokens) return;

      apiRef.current = new SpotifyApiClient(activeTokens.accessToken);

      setInfoMessage('Spotify session ready.');
      // Immediately fetch playback state so LeanBar shows the current track.
      void refreshPlayback();
      // Trigger the active nav's data load (the [activeNav] effect fired while apiRef was null).
      void loadSectionForNav(useAppStore.getState().activeNav);
    } finally {
      setupInProgressRef.current = false;
    }
  };

  const handleLogin = async () => {
    try {
      setErrorMessage('');
      const url = await buildAuthorizeUrl();
      if (isTauri()) {
        try { await invoke('start_oauth_server'); } catch { /* server may already be running */ }
      }
      await openAuthorizeUrl(url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to begin Spotify login.');
    }
  };

  const handleLogout = async () => {
    if (MOCK_MODE) {
      setProfile({ id: 'mock-user', email: 'mock@lowspot.local', display_name: 'Mock Spotify User' });
      setPlayback(mockPlayback);
      setQueue(mockQueue);
      setSearchResults(null);
      setLoadingSection(null);
      setSectionMessage('');
      sectionLoadPendingRef.current = false;
      setErrorMessage('');
      setInfoMessage('Mock Spotify mode active. No Spotify API calls will be made.');
      return;
    }

    sdkDisconnectRef.current?.();
    sdkDisconnectRef.current = null;
    sdkDeviceIdRef.current = null;
    setSdkDeviceId(null);
    apiRef.current?.cancel();
    apiRef.current = null;
    await clearTokens();
    setTokens(null);
    setProfile(null);
    setPlayback(null);
    setQueue(null);
    setSearchResults(null);
    setCurrentTrackLiked(false);
    setLoadingSection(null);
    setSectionMessage('');
    sectionLoadPendingRef.current = false;
    setErrorMessage('');
    setInfoMessage('Logged out.');
  };

  const handleConnectPlaybackSdk = async () => {
    if (MOCK_MODE) {
      setSdkMessage('Mock playback device connected.');
      setInfoMessage('Mock playback device connected.');
      setSdkDeviceId('mock-device');
      sdkDeviceIdRef.current = 'mock-device';
      return;
    }

    const activeTokens = useAppStore.getState().tokens;
    if (!activeTokens) {
      setErrorMessage('Log in before connecting the local playback device.');
      return;
    }

    if (sdkConnecting) {
      return;
    }

    setSdkConnecting(true);
    setInfoMessage('Connecting local Spotify playback device...');

    try {
      const connection = await connectPlaybackSdk(activeTokens.accessToken, (status) => {
        setSdkMessage(status.message);
        if (status.ready) {
          sdkDeviceIdRef.current = status.deviceId ?? null;
          setSdkDeviceId(status.deviceId ?? null);
          setInfoMessage(`Spotify Connect device ready: lowspot (${status.deviceId})`);
        } else {
          sdkDeviceIdRef.current = null;
          setSdkDeviceId(null);
        }
      });

      sdkDisconnectRef.current?.();
      sdkDisconnectRef.current = connection?.disconnect ?? null;
    } finally {
      setSdkConnecting(false);
    }
  };

  const handlePlayPause = async () => {
    if (MOCK_MODE) {
      setPlayback(
        playback
          ? { ...playback, is_playing: !playback.is_playing }
          : { ...mockPlayback, is_playing: true },
      );
      setInfoMessage(playback?.is_playing ? 'Mock playback paused.' : 'Mock playback playing.');
      return;
    }

    const prevPlayback = playback;
    setPlayback(
      playback
        ? {
            ...playback,
            is_playing: !playback.is_playing,
          }
        : playback,
    );

    const ok = await runPlaybackCommand('play-pause', async (api) => {
      if (playback?.is_playing) {
        await api.pause();
      } else {
        await api.play(sdkDeviceIdRef.current ?? undefined);
      }
    });

    if (!ok) {
      setPlayback(prevPlayback);
    }
  };

  const handleToggleLike = async () => {
    const trackId = playback?.item?.id;
    if (!trackId) {
      return;
    }

    if (MOCK_MODE) {
      setCurrentTrackLiked(!currentTrackLiked);
      setInfoMessage(currentTrackLiked ? 'Mock track removed from library.' : 'Mock track saved to library.');
      return;
    }

    await withApi(async (api) => {
      if (currentTrackLiked) {
        await api.removeTrack(trackId);
      } else {
        await api.saveTrack(trackId);
      }

      setCurrentTrackLiked(!currentTrackLiked);
    });
  };

  const handleSearch = async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setLoadingSection('Search');
    setSectionMessage(`Searching for "${q}"...`);
    setSearchResults(null);
    setSearchQuery(q);
    setActiveNav('Search');
    setMode('expanded');
    await resizeForMode('expanded');

    if (MOCK_MODE) {
      const result = mockSearch(q);
      setSearchResults(result);
      const resultCount = countSearchResults(result);
      const message = resultCount === 0
        ? `No mock results found for "${q}".`
        : `Mock search returned ${resultCount} results for "${q}".`;
      setSectionMessage(message);
      setLoadingSection(null);
      setInfoMessage(message);
      return;
    }

    const resultCount = await withApi(async (api) => {
      const result = await api.search(q);
      setSearchResults(result);
      return countSearchResults(result);
    });

    const message = resultCount === null
      ? `Search failed for "${q}". Check the status log for details.`
      : resultCount === 0
        ? `No results found for "${q}".`
        : `Search returned ${resultCount} results for "${q}".`;
    setSectionMessage(message);
    setLoadingSection(null);
    setInfoMessage(message);
  };

  const loadSectionForNav = async (nav: typeof activeNav) => {
    if (nav === 'Search') {
      return;
    }

    const activeTokens = useAppStore.getState().tokens;
    sectionLoadPendingRef.current = true;
    setLoadingSection(nav);
    setSectionMessage('');

    const finishSection = (message: string) => {
      if (useAppStore.getState().activeNav === nav) {
        setSectionMessage(message);
      }
      setLoadingSection((current) => (current === nav ? null : current));
      sectionLoadPendingRef.current = false;
    };

    const tokenScopes = new Set(activeTokens?.scope.split(/\s+/).filter(Boolean) ?? []);

    if (nav === 'Liked Songs') {
      if (!tokenScopes.has('user-library-read')) {
        finishSection('Spotify token is missing user-library-read. Log out, log in again, and approve library access.');
        return;
      }

      const cached = loadCachedLikedSongs();
      if (cached.length > 0) setLikedSongs(cached.map((e) => e.track));

      const loaded = await withApi(async (api) => {
        const newestAddedAt = cached[0]?.added_at ?? '';
        const maxPages = cached.length > 0 ? MAX_INCREMENTAL_LIBRARY_PAGES : MAX_INITIAL_LIBRARY_PAGES;
        let offset = 0;
        let total = 0;
        let hitCache = false;
        const newEntries: typeof cached = [];

        for (let pagesFetched = 0; pagesFetched < maxPages; pagesFetched += 1) {
          const page = await api.getLikedSongs(LIBRARY_PAGE_SIZE, offset);
          total = page.total;

          for (const item of page.items) {
            if (!item.track) continue;
            if (newestAddedAt && item.added_at <= newestAddedAt) { hitCache = true; break; }
            newEntries.push({ added_at: item.added_at, track: item.track });
          }

          if (hitCache || !page.next) break;
          offset += page.limit;

          const inProgress = newEntries.length + cached.length;
          setLikedSongs([...newEntries.map((e) => e.track), ...cached.map((e) => e.track)]);
          if (total > 0) setInfoMessage(`Loading liked songs… ${inProgress} of ${total}`);
          await new Promise((r) => setTimeout(r, LIBRARY_PAGE_DELAY_MS));
        }

        const seen = new Set<string>();
        const merged = [...newEntries, ...cached].filter((entry) => {
          if (seen.has(entry.track.id)) return false;
          seen.add(entry.track.id);
          return true;
        });
        setLikedSongs(merged.map((e) => e.track));
        saveCachedLikedSongs(merged);
        return { loaded: merged.length, total, capped: !hitCache && total > merged.length };
      });

      const message = loaded === null
        ? 'Liked Songs request failed. Check the status message above for Spotify details, then retry after the cooldown.'
        : loaded.loaded === 0
          ? 'Spotify returned 0 liked songs for this account/token.'
          : loaded.capped
            ? `Loaded ${loaded.loaded} of ${loaded.total} liked songs. More pages are paused to protect Spotify quota.`
            : `Loaded ${loaded.loaded} liked songs.`;
      setInfoMessage(message);
      finishSection(message);
      return;
    }

    if (nav === 'Liked Albums') {
      if (!tokenScopes.has('user-library-read')) {
        finishSection('Spotify token is missing user-library-read. Log out, log in again, and approve library access.');
        return;
      }

      const cached = loadCachedLikedAlbums();
      if (cached.length > 0) setLikedAlbums(cached.map((e) => e.album));

      const loaded = await withApi(async (api) => {
        const newestAddedAt = cached[0]?.added_at ?? '';
        const maxPages = cached.length > 0 ? MAX_INCREMENTAL_LIBRARY_PAGES : MAX_INITIAL_LIBRARY_PAGES;
        let offset = 0;
        let total = 0;
        let hitCache = false;
        const newEntries: typeof cached = [];

        for (let pagesFetched = 0; pagesFetched < maxPages; pagesFetched += 1) {
          const page = await api.getLikedAlbums(LIBRARY_PAGE_SIZE, offset);
          total = page.total;

          for (const item of page.items) {
            if (!item.album) continue;
            if (newestAddedAt && item.added_at <= newestAddedAt) { hitCache = true; break; }
            newEntries.push({ added_at: item.added_at, album: item.album });
          }

          if (hitCache || !page.next) break;
          offset += page.limit;
          if (total > 0) setInfoMessage(`Loading liked albums… ${newEntries.length + cached.length} of ${total}`);
          await new Promise((r) => setTimeout(r, LIBRARY_PAGE_DELAY_MS));
        }

        const seen = new Set<string>();
        const merged = [...newEntries, ...cached].filter((entry) => {
          if (seen.has(entry.album.id)) return false;
          seen.add(entry.album.id);
          return true;
        });
        setLikedAlbums(merged.map((e) => e.album));
        saveCachedLikedAlbums(merged);
        return { loaded: merged.length, total, capped: !hitCache && total > merged.length };
      });

      const message = loaded === null
        ? 'Liked Albums request failed. Check the status message above for Spotify details.'
        : loaded.loaded === 0
          ? 'Spotify returned 0 liked albums for this account/token.'
          : loaded.capped
            ? `Loaded ${loaded.loaded} of ${loaded.total} liked albums. More pages are paused to protect Spotify quota.`
            : `Loaded ${loaded.loaded} liked albums.`;
      setInfoMessage(message);
      finishSection(message);
      return;
    }

    if (nav === 'Playlists') {
      const cached = loadCachedPlaylists();
      if (cached.length > 0) setPlaylists(cached);

      const loaded = await withApi(async (api) => {
        // Playlists can be reordered/deleted so always do a fresh full fetch
        const data = await api.getPlaylists(50);
        setPlaylists(data.items);
        saveCachedPlaylists(data.items);
        return data.items.length;
      });

      finishSection(
        loaded === null
          ? 'Playlists request failed. Check the status message above for Spotify details.'
          : loaded === 0
            ? 'Spotify returned 0 playlists for this account/token.'
            : `Loaded ${loaded} playlists.`,
      );
      return;
    }

    await withApi(async (api) => {
      if (nav === 'Recently Played') {
        const data = await api.getRecentlyPlayed(50);
        setRecentlyPlayed(data.items);
        return;
      }

      if (nav === 'Queue' || nav === 'Now Playing') {
        await refreshPlayback();
      }
    });
    finishSection('');
  };

  const playSelectedRow = async (index: number) => {
    const row = tableRows[index];
    const uri = row?.uri;

    if (!row || !uri) {
      return;
    }

    if (MOCK_MODE) {
      if (row.type === 'Track' || row.type === 'Playing' || row.type === 'Paused' || row.type === 'Queued Track' || row.type === 'Recent') {
        playMockTrack(uri);
      } else {
        setInfoMessage(`Mock selected ${row.type}: ${row.title}`);
      }
      return;
    }

    const ok = await runPlaybackCommand('play-row', async (api) => {
      if (row.type === 'Track') {
        await api.play(sdkDeviceIdRef.current ?? undefined, [uri]);
      } else {
        await api.play(sdkDeviceIdRef.current ?? undefined, undefined, uri);
      }
    });

    if (ok && activeNav === 'Search') {
      setMode('lean');
      void resizeForMode('lean');
    }
  };

  useEffect(() => {
    void hydrateSession();
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | undefined;

    void listen<string>('oauth-callback', (event) => {
      const { code, state } = parseCallbackUrl(event.payload);
      if (code) {
        void completeAuth(code, state);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (MOCK_MODE || !authReady || !tokens) {
      return;
    }

    void setupApiAndLoad();
  }, [authReady, tokens?.accessToken]);

  useEffect(() => {
    if (MOCK_MODE) {
      const timeout = setTimeout(() => loadMockSection(activeNav), 0);
      return () => clearTimeout(timeout);
    }

    if (!apiRef.current) {
      return;
    }

    void loadSectionForNav(activeNav);
  }, [activeNav]);

  useEffect(() => {
    if (MOCK_MODE || !tokens) return;

    const timer = setInterval(() => {
      void ensureFreshToken();
      void refreshPlayback();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [tokens]);

  useEffect(() => {
    const refreshCooldownSummary = () => {
      const activeCooldowns = getActiveSpotifyCooldowns();
      const summary = activeCooldowns
        .map((cooldown) => `${cooldown.path}: ${formatCooldownRemaining(cooldown.until)}`)
        .join(' | ');
      setCooldownSummary(summary);
    };

    refreshCooldownSummary();
    const timer = setInterval(refreshCooldownSummary, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    sdkDisconnectRef.current?.();
  }, []);

  useEffect(() => {
    const nextMode = !authReady || (!tokens && !MOCK_MODE) ? 'login' : mode;
    void resizeForMode(nextMode);
  }, [authReady, tokens, mode]);

  useEffect(() => {
    if (pendingShuffle === null) {
      return;
    }

    const timeout = setTimeout(() => {
      setPendingShuffle(null);
    }, playback?.shuffle_state === pendingShuffle ? 0 : 1800);

    return () => clearTimeout(timeout);
  }, [pendingShuffle, playback?.shuffle_state]);

  useEffect(() => {
    if (pendingRepeat === null) {
      return;
    }

    const timeout = setTimeout(() => {
      setPendingRepeat(null);
    }, playback?.repeat_state === pendingRepeat ? 0 : 1800);

    return () => clearTimeout(timeout);
  }, [pendingRepeat, playback?.repeat_state]);

  useEffect(() => {
    return registerShortcuts([
      { key: ' ', handler: handlePlayPause },
      {
        key: 'k',
        meta: true,
        handler: () => document.getElementById('global-search')?.focus(),
      },
      {
        key: 'k',
        ctrl: true,
        handler: () => document.getElementById('global-search')?.focus(),
      },
      { key: 'l', meta: true, handler: handleToggleLike },
      { key: 'l', ctrl: true, handler: handleToggleLike },
      {
        key: 'b',
        meta: true,
        handler: () => {
          const next = mode === 'lean' ? 'expanded' : 'lean';
          setMode(next);
          void resizeForMode(next);
        },
      },
      {
        key: 'b',
        ctrl: true,
        handler: () => {
          const next = mode === 'lean' ? 'expanded' : 'lean';
          setMode(next);
          void resizeForMode(next);
        },
      },
      {
        key: 'ArrowDown',
        handler: () => setSelectedRow(Math.min(selectedRow + 1, Math.max(0, tableRows.length - 1))),
      },
      {
        key: 'ArrowUp',
        handler: () => setSelectedRow(Math.max(selectedRow - 1, 0)),
      },
      {
        key: 'Enter',
        handler: () => {
          void playSelectedRow(selectedRow);
        },
      },
      {
        key: 'Escape',
        handler: () => {
          if (activeNav === 'Search') {
            setSearchResults(null);
          }
          setMode('lean');
          void resizeForMode('lean');
        },
      },
    ]);
  }, [mode, selectedRow, tableRows, activeNav, playback?.is_playing, currentTrackLiked]);

  if (!authReady) {
    return <main className="app-shell">Loading...</main>;
  }

  if (!tokens && !MOCK_MODE) {
    return <LoginScreen onLogin={handleLogin} errorMessage={errorMessage} />;
  }

  const playbackControlsDisabled = !(playback?.device?.id || sdkDeviceId);
  const effectiveShuffle = pendingShuffle ?? Boolean(playback?.shuffle_state);
  const effectiveRepeat = pendingRepeat ?? (playback?.repeat_state ?? 'off');

  return (
    <main className="app-shell">
      <header className="top-strip">
        <p>
          Signed in as {profile?.display_name ?? 'Spotify user'}
          {searchQuery ? ` • Last search: ${searchQuery}` : ''}
        </p>
        <button type="button" onClick={handleLogout}>
          Logout
        </button>
      </header>

      <StatusStrip
        errorMessage={errorMessage}
        infoMessage={infoMessage}
        statusLog={statusLog}
        onClearLog={clearStatusLog}
      />

      {mode === 'lean' ? (
        <LeanBar
          playback={playback}
          currentTrackLiked={currentTrackLiked}
          controlsDisabled={playbackControlsDisabled}
          onPrevious={() => {
            if (MOCK_MODE) {
              stepMockPlayback(-1);
              return;
            }
            void runPlaybackCommand('previous', async (api) => {
              await api.previous();
            }, { forcePlayOnTransfer: true, ensurePlayingAfterCommand: true });
          }}
          onPlayPause={() => {
            void handlePlayPause();
          }}
          onNext={() => {
            if (MOCK_MODE) {
              stepMockPlayback(1);
              return;
            }
            void runPlaybackCommand('next', async (api) => {
              await api.next();
            }, { forcePlayOnTransfer: true, ensurePlayingAfterCommand: true });
          }}
          onToggleLike={() => {
            void handleToggleLike();
          }}
          onExpand={() => {
            setMode('expanded');
            void resizeForMode('expanded');
          }}
          onSearchSubmit={(query) => {
            void handleSearch(query);
          }}
        />
      ) : (
        <ExpandedView
          activeNav={activeNav}
          selectedRow={selectedRow}
          likedSongs={likedSongs}
          likedAlbums={likedAlbums}
          playlists={playlists}
          searchResults={searchResults}
          queue={queue}
          recentlyPlayed={recentlyPlayed}
          playback={playback}
          controlsDisabled={playbackControlsDisabled}
          shuffleState={effectiveShuffle}
          repeatState={effectiveRepeat}
          shufflePending={pendingShuffle !== null}
          repeatPending={pendingRepeat !== null}
          sdkMessage={sdkMessage}
          sdkConnecting={sdkConnecting}
          sdkDeviceId={sdkDeviceId}
          sectionLoading={loadingSection === activeNav}
          sectionMessage={sectionMessage}
          cooldownSummary={cooldownSummary}
          onNavSelect={(nav) => {
            setActiveNav(nav);
            if (nav === 'Settings') {
              setInfoMessage('Configure Spotify Client ID in .env and allowlist both http://127.0.0.1:5173/callback and http://127.0.0.1:7878/callback in Spotify.');
            }
          }}
          onCollapse={() => {
            setMode('lean');
            void resizeForMode('lean');
          }}
          onSearch={(query) => {
            void handleSearch(query);
          }}
          onRowSelect={setSelectedRow}
          onPlayTrack={(trackUri) => {
            if (MOCK_MODE) {
              playMockTrack(trackUri);
              if (activeNav === 'Search') {
                setMode('lean');
                void resizeForMode('lean');
              }
              return;
            }

            void (async () => {
              const ok = await runPlaybackCommand('play-track', async (api) => {
                await api.play(sdkDeviceIdRef.current ?? undefined, [trackUri]);
              }, { forcePlayOnTransfer: true });

              if (ok && activeNav === 'Search') {
                setMode('lean');
                void resizeForMode('lean');
              }
            })();
          }}
          onPlayContext={(contextUri) => {
            if (MOCK_MODE) {
              setInfoMessage(`Mock selected context: ${contextUri}`);
              if (activeNav === 'Search') {
                setMode('lean');
                void resizeForMode('lean');
              }
              return;
            }

            void (async () => {
              const ok = await runPlaybackCommand('play-context', async (api) => {
                await api.play(sdkDeviceIdRef.current ?? undefined, undefined, contextUri);
              }, { forcePlayOnTransfer: true });

              if (ok && activeNav === 'Search') {
                setMode('lean');
                void resizeForMode('lean');
              }
            })();
          }}
          onPrevious={() => {
            if (MOCK_MODE) {
              stepMockPlayback(-1);
              return;
            }
            void runPlaybackCommand('previous', async (api) => {
              await api.previous();
            }, { forcePlayOnTransfer: true, ensurePlayingAfterCommand: true });
          }}
          onPlayPause={() => {
            void handlePlayPause();
          }}
          onNext={() => {
            if (MOCK_MODE) {
              stepMockPlayback(1);
              return;
            }
            void runPlaybackCommand('next', async (api) => {
              await api.next();
            }, { forcePlayOnTransfer: true, ensurePlayingAfterCommand: true });
          }}
          onToggleShuffle={() => {
            if (pendingShuffle !== null) {
              return;
            }

            const nextShuffle = !playback?.shuffle_state;
            setPendingShuffle(nextShuffle);

            if (MOCK_MODE) {
              setPlayback(playback ? { ...playback, shuffle_state: nextShuffle } : { ...mockPlayback, shuffle_state: nextShuffle });
              setInfoMessage(`Mock shuffle ${nextShuffle ? 'on' : 'off'}.`);
              return;
            }

            void (async () => {
              const ok = await runPlaybackCommand('toggle-shuffle', async (api) => {
                await api.setShuffle(nextShuffle);
              });

              if (!ok) {
                setPendingShuffle(null);
              }
            })();
          }}
          onCycleRepeat={() => {
            if (pendingRepeat !== null) {
              return;
            }

            const next =
              playback?.repeat_state === 'off'
                ? 'context'
                : playback?.repeat_state === 'context'
                  ? 'track'
                  : 'off';

            setPendingRepeat(next);

            if (MOCK_MODE) {
              setPlayback(playback ? { ...playback, repeat_state: next } : { ...mockPlayback, repeat_state: next });
              setInfoMessage(`Mock repeat ${next}.`);
              return;
            }

            void (async () => {
              const ok = await runPlaybackCommand('cycle-repeat', async (api) => {
                await api.setRepeat(next);
              });

              if (!ok) {
                setPendingRepeat(null);
              }
            })();
          }}
          onSetVolume={(volumePercent) => {
            const prevPlayback = playback;
            setPlayback(
              playback
                ? {
                    ...playback,
                    device: {
                      ...playback.device,
                      volume_percent: volumePercent,
                    },
                  }
                : playback,
            );

            if (MOCK_MODE) {
              setInfoMessage(`Mock volume ${volumePercent}%.`);
              return;
            }

            void (async () => {
              const ok = await runPlaybackCommand('set-volume', async (api) => {
                await api.setVolume(volumePercent);
              });

              if (!ok) {
                setPlayback(prevPlayback);
              }
            })();
          }}
          onConnectPlaybackSdk={() => {
            void handleConnectPlaybackSdk();
          }}
          onLogout={handleLogout}
        />
      )}
    </main>
  );
}

export default App;
