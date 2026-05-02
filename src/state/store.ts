import { create } from 'zustand';
import type { TokenSet } from '../auth/tokenStorage';
import { DEFAULT_MODE, type NavItem } from '../utils/constants';
import type {
  PlaybackState,
  QueueResponse,
  RecentlyPlayedItem,
  SearchResponse,
  SpotifyAlbum,
  SpotifyPlaylist,
  SpotifyTrack,
} from '../spotify/types';

interface UserProfile {
  id: string;
  email: string;
  display_name: string;
}

type Mode = 'lean' | 'expanded';
type LogLevel = 'error' | 'info' | 'sdk';

export interface StatusLogEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: number;
}

interface AppState {
  mode: Mode;
  activeNav: NavItem;
  authReady: boolean;
  profile: UserProfile | null;
  tokens: TokenSet | null;
  playback: PlaybackState | null;
  queue: QueueResponse | null;
  recentlyPlayed: RecentlyPlayedItem[];
  playlists: SpotifyPlaylist[];
  likedAlbums: SpotifyAlbum[];
  likedSongs: SpotifyTrack[];
  currentTrackLiked: boolean;
  searchQuery: string;
  searchResults: SearchResponse | null;
  selectedRow: number;
  sdkMessage: string;
  errorMessage: string;
  infoMessage: string;
  statusLog: StatusLogEntry[];
  setMode: (mode: Mode) => void;
  setActiveNav: (nav: NavItem) => void;
  setAuthReady: (ready: boolean) => void;
  setProfile: (profile: UserProfile | null) => void;
  setTokens: (tokens: TokenSet | null) => void;
  setPlayback: (playback: PlaybackState | null) => void;
  setQueue: (queue: QueueResponse | null) => void;
  setRecentlyPlayed: (items: RecentlyPlayedItem[]) => void;
  setPlaylists: (items: SpotifyPlaylist[]) => void;
  setLikedAlbums: (items: SpotifyAlbum[]) => void;
  setLikedSongs: (items: SpotifyTrack[]) => void;
  setCurrentTrackLiked: (liked: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: SearchResponse | null) => void;
  setSelectedRow: (index: number) => void;
  setSdkMessage: (message: string) => void;
  setErrorMessage: (message: string) => void;
  setInfoMessage: (message: string) => void;
  clearStatusLog: () => void;
}

const appendLog = (
  currentLog: StatusLogEntry[],
  level: LogLevel,
  message: string,
): StatusLogEntry[] => {
  const trimmed = message.trim();
  if (!trimmed) return currentLog;

  const last = currentLog.at(-1);
  if (last?.level === level && last.message === trimmed) {
    return currentLog;
  }

  return [
    ...currentLog,
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      level,
      message: trimmed,
      timestamp: Date.now(),
    },
  ].slice(-80);
};

export const useAppStore = create<AppState>((set) => ({
  mode: DEFAULT_MODE,
  activeNav: 'Now Playing',
  authReady: false,
  profile: null,
  tokens: null,
  playback: null,
  queue: null,
  recentlyPlayed: [],
  playlists: [],
  likedAlbums: [],
  likedSongs: [],
  currentTrackLiked: false,
  searchQuery: '',
  searchResults: null,
  selectedRow: 0,
  sdkMessage: 'Web Playback SDK not connected.',
  errorMessage: '',
  infoMessage: '',
  statusLog: [],
  setMode: (mode) => set({ mode }),
  setActiveNav: (activeNav) => set({ activeNav, selectedRow: 0 }),
  setAuthReady: (authReady) => set({ authReady }),
  setProfile: (profile) => set({ profile }),
  setTokens: (tokens) => set({ tokens }),
  setPlayback: (playback) => set({ playback }),
  setQueue: (queue) => set({ queue }),
  setRecentlyPlayed: (recentlyPlayed) => set({ recentlyPlayed }),
  setPlaylists: (playlists) => set({ playlists }),
  setLikedAlbums: (likedAlbums) => set({ likedAlbums }),
  setLikedSongs: (likedSongs) => set({ likedSongs }),
  setCurrentTrackLiked: (currentTrackLiked) => set({ currentTrackLiked }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setSelectedRow: (selectedRow) => set({ selectedRow }),
  setSdkMessage: (sdkMessage) => set((state) => ({
    sdkMessage,
    statusLog: appendLog(state.statusLog, 'sdk', sdkMessage),
  })),
  setErrorMessage: (errorMessage) => set((state) => ({
    errorMessage,
    statusLog: appendLog(state.statusLog, 'error', errorMessage),
  })),
  setInfoMessage: (infoMessage) => set((state) => ({
    infoMessage,
    statusLog: appendLog(state.statusLog, 'info', infoMessage),
  })),
  clearStatusLog: () => set({ statusLog: [] }),
}));
