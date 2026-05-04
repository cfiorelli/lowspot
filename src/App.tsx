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
import { getSpotifyRequestBudget, SpotifyApiClient, SpotifyRateLimitError } from './spotify/api';
import type { PlaybackState } from './spotify/types';
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
import {
  EXPANDED_SIZE,
  IDLE_PLAYBACK_POLL_INTERVAL_MS,
  LEAN_SIZE,
  LOGIN_SIZE,
  MIN_SIZE,
  PAUSED_PLAYBACK_POLL_INTERVAL_MS,
  POLL_INTERVAL_MS,
} from './utils/constants';
import {
  loadCachedLikedSongs, saveCachedLikedSongs,
  loadCachedLikedAlbums, saveCachedLikedAlbums,
  loadCachedPlaylists, saveCachedPlaylists,
  loadCacheMeta, saveCacheMeta,
} from './utils/libraryCache';
import type { CacheWriteResult } from './utils/libraryCache';
import { formatCooldownRemaining, getActiveSpotifyCooldowns, getSpotifyCooldown } from './utils/spotifyCooldown';
import {
  clearSpotifyDiagnostics,
  loadSpotifyDiagnostics,
  recordSpotifyDiagnostic,
  type SpotifyDiagnosticEntry,
} from './utils/spotifyDiagnostics';
import { registerShortcuts } from './utils/shortcuts';
import './styles/app.css';
import './styles/lean.css';
import './styles/expanded.css';

const LIBRARY_PAGE_SIZE = 50;
const MAX_AUTO_LIBRARY_PAGES = 1;
const GENTLE_LIBRARY_SYNC_PAGE_DELAY_MS = 60_000;
const GENTLE_LIBRARY_SYNC_IDLE_BUFFER_MS = 5_000;
const MOCK_MODE = import.meta.env.VITE_LOWSPOT_MOCK === '1';
const LIBRARY_CACHE_REVALIDATE_MS = 30 * 60_000;
const RECENTLY_PLAYED_REVALIDATE_MS = 2 * 60_000;
const SEARCH_CACHE_REVALIDATE_MS = 10 * 60_000;
const MAX_PLAYBACK_URI_WINDOW = 50;

const countSearchResults = (results: ReturnType<typeof mockSearch>): number =>
  (results.tracks?.items.length ?? 0) +
  (results.albums?.items.length ?? 0) +
  (results.artists?.items.length ?? 0) +
  (results.playlists?.items.length ?? 0) +
  (results.shows?.items.length ?? 0) +
  (results.audiobooks?.items.length ?? 0);

const randomIndex = (length: number): number => {
  if (length <= 0) return 0;

  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
};

