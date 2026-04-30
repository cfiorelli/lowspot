import type {
  PlaybackState,
  QueueResponse,
  RecentlyPlayedItem,
  SearchResponse,
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyPlaylist,
  SpotifyTrack,
} from './types';

const artists = {
  glassArc: { id: 'mock-artist-glass-arc', name: 'Glass Arc', type: 'artist' } satisfies SpotifyArtist,
  smallHours: { id: 'mock-artist-small-hours', name: 'Small Hours', type: 'artist' } satisfies SpotifyArtist,
  northIndex: { id: 'mock-artist-north-index', name: 'North Index', type: 'artist' } satisfies SpotifyArtist,
  fieldLine: { id: 'mock-artist-field-line', name: 'Field Line', type: 'artist' } satisfies SpotifyArtist,
};

const albums = {
  transitRoom: {
    id: 'mock-album-transit-room',
    name: 'Transit Room',
    album_type: 'album',
    artists: [artists.glassArc],
    release_date: '2025-11-01',
    total_tracks: 10,
  },
  lowLightMap: {
    id: 'mock-album-low-light-map',
    name: 'Low Light Map',
    album_type: 'album',
    artists: [artists.smallHours],
    release_date: '2024-06-18',
    total_tracks: 8,
  },
  signalDesk: {
    id: 'mock-album-signal-desk',
    name: 'Signal Desk',
    album_type: 'single',
    artists: [artists.northIndex],
    release_date: '2026-01-12',
    total_tracks: 3,
  },
} satisfies Record<string, SpotifyAlbum>;

const track = (
  id: string,
  name: string,
  durationMs: number,
  artist: SpotifyArtist,
  album: SpotifyAlbum,
): SpotifyTrack => ({
  id,
  name,
  duration_ms: durationMs,
  explicit: false,
  artists: [artist],
  album,
  uri: `spotify:track:${id}`,
  type: 'track',
});

export const mockLikedSongs: SpotifyTrack[] = [
  track('mock-track-afterimage', 'Afterimage Service', 214000, artists.glassArc, albums.transitRoom),
  track('mock-track-soft-terminal', 'Soft Terminal', 188000, artists.smallHours, albums.lowLightMap),
  track('mock-track-north-window', 'North Window', 242000, artists.northIndex, albums.signalDesk),
  track('mock-track-floor-plan', 'Floor Plan for Rain', 201000, artists.fieldLine, albums.lowLightMap),
  track('mock-track-sideband', 'Sideband', 176000, artists.glassArc, albums.transitRoom),
  track('mock-track-green-room', 'Green Room Index', 232000, artists.smallHours, albums.lowLightMap),
];

export const mockLikedAlbums: SpotifyAlbum[] = [
  albums.transitRoom,
  albums.lowLightMap,
  albums.signalDesk,
];

export const mockPlaylists: SpotifyPlaylist[] = [
  {
    id: 'mock-playlist-late-work',
    name: 'Late Work',
    owner: { display_name: 'lowspot mock' },
    tracks: { total: 42 },
    uri: 'spotify:playlist:mock-playlist-late-work',
  },
  {
    id: 'mock-playlist-small-speakers',
    name: 'Small Speakers',
    owner: { display_name: 'lowspot mock' },
    tracks: { total: 28 },
    uri: 'spotify:playlist:mock-playlist-small-speakers',
  },
];

export const mockPlayback: PlaybackState = {
  device: {
    id: 'mock-device',
    is_active: true,
    is_restricted: false,
    name: 'lowspot mock device',
    type: 'Computer',
    volume_percent: 52,
  },
  shuffle_state: false,
  repeat_state: 'off',
  progress_ms: 42000,
  is_playing: true,
  item: mockLikedSongs[0],
};

export const mockQueue: QueueResponse = {
  currently_playing: mockLikedSongs[0],
  queue: mockLikedSongs.slice(1, 5),
};

export const mockRecentlyPlayed: RecentlyPlayedItem[] = mockLikedSongs.slice(0, 4).map((item, index) => ({
  track: item,
  played_at: new Date(Date.now() - index * 1000 * 60 * 38).toISOString(),
}));

export const mockSearch = (query: string): SearchResponse => {
  const normalized = query.trim().toLowerCase();
  const matches = <T extends { name: string }>(items: T[]) =>
    normalized
      ? items.filter((item) => item.name.toLowerCase().includes(normalized))
      : items;

  return {
    tracks: { items: matches(mockLikedSongs) },
    albums: { items: matches(mockLikedAlbums) },
    artists: { items: matches(Object.values(artists)) },
    playlists: { items: matches(mockPlaylists) },
    shows: { items: [] },
    audiobooks: { items: [] },
  };
};
