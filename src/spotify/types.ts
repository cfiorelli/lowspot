export interface SpotifyImage {
  url: string;
  width: number;
  height: number;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  type: 'artist';
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  album_type: string;
  artists: SpotifyArtist[];
  release_date: string;
  total_tracks: number;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  uri: string;
  type: 'track';
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  owner: {
    display_name: string;
  };
  tracks: {
    total: number;
  };
  uri: string;
}

export interface SpotifyShow {
  id: string;
  name: string;
  publisher: string;
  total_episodes: number;
  uri: string;
}

export interface SpotifyAudiobook {
  id: string;
  name: string;
  authors: Array<{ name: string }>;
  total_chapters: number;
  uri: string;
}

export interface Device {
  id: string;
  is_active: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number;
}

export interface PlaybackState {
  device: Device;
  shuffle_state: boolean;
  repeat_state: 'off' | 'track' | 'context';
  progress_ms: number;
  is_playing: boolean;
  item: SpotifyTrack | null;
}

export interface QueueResponse {
  currently_playing: SpotifyTrack | null;
  queue: SpotifyTrack[];
}

export interface RecentlyPlayedItem {
  track: SpotifyTrack;
  played_at: string;
}

export interface SearchResponse {
  tracks?: { items: SpotifyTrack[] };
  albums?: { items: SpotifyAlbum[] };
  artists?: { items: SpotifyArtist[] };
  playlists?: { items: SpotifyPlaylist[] };
  shows?: { items: SpotifyShow[] };
  audiobooks?: { items: SpotifyAudiobook[] };
}