const isFresh = (timestamp: number | undefined, maxAgeMs: number): boolean =>
  typeof timestamp === 'number' && Date.now() - timestamp < maxAgeMs;

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
  const refreshPlaybackPromiseRef = useRef<Promise<PlaybackState | null> | null>(null);
  const emptyPlaybackPollsRef = useRef(0);
  const sectionLoadPendingRef = useRef(false);
  const gentleLibrarySyncCancelRef = useRef(false);
  const gentleLibrarySyncTargetRef = useRef<'Liked Songs' | 'Liked Albums' | null>(null);
  const sdkDeviceIdRef = useRef<string | null>(null);
  const sdkDisconnectRef = useRef<(() => void) | null>(null);
  const lastRecentlyPlayedFetchAtRef = useRef(0);
  const searchCacheRef = useRef(new Map<string, { at: number; results: ReturnType<typeof mockSearch> }>());
  const savedTrackCacheRef = useRef(new Map<string, boolean>());
  const windowModeRef = useRef<'login' | 'lean' | 'expanded' | null>(null);
  const [pendingShuffle, setPendingShuffle] = useState<boolean | null>(null);
  const [pendingRepeat, setPendingRepeat] = useState<'off' | 'track' | 'context' | null>(null);
  const [loadingSection, setLoadingSection] = useState<typeof activeNav | null>(null);
  const [sectionMessage, setSectionMessage] = useState('');
  const [cooldownSummary, setCooldownSummary] = useState('');
  const [spotifyDiagnostics, setSpotifyDiagnostics] = useState<SpotifyDiagnosticEntry[]>([]);
  const [sdkConnecting, setSdkConnecting] = useState(false);
  const [sdkDeviceId, setSdkDeviceId] = useState<string | null>(null);
  const [playbackControlMode, setPlaybackControlMode] = useState<'passenger' | 'driving'>('passenger');
  const isPlaybackDriving = playbackControlMode === 'driving';
  const effectiveShuffle = pendingShuffle ?? Boolean(playback?.shuffle_state);

  const ensureCacheWrite = (label: string, result: CacheWriteResult) => {
    if (result.ok) return;
    throw new Error(`${label} cache was not saved. ${result.error ?? 'Storage write failed.'}`);
  };

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

  const withApi = async <T,>(cb: (api: SpotifyApiClient) => Promise<T>, context = 'withApi'): Promise<T | null> => {
    const api = apiRef.current;
    if (!api) {
      return null;
    }

    try {
      const result = await api.withDiagnosticContext(context, () => cb(api));
      setErrorMessage('');
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unexpected Spotify API error.';
      if (error instanceof SpotifyRateLimitError) {
        const remaining = formatCooldownRemaining(Date.now() + error.retryAfterMs);
        const strikeText = error.strikes && error.strikes > 1 ? ` Repeated 429 #${error.strikes}; backing off locally.` : '';
        const sourceText = error.source === 'local'
          ? 'lowspot is pausing this Spotify endpoint to protect quota'
          : 'Spotify returned 429 for this endpoint';
        setErrorMessage(`${sourceText} (${error.path}). Try again in ${remaining}.${strikeText}`);
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
      if (nextMode === 'lean') {
        // Collapsed mode has a defined default size, but user resizing should be
        // handled by responsive layout instead of content-driven window growth.
        await appWindow.setMinSize(new LogicalSize(MIN_SIZE.width, MIN_SIZE.height));
        await appWindow.setSize(new LogicalSize(LEAN_SIZE.width, LEAN_SIZE.height));
      } else {
        const size = nextMode === 'login' ? LOGIN_SIZE : EXPANDED_SIZE;
        await appWindow.setMinSize(new LogicalSize(MIN_SIZE.width, MIN_SIZE.height));
        await appWindow.setSize(new LogicalSize(size.width, size.height));
      }
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

  const isTrackStepOperation = (operation: string): boolean =>
    operation === 'next' || operation === 'previous';

  const guardPlaybackEndpointCooldown = (context = 'playback-control'): boolean => {
    const cooldown = getSpotifyCooldown('/me/player');
    if (!cooldown) return false;

    void recordSpotifyDiagnostic({
      context: `guard:${context}`,
      method: 'LOCAL',
      path: cooldown.path,
      outcome: 'local-cooldown',
      retryAfterMs: Math.max(0, cooldown.until - Date.now()),
    });
    setErrorMessage(
      `lowspot is pausing Spotify playback controls to protect quota. Try again in ${formatCooldownRemaining(cooldown.until)}.`,
    );
    return true;
  };

  const refreshPlaybackAfterCommand = async (
    shouldSettle: boolean,
    originalTrackId: string | null,
  ): Promise<PlaybackState | null> => {
    const firstRefresh = await refreshPlayback();

    if (!shouldSettle) {
      return firstRefresh;
    }

    const isSettled = (state: PlaybackState | null): boolean => {
      const trackId = state?.item?.id ?? null;
      return Boolean(state?.is_playing && trackId && (!originalTrackId || trackId !== originalTrackId));
    };

    if (isSettled(firstRefresh)) {
      return firstRefresh;
    }

    for (const delayMs of [300, 800, 1600]) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const nextRefresh = await refreshPlayback();
      if (isSettled(nextRefresh)) {
        return nextRefresh;
      }
    }

    return useAppStore.getState().playback;
  };

  const verifyPlaybackPlayingState = async (expectedIsPlaying: boolean): Promise<boolean> => {
    for (const delayMs of [0, 250, 750]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const verifiedPlayback = await refreshPlayback();
      if (verifiedPlayback?.is_playing === expectedIsPlaying) {
        setErrorMessage('');
        return true;
      }
    }

    return false;
  };

  const runPlaybackCommand = async (
    operation: string,
    command: (api: SpotifyApiClient) => Promise<void>,
    options?: { forcePlayOnTransfer?: boolean; settlePlayback?: boolean; expectedIsPlaying?: boolean },
  ): Promise<boolean> => {
    if (!isPlaybackDriving && !MOCK_MODE) {
      setInfoMessage('lowspot is not driving right now. Take control before using playback controls.');
      return false;
    }

    const api = apiRef.current;
    if (!api) {
      return false;
    }

    const runOnce = async () => api.withDiagnosticContext(`playback:${operation}`, async () => {
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
    });

    setErrorMessage('');
    const originalTrackId = useAppStore.getState().playback?.item?.id ?? null;

    try {
      await runOnce();
      await refreshPlaybackAfterCommand(Boolean(options?.settlePlayback), originalTrackId);
      return true;
    } catch (error) {
      const firstMessage = error instanceof Error ? error.message : 'Unexpected Spotify API error.';
      console.warn('[playback-command:error]', {
        operation,
        error: firstMessage,
      });

      // Spotify returns 403 "Restriction violated" on some Connect devices but still
      // executes the command. Don't log it as an error or reset optimistic UI — just
      // verify state via refresh.
      if (/Restriction violated/i.test(firstMessage)) {
        await refreshPlaybackAfterCommand(Boolean(options?.settlePlayback), originalTrackId);
        return true;
      }

      if (isTrackStepOperation(operation)) {
        await refreshPlayback();
        const verifiedTrackId = useAppStore.getState().playback?.item?.id ?? null;
        if (verifiedTrackId && verifiedTrackId !== originalTrackId) {
          setErrorMessage('');
          return true;
        }
      }

      if (options?.expectedIsPlaying !== undefined) {
        if (await verifyPlaybackPlayingState(options.expectedIsPlaying)) {
          return true;
        }
      }

      if (shouldRetryPlaybackError(firstMessage)) {
        try {
          await refreshPlayback();
          await new Promise((resolve) => setTimeout(resolve, 250));
          await runOnce();
          await refreshPlaybackAfterCommand(Boolean(options?.settlePlayback), originalTrackId);
          return true;
        } catch (retryError) {
          if (options?.expectedIsPlaying !== undefined) {
            if (await verifyPlaybackPlayingState(options.expectedIsPlaying)) {
              return true;
            }
          }

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

  const refreshPlayback = async (): Promise<PlaybackState | null> => {
    if (refreshPlaybackPromiseRef.current) {
      return refreshPlaybackPromiseRef.current;
    }

    refreshPlaybackPendingRef.current = true;
    const refreshPromise = (async (): Promise<PlaybackState | null> => {
      let latestPlayback: PlaybackState | null = null;

      await withApi(async (api) => {
        const trackId = useAppStore.getState().playback?.item?.id;
        const queuePollDue = useAppStore.getState().activeNav === 'Queue';

        const playbackState = await api.getPlaybackState().catch(() => null);
        const queueState = queuePollDue ? await api.getQueue().catch(() => null) : null;

        if (playbackState) {
          latestPlayback = playbackState;
          emptyPlaybackPollsRef.current = 0;
          setPlayback(playbackState);
          const newTrackId = playbackState.item?.id;

          if (newTrackId && newTrackId !== trackId) {
            const cachedLiked = savedTrackCacheRef.current.get(newTrackId);
            if (cachedLiked !== undefined) {
              setCurrentTrackLiked(cachedLiked);
            } else if (useAppStore.getState().likedSongs.some((track) => track.id === newTrackId)) {
              savedTrackCacheRef.current.set(newTrackId, true);
              setCurrentTrackLiked(true);
            } else {
              try {
                const liked = await api.isTrackSaved(newTrackId);
                const isLiked = Boolean(liked[0]);
                savedTrackCacheRef.current.set(newTrackId, isLiked);
                setCurrentTrackLiked(isLiked);
              } catch {
                setCurrentTrackLiked(false);
              }
            }
          }
        } else {
          emptyPlaybackPollsRef.current += 1;
        }

        if (queueState) {
          setQueue(queueState);
        }
      }, 'refreshPlayback');

      return latestPlayback ?? useAppStore.getState().playback;
    })().finally(() => {
      refreshPlaybackPendingRef.current = false;
      refreshPlaybackPromiseRef.current = null;
    });

    refreshPlaybackPromiseRef.current = refreshPromise;
    return refreshPromise;
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
      const initialNav = useAppStore.getState().activeNav;
      if (initialNav !== 'Now Playing') {
        void loadSectionForNav(initialNav);
      }
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
      setPlaybackControlMode('passenger');
      return;
    }

    sdkDisconnectRef.current?.();
    sdkDisconnectRef.current = null;
    sdkDeviceIdRef.current = null;
    gentleLibrarySyncCancelRef.current = true;
    setSdkDeviceId(null);
    apiRef.current?.cancel();
    apiRef.current = null;
    await clearTokens();
    gentleLibrarySyncTargetRef.current = null;
    setTokens(null);
    setProfile(null);
    setPlayback(null);
    setQueue(null);
    setSearchResults(null);
    setCurrentTrackLiked(false);
    setLoadingSection(null);
    setSectionMessage('');
    sectionLoadPendingRef.current = false;
    setPlaybackControlMode('passenger');
    setErrorMessage('');
    setInfoMessage('Logged out.');
  };

  const handleConnectPlaybackSdk = async (force = false) => {
    if (MOCK_MODE) {
      setSdkMessage('Mock playback device connected.');
      setInfoMessage('Mock playback device connected.');
      setSdkDeviceId('mock-device');
      sdkDeviceIdRef.current = 'mock-device';
      return;
    }

    if (!force && !isPlaybackDriving) {
      setInfoMessage('lowspot is not driving right now. Take control before connecting the local device.');
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
      const connection = await Promise.race([
        connectPlaybackSdk(activeTokens.accessToken, (status) => {
          setSdkMessage(status.message);
          if (status.ready) {
            sdkDeviceIdRef.current = status.deviceId ?? null;
            setSdkDeviceId(status.deviceId ?? null);
            setInfoMessage(`Spotify Connect device ready: lowspot (${status.deviceId})`);
          } else {
            sdkDeviceIdRef.current = null;
            setSdkDeviceId(null);
          }
        }),
        new Promise<null>((resolve) => {
          window.setTimeout(() => {
            setSdkMessage('Local playback device did not connect. Spotify controls can still target an active device.');
            setInfoMessage('Local playback device did not connect. Spotify controls can still target an active device.');
            resolve(null);
          }, 8_000);
        }),
      ]);

      sdkDisconnectRef.current?.();
      sdkDisconnectRef.current = connection?.disconnect ?? null;
    } finally {
      setSdkConnecting(false);
    }
  };

  const handleTakePlaybackControl = async () => {
    setPlaybackControlMode('driving');
    setInfoMessage('lowspot is driving.');

    if (MOCK_MODE) {
      setSdkMessage('Mock playback device connected.');
      setSdkDeviceId('mock-device');
      sdkDeviceIdRef.current = 'mock-device';
      return;
    }

    await handleConnectPlaybackSdk(true);
    await refreshPlayback();
  };

  const handleReleasePlaybackControl = () => {
    setPlaybackControlMode('passenger');
    setPendingShuffle(null);
    setPendingRepeat(null);
    setInfoMessage('lowspot is not driving right now.');
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

    // If nothing is visibly loaded in Now Playing, never ask Spotify to
    // resume an unknown previous context. Only start from a visible row.
    if (!playback?.item) {
      if (tableRows.length > 0 && activeNav !== 'Now Playing') {
        const startIdx = effectiveShuffle
          ? randomIndex(tableRows.length)
          : Math.min(selectedRow, tableRows.length - 1);
        void playSelectedRow(startIdx);
        return;
      }

      setInfoMessage('Choose music from search or your library before pressing Play.');
      return;
    }

    // No active device but we have rows: start playing from the current section.
    if (!playback?.device?.id && !sdkDeviceId && tableRows.length > 0 && activeNav !== 'Now Playing') {
      const startIdx = effectiveShuffle
        ? randomIndex(tableRows.length)
        : Math.min(selectedRow, tableRows.length - 1);
      void playSelectedRow(startIdx);
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
    }, {
      expectedIsPlaying: !playback?.is_playing,
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
        savedTrackCacheRef.current.set(trackId, false);
      } else {
        await api.saveTrack(trackId);
        savedTrackCacheRef.current.set(trackId, true);
      }

      setCurrentTrackLiked(!currentTrackLiked);
    }, currentTrackLiked ? 'toggleLike:remove' : 'toggleLike:save');
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

    const searchCacheKey = q.toLocaleLowerCase();
    const cachedSearch = searchCacheRef.current.get(searchCacheKey);
    if (cachedSearch && isFresh(cachedSearch.at, SEARCH_CACHE_REVALIDATE_MS)) {
      setSearchResults(cachedSearch.results);
      const cachedCount = countSearchResults(cachedSearch.results);
      const message = cachedCount === 0
        ? `No cached results found for "${q}".`
        : `Loaded ${cachedCount} cached search results for "${q}".`;
      setSectionMessage(message);
      setLoadingSection(null);
      setInfoMessage(message);
      return;
    }

    const resultCount = await withApi(async (api) => {
      const result = await api.search(q);
      setSearchResults(result);
      searchCacheRef.current.set(searchCacheKey, { at: Date.now(), results: result });
      return countSearchResults(result);
    }, `search:${q}`);

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

      const cached = await loadCachedLikedSongs();
      if (cached.length > 0) setLikedSongs(cached.map((e) => e.track));
      const cacheMeta = await loadCacheMeta('likedSongs');
      if (cached.length > 0 && cacheMeta?.complete && isFresh(cacheMeta.syncedAt, LIBRARY_CACHE_REVALIDATE_MS)) {
        const message = `Loaded ${cached.length} liked songs from cache.`;
        setInfoMessage(message);
        finishSection(message);
        return;
      }
      if (cached.length > 0) {
        const message = cacheMeta?.complete
          ? `Loaded ${cached.length} cached liked songs. Background refresh is skipped to protect Spotify quota.`
          : `Loaded ${cached.length} cached liked songs. Gentle fill will continue in the background.`;
        setInfoMessage(message);
        finishSection(message);
        if (!cacheMeta?.complete) {
          void startGentleLibrarySync('Liked Songs');
        }
        return;
      }

      const loaded = await withApi(async (api) => {
        const newestAddedAt = cached[0]?.added_at ?? '';
        let maxPages = MAX_AUTO_LIBRARY_PAGES;
        let offset = 0;
        let nextOffset = 0;
        let total = cached.length;
        let hitCache = false;
        let appendAfterCache = false;
        const newEntries: typeof cached = [];

        if (cached.length > 0) {
          const probe = await api.getLikedSongs(1, 0);
          total = probe.total;
          const latestRemote = probe.items.find((item) => item.track)?.added_at ?? '';

          if (!latestRemote || latestRemote <= newestAddedAt) {
            if (total <= cached.length) {
              ensureCacheWrite('Liked Songs metadata', await saveCacheMeta('likedSongs', {
                syncedAt: Date.now(),
                total,
                complete: true,
              }));
              return { loaded: cached.length, total, capped: false, fromCache: true };
            }

            appendAfterCache = true;
            offset = cached.length;
            maxPages = MAX_AUTO_LIBRARY_PAGES;
          }
        }

        for (let pagesFetched = 0; pagesFetched < maxPages; pagesFetched += 1) {
          const page = await api.getLikedSongs(LIBRARY_PAGE_SIZE, offset);
          total = page.total;
          nextOffset = page.offset + page.limit;

          for (const item of page.items) {
            if (!item.track) continue;
            if (!appendAfterCache && newestAddedAt && item.added_at <= newestAddedAt) { hitCache = true; break; }
            newEntries.push({ added_at: item.added_at, track: item.track });
          }

          if (hitCache || !page.next) break;
          offset += page.limit;

          const inProgress = newEntries.length + cached.length;
          const progressEntries = appendAfterCache ? [...cached, ...newEntries] : [...newEntries, ...cached];
          setLikedSongs(progressEntries.map((e) => e.track));
          ensureCacheWrite('Liked Songs', await saveCachedLikedSongs(progressEntries));
          if (total > 0) setInfoMessage(`Loading liked songs… ${inProgress} of ${total}`);
        }

        const seen = new Set<string>();
        const merged = (appendAfterCache ? [...cached, ...newEntries] : [...newEntries, ...cached]).filter((entry) => {
          if (seen.has(entry.track.id)) return false;
          seen.add(entry.track.id);
          return true;
        });
        setLikedSongs(merged.map((e) => e.track));
        ensureCacheWrite('Liked Songs', await saveCachedLikedSongs(merged));
        const capped = !hitCache && total > merged.length;
        ensureCacheWrite('Liked Songs metadata', await saveCacheMeta('likedSongs', {
          syncedAt: Date.now(),
          total,
          complete: !capped,
          nextOffset,
        }));
        return { loaded: merged.length, total, capped, fromCache: false };
      }, 'loadSection:Liked Songs');

      const message = loaded === null
        ? cached.length > 0
          ? `Showing ${cached.length} cached liked songs. Spotify refresh paused; check the status message for cooldown details.`
          : 'No local liked songs cache exists for this installed app yet, and Spotify rate-limited the first library page. Wait for the cooldown, then try again once.'
        : loaded.loaded === 0
          ? 'Spotify returned 0 liked songs for this account/token.'
          : loaded.fromCache
            ? `Loaded ${loaded.loaded} liked songs from cache.`
            : loaded.capped
              ? `Loaded ${loaded.loaded} of ${loaded.total} liked songs. Gentle fill will continue in the background.`
              : `Loaded ${loaded.loaded} liked songs.`;
      setInfoMessage(message);
      finishSection(message);
      if (loaded?.capped) {
        void startGentleLibrarySync('Liked Songs');
      }
      return;
    }

    if (nav === 'Liked Albums') {
      if (!tokenScopes.has('user-library-read')) {
        finishSection('Spotify token is missing user-library-read. Log out, log in again, and approve library access.');
        return;
      }

      const cached = await loadCachedLikedAlbums();
      if (cached.length > 0) setLikedAlbums(cached.map((e) => e.album));
      const cacheMeta = await loadCacheMeta('likedAlbums');
      if (cached.length > 0 && cacheMeta?.complete && isFresh(cacheMeta.syncedAt, LIBRARY_CACHE_REVALIDATE_MS)) {
        const message = `Loaded ${cached.length} liked albums from cache.`;
        setInfoMessage(message);
        finishSection(message);
        return;
      }
      if (cached.length > 0) {
        const message = cacheMeta?.complete
          ? `Loaded ${cached.length} cached liked albums. Background refresh is skipped to protect Spotify quota.`
          : `Loaded ${cached.length} cached liked albums. Gentle fill will continue in the background.`;
        setInfoMessage(message);
        finishSection(message);
        if (!cacheMeta?.complete) {
          void startGentleLibrarySync('Liked Albums');
        }
        return;
      }

      const loaded = await withApi(async (api) => {
        const newestAddedAt = cached[0]?.added_at ?? '';
        let maxPages = MAX_AUTO_LIBRARY_PAGES;
        let offset = 0;
        let nextOffset = 0;
        let total = cached.length;
        let hitCache = false;
        let appendAfterCache = false;
        const newEntries: typeof cached = [];

        if (cached.length > 0) {
          const probe = await api.getLikedAlbums(1, 0);
          total = probe.total;
          const latestRemote = probe.items.find((item) => item.album)?.added_at ?? '';

          if (!latestRemote || latestRemote <= newestAddedAt) {
            if (total <= cached.length) {
              ensureCacheWrite('Liked Albums metadata', await saveCacheMeta('likedAlbums', {
                syncedAt: Date.now(),
                total,
                complete: true,
              }));
              return { loaded: cached.length, total, capped: false, fromCache: true };
            }

            appendAfterCache = true;
            offset = cached.length;
            maxPages = MAX_AUTO_LIBRARY_PAGES;
          }
        }

        for (let pagesFetched = 0; pagesFetched < maxPages; pagesFetched += 1) {
          const page = await api.getLikedAlbums(LIBRARY_PAGE_SIZE, offset);
          total = page.total;
          nextOffset = page.offset + page.limit;

          for (const item of page.items) {
            if (!item.album) continue;
            if (!appendAfterCache && newestAddedAt && item.added_at <= newestAddedAt) { hitCache = true; break; }
            newEntries.push({ added_at: item.added_at, album: item.album });
          }

          if (hitCache || !page.next) break;
          offset += page.limit;
          const progressEntries = appendAfterCache ? [...cached, ...newEntries] : [...newEntries, ...cached];
          ensureCacheWrite('Liked Albums', await saveCachedLikedAlbums(progressEntries));
          if (total > 0) setInfoMessage(`Loading liked albums… ${newEntries.length + cached.length} of ${total}`);
        }

        const seen = new Set<string>();
        const merged = (appendAfterCache ? [...cached, ...newEntries] : [...newEntries, ...cached]).filter((entry) => {
          if (seen.has(entry.album.id)) return false;
          seen.add(entry.album.id);
          return true;
        });
        setLikedAlbums(merged.map((e) => e.album));
        ensureCacheWrite('Liked Albums', await saveCachedLikedAlbums(merged));
        const capped = !hitCache && total > merged.length;
        ensureCacheWrite('Liked Albums metadata', await saveCacheMeta('likedAlbums', {
          syncedAt: Date.now(),
          total,
          complete: !capped,
          nextOffset,
        }));
        return { loaded: merged.length, total, capped, fromCache: false };
      }, 'loadSection:Liked Albums');

      const message = loaded === null
        ? cached.length > 0
          ? `Showing ${cached.length} cached liked albums. Spotify refresh paused; check the status message for cooldown details.`
          : 'No local liked albums cache exists for this installed app yet, and Spotify rate-limited the first library page. Wait for the cooldown, then try again once.'
        : loaded.loaded === 0
          ? 'Spotify returned 0 liked albums for this account/token.'
          : loaded.fromCache
            ? `Loaded ${loaded.loaded} liked albums from cache.`
            : loaded.capped
              ? `Loaded ${loaded.loaded} of ${loaded.total} liked albums. Gentle fill will continue in the background.`
              : `Loaded ${loaded.loaded} liked albums.`;
      setInfoMessage(message);
      finishSection(message);
      if (loaded?.capped) {
        void startGentleLibrarySync('Liked Albums');
      }
      return;
    }

    if (nav === 'Playlists') {
      const cached = await loadCachedPlaylists();
      if (cached.length > 0) setPlaylists(cached);
      const cacheMeta = await loadCacheMeta('playlists');
      if (cached.length > 0 && isFresh(cacheMeta?.syncedAt, LIBRARY_CACHE_REVALIDATE_MS)) {
        finishSection(`Loaded ${cached.length} playlists from cache.`);
        return;
      }

      const loaded = await withApi(async (api) => {
        const data = await api.getPlaylists(50);
        setPlaylists(data.items);
        ensureCacheWrite('Playlists', await saveCachedPlaylists(data.items));
        ensureCacheWrite('Playlists metadata', await saveCacheMeta('playlists', {
          syncedAt: Date.now(),
          total: data.total,
          complete: !data.next,
        }));
        return data.items.length;
      }, 'loadSection:Playlists');

      finishSection(
        loaded === null
          ? cached.length > 0
            ? `Showing ${cached.length} cached playlists. Spotify refresh paused; check the status message for cooldown details.`
            : 'Playlists request failed. Check the status message above for Spotify details.'
          : loaded === 0
            ? 'Spotify returned 0 playlists for this account/token.'
            : `Loaded ${loaded} playlists.`,
      );
      return;
    }

    await withApi(async (api) => {
      if (nav === 'Recently Played') {
        if (recentlyPlayed.length > 0 && isFresh(lastRecentlyPlayedFetchAtRef.current, RECENTLY_PLAYED_REVALIDATE_MS)) {
          return;
        }

        const data = await api.getRecentlyPlayed(50);
        setRecentlyPlayed(data.items);
        lastRecentlyPlayedFetchAtRef.current = Date.now();
        return;
      }

      if (nav === 'Queue' || nav === 'Now Playing') {
        await refreshPlayback();
      }
    }, `loadSection:${nav}`);
    finishSection('');
  };

  const waitForGentleLibrarySync = async (ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;

    while (!gentleLibrarySyncCancelRef.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
    }

    return !gentleLibrarySyncCancelRef.current;
  };

  const waitForGentleLibraryRequestWindow = async (
    nav: 'Liked Songs' | 'Liked Albums',
    path: string,
  ): Promise<boolean> => {
    while (!gentleLibrarySyncCancelRef.current) {
      const cooldown = getSpotifyCooldown(path);
      if (cooldown) {
        const waitMs = Math.max(1000, cooldown.until - Date.now() + GENTLE_LIBRARY_SYNC_IDLE_BUFFER_MS);
        const message = `Gentle ${nav.toLowerCase()} fill waiting ${Math.ceil(waitMs / 1000)}s for Spotify cooldown.`;
        setInfoMessage(message);
        setSectionMessage(message);
        const keepGoing = await waitForGentleLibrarySync(waitMs);
        if (!keepGoing) return false;
        continue;
      }

      const budget = getSpotifyRequestBudget();
      if (budget.used === 0) {
        return true;
      }

      const waitMs = Math.max(1000, budget.resetInMs + GENTLE_LIBRARY_SYNC_IDLE_BUFFER_MS);
      setSectionMessage(`Gentle ${nav.toLowerCase()} fill waiting ${Math.ceil(waitMs / 1000)}s for a quiet request window...`);
      const keepGoing = await waitForGentleLibrarySync(waitMs);
      if (!keepGoing) return false;
    }

    return false;
  };

  const runGentleLikedSongsSync = async (): Promise<void> => {
    let cached = await loadCachedLikedSongs();
    if (cached.length > 0) setLikedSongs(cached.map((entry) => entry.track));
    let meta = await loadCacheMeta('likedSongs');
    let offset = meta?.nextOffset ?? cached.length;

    while (!gentleLibrarySyncCancelRef.current) {
      if (meta?.complete) {
        const message = `Liked Songs cache is complete with ${cached.length} songs.`;
        setInfoMessage(message);
        setSectionMessage(message);
        return;
      }

      const canRequest = await waitForGentleLibraryRequestWindow('Liked Songs', '/me/tracks');
      if (!canRequest) return;

      const page = await withApi(async (api) => (
        api.getLikedSongs(LIBRARY_PAGE_SIZE, offset)
      ), 'gentleLibrarySync:Liked Songs');

      if (!page) {
        if (getSpotifyCooldown('/me/tracks')) continue;
        const message = `Kept ${cached.length} cached liked songs. Gentle fill paused; check the status message for cooldown details.`;
        setInfoMessage(message);
        setSectionMessage(message);
        return;
      }

      const newEntries = page.items.flatMap((item) => (
        item.track ? [{ added_at: item.added_at, track: item.track }] : []
      ));
      const seen = new Set<string>();
      const merged = [...cached, ...newEntries].filter((entry) => {
        if (seen.has(entry.track.id)) return false;
        seen.add(entry.track.id);
        return true;
      });
      const added = merged.length - cached.length;
      const complete = !page.next || page.offset + page.limit >= page.total || merged.length >= page.total;
      offset = page.offset + page.limit;
      cached = merged;

      setLikedSongs(merged.map((entry) => entry.track));
      ensureCacheWrite('Liked Songs', await saveCachedLikedSongs(merged));
      ensureCacheWrite('Liked Songs metadata', await saveCacheMeta('likedSongs', {
        syncedAt: Date.now(),
        total: page.total,
        complete,
        nextOffset: offset,
      }));

      meta = { syncedAt: Date.now(), total: page.total, complete, nextOffset: offset };
      const message = complete
        ? `Liked Songs cache is complete with ${merged.length} songs.`
        : `Gentle fill added ${added} liked songs. Cache has ${merged.length} of ${page.total}.`;
      setInfoMessage(message);
      setSectionMessage(message);
      if (complete) return;

      const keepGoing = await waitForGentleLibrarySync(GENTLE_LIBRARY_SYNC_PAGE_DELAY_MS);
      if (!keepGoing) return;
    }
  };

  const runGentleLikedAlbumsSync = async (): Promise<void> => {
    let cached = await loadCachedLikedAlbums();
    if (cached.length > 0) setLikedAlbums(cached.map((entry) => entry.album));
    let meta = await loadCacheMeta('likedAlbums');
    let offset = meta?.nextOffset ?? cached.length;

    while (!gentleLibrarySyncCancelRef.current) {
      if (meta?.complete) {
        const message = `Liked Albums cache is complete with ${cached.length} albums.`;
        setInfoMessage(message);
        setSectionMessage(message);
        return;
      }

      const canRequest = await waitForGentleLibraryRequestWindow('Liked Albums', '/me/albums');
      if (!canRequest) return;

      const page = await withApi(async (api) => (
        api.getLikedAlbums(LIBRARY_PAGE_SIZE, offset)
      ), 'gentleLibrarySync:Liked Albums');

      if (!page) {
        if (getSpotifyCooldown('/me/albums')) continue;
        const message = `Kept ${cached.length} cached liked albums. Gentle fill paused; check the status message for cooldown details.`;
        setInfoMessage(message);
        setSectionMessage(message);
        return;
      }

      const newEntries = page.items.flatMap((item) => (
        item.album ? [{ added_at: item.added_at, album: item.album }] : []
      ));
      const seen = new Set<string>();
      const merged = [...cached, ...newEntries].filter((entry) => {
        if (seen.has(entry.album.id)) return false;
        seen.add(entry.album.id);
        return true;
      });
      const added = merged.length - cached.length;
      const complete = !page.next || page.offset + page.limit >= page.total || merged.length >= page.total;
      offset = page.offset + page.limit;
      cached = merged;

      setLikedAlbums(merged.map((entry) => entry.album));
      ensureCacheWrite('Liked Albums', await saveCachedLikedAlbums(merged));
      ensureCacheWrite('Liked Albums metadata', await saveCacheMeta('likedAlbums', {
        syncedAt: Date.now(),
        total: page.total,
        complete,
        nextOffset: offset,
      }));

      meta = { syncedAt: Date.now(), total: page.total, complete, nextOffset: offset };
      const message = complete
        ? `Liked Albums cache is complete with ${merged.length} albums.`
        : `Gentle fill added ${added} liked albums. Cache has ${merged.length} of ${page.total}.`;
      setInfoMessage(message);
      setSectionMessage(message);
      if (complete) return;

      const keepGoing = await waitForGentleLibrarySync(GENTLE_LIBRARY_SYNC_PAGE_DELAY_MS);
      if (!keepGoing) return;
    }
  };

  const startGentleLibrarySync = async (nav: 'Liked Songs' | 'Liked Albums') => {
    const currentTarget = gentleLibrarySyncTargetRef.current;

    if (currentTarget === nav) {
      return;
    }

    if (currentTarget) {
      setInfoMessage(`Gentle ${currentTarget.toLowerCase()} fill is already running. ${nav} will wait.`);
      return;
    }

    const activeTokens = useAppStore.getState().tokens;
    const tokenScopes = new Set(activeTokens?.scope.split(/\s+/).filter(Boolean) ?? []);
    if (!tokenScopes.has('user-library-read')) {
      setErrorMessage('Spotify token is missing user-library-read. Log out, log in again, and approve library access.');
      return;
    }

    gentleLibrarySyncCancelRef.current = false;
    gentleLibrarySyncTargetRef.current = nav;
    setLoadingSection(nav);
    setSectionMessage(`Gentle ${nav.toLowerCase()} fill starting in the background...`);

    try {
      if (nav === 'Liked Songs') {
        await runGentleLikedSongsSync();
        return;
      }

      await runGentleLikedAlbumsSync();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : `Gentle ${nav.toLowerCase()} fill failed. Cached progress is saved.`;
      setErrorMessage(message);
    } finally {
      gentleLibrarySyncCancelRef.current = false;
      if (gentleLibrarySyncTargetRef.current === nav) {
        gentleLibrarySyncTargetRef.current = null;
      }
      setLoadingSection((current) => (current === nav ? null : current));
    }
  };

  const isContextRowType = (type: string): boolean =>
    type === 'Album' || type === 'Artist' || type === 'Playlist' || type.startsWith('Playlist (');

  const getTrackPlaybackUris = (startIndex: number, fallbackUri: string): string[] => {
    if (activeNav !== 'Liked Songs') {
      return [fallbackUri];
    }

    const uris = tableRows
      .slice(startIndex, startIndex + MAX_PLAYBACK_URI_WINDOW)
      .filter((row) => row.type === 'Track' && row.uri)
      .map((row) => row.uri as string);

    return uris.length > 0 ? uris : [fallbackUri];
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

    const isContextPlayback = isContextRowType(row.type);
    const ok = await runPlaybackCommand('play-row', async (api) => {
      if (row.type === 'Track') {
        await api.play(sdkDeviceIdRef.current ?? undefined, getTrackPlaybackUris(index, uri));
      } else if (isContextPlayback) {
        await api.play(sdkDeviceIdRef.current ?? undefined, undefined, uri);
      } else {
        await api.play(sdkDeviceIdRef.current ?? undefined, [uri]);
      }
    }, { settlePlayback: isContextPlayback });

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

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const getNextPlaybackPollDelay = () => {
      if (!isPlaybackDriving) {
        return PAUSED_PLAYBACK_POLL_INTERVAL_MS;
      }

      const currentPlayback = useAppStore.getState().playback;

      if (document.hidden) {
        return IDLE_PLAYBACK_POLL_INTERVAL_MS;
      }

      if (!currentPlayback?.item && emptyPlaybackPollsRef.current > 0) {
        return IDLE_PLAYBACK_POLL_INTERVAL_MS;
      }

      if (currentPlayback && !currentPlayback.is_playing) {
        return PAUSED_PLAYBACK_POLL_INTERVAL_MS;
      }

      return POLL_INTERVAL_MS;
    };

    const scheduleNextPoll = () => {
      timer = setTimeout(runPoll, getNextPlaybackPollDelay());
    };

    const runPoll = async () => {
      if (cancelled) return;
      await ensureFreshToken();
      if (isPlaybackDriving) {
        await refreshPlayback();
      }
      if (!cancelled) {
        scheduleNextPoll();
      }
    };

    const wakeOnVisible = () => {
      if (document.hidden) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        if (cancelled) return;
        await ensureFreshToken();
        await refreshPlayback();
        if (!cancelled) {
          scheduleNextPoll();
        }
      }, 0);
    };

    scheduleNextPoll();
    document.addEventListener('visibilitychange', wakeOnVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', wakeOnVisible);
    };
  }, [tokens, isPlaybackDriving]);

  useEffect(() => {
    const refreshCooldownSummary = () => {
      const activeCooldowns = getActiveSpotifyCooldowns();
      const cooldownText = activeCooldowns
        .map((cooldown) => `${cooldown.path}: ${formatCooldownRemaining(cooldown.until)}`)
        .join(' | ');
      const budget = getSpotifyRequestBudget();
      const budgetText = `Request budget: ${budget.used}/${budget.budget} in ${Math.round(budget.windowMs / 1000)}s`;
      setCooldownSummary(cooldownText ? `${budgetText} | Cooldowns: ${cooldownText}` : budgetText);
    };

    refreshCooldownSummary();
    const timer = setInterval(refreshCooldownSummary, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshDiagnostics = () => {
      void loadSpotifyDiagnostics().then(setSpotifyDiagnostics);
    };

    refreshDiagnostics();
    const timer = setInterval(refreshDiagnostics, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    sdkDisconnectRef.current?.();
  }, []);

  useEffect(() => {
    const nextMode = !authReady || (!tokens && !MOCK_MODE) ? 'login' : mode;
    if (windowModeRef.current === nextMode) return;
    windowModeRef.current = nextMode;
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

  const canPlayVisibleSelection = mode === 'expanded' && activeNav !== 'Now Playing' && tableRows.length > 0;
  const playbackControlsDisabled = !isPlaybackDriving || !(playback?.item || canPlayVisibleSelection);
  const playbackEndpointCooldown = getSpotifyCooldown('/me/player');
  const playbackSettingsDisabled = !isPlaybackDriving || !playback?.device?.id || Boolean(playbackEndpointCooldown);
  const effectiveRepeat = pendingRepeat ?? (playback?.repeat_state ?? 'off');

  return (
    <main className="app-shell" data-mode={mode}>
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
          playbackControlActive={isPlaybackDriving}
          playbackControlPending={sdkConnecting}
          onPrevious={() => {
            if (MOCK_MODE) {
              stepMockPlayback(-1);
              return;
            }
            void runPlaybackCommand('previous', async (api) => {
              await api.previous();
            }, { forcePlayOnTransfer: true });
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
            }, { forcePlayOnTransfer: true });
          }}
          onToggleLike={() => {
            void handleToggleLike();
          }}
          onTakePlaybackControl={() => {
            void handleTakePlaybackControl();
          }}
          onReleasePlaybackControl={handleReleasePlaybackControl}
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
          playbackSettingsDisabled={playbackSettingsDisabled}
          playbackControlActive={isPlaybackDriving}
          playbackControlPending={sdkConnecting}
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
          spotifyDiagnostics={spotifyDiagnostics}
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
          onClearSpotifyDiagnostics={() => {
            void clearSpotifyDiagnostics().then(() => setSpotifyDiagnostics([]));
          }}
          onSearch={(query) => {
            void handleSearch(query);
          }}
          onRowSelect={setSelectedRow}
          onPlayTrack={(trackUri, index) => {
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
                await api.play(sdkDeviceIdRef.current ?? undefined, getTrackPlaybackUris(index, trackUri));
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
              }, { forcePlayOnTransfer: true, settlePlayback: true });

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
            }, { forcePlayOnTransfer: true });
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
            }, { forcePlayOnTransfer: true });
          }}
          onTakePlaybackControl={() => {
            void handleTakePlaybackControl();
          }}
          onReleasePlaybackControl={handleReleasePlaybackControl}
          onToggleShuffle={() => {
            if (pendingShuffle !== null) {
              return;
            }

            if (guardPlaybackEndpointCooldown('toggle-shuffle')) {
              return;
            }

            if (!playback?.device?.id) {
              setInfoMessage('Start playback before changing shuffle.');
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
                // Device may have applied the command despite returning an error.
                // Verify actual state before giving up.
                await new Promise((r) => setTimeout(r, 500));
                await refreshPlayback();
                if (useAppStore.getState().playback?.shuffle_state === nextShuffle) {
                  setErrorMessage(''); // Command succeeded — clear the spurious error.
                } else {
                  setPendingShuffle(null);
                }
              }
            })();
          }}
          onCycleRepeat={() => {
            if (pendingRepeat !== null) {
              return;
            }

            if (guardPlaybackEndpointCooldown('cycle-repeat')) {
              return;
            }

            if (!playback?.device?.id) {
              setInfoMessage('Start playback before changing repeat.');
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
                await new Promise((r) => setTimeout(r, 500));
                await refreshPlayback();
                if (useAppStore.getState().playback?.repeat_state === next) {
                  setErrorMessage('');
                } else {
                  setPendingRepeat(null);
                }
              }
            })();
          }}
          onSetVolume={(volumePercent) => {
            if (guardPlaybackEndpointCooldown('set-volume')) {
              return;
            }

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
        />
      )}
    </main>
  );
}

export default App;
