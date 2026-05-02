import type { PlaybackState, QueueResponse, RecentlyPlayedItem, SearchResponse, SpotifyAlbum, SpotifyPlaylist, SpotifyTrack } from '../spotify/types';
import type { NavItem } from '../utils/constants';
import { formatArtists } from '../utils/format';

export interface RenderRow {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  uri?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const safeArtists = (value: unknown): Array<{ name: string }> =>
  Array.isArray(value)
    ? value.filter((artist): artist is { name: string } => isRecord(artist) && typeof artist.name === 'string')
    : [];

const asSearchItems = (value: unknown): unknown[] =>
  isRecord(value) && Array.isArray(value.items) ? value.items : [];

interface NamedSearchItem extends Record<string, unknown> {
  id: string;
  name: string;
}

interface UriSearchItem extends NamedSearchItem {
  uri: string;
}

const isNamedSearchItem = (value: unknown): value is NamedSearchItem =>
  isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';

const isUriSearchItem = (value: unknown): value is UriSearchItem =>
  isNamedSearchItem(value) && typeof value.uri === 'string';

export const buildRowsForNav = (
  activeNav: NavItem,
  likedSongs: SpotifyTrack[],
  likedAlbums: SpotifyAlbum[],
  playlists: SpotifyPlaylist[],
  searchResults: SearchResponse | null,
  queue: QueueResponse | null,
  recentlyPlayed: RecentlyPlayedItem[],
  playback: PlaybackState | null,
): RenderRow[] => {
  if (activeNav === 'Now Playing') {
    if (!playback?.item) {
      return [];
    }

    return [
      {
        id: playback.item.id,
        title: playback.item.name,
        subtitle: formatArtists(playback.item.artists),
        type: playback.is_playing ? 'Playing' : 'Paused',
        uri: playback.item.uri,
      },
    ];
  }

  if (activeNav === 'Liked Songs') {
    return likedSongs
      .filter((song) => song?.id && song.name && song.uri)
      .map((song) => ({
        id: song.id,
        title: song.name,
        subtitle: formatArtists(song.artists),
        type: 'Track',
        uri: song.uri,
      }));
  }

  if (activeNav === 'Liked Albums') {
    return likedAlbums
      .filter((album) => album?.id && album.name)
      .map((album) => ({
        id: album.id,
        title: album.name,
        subtitle: formatArtists(album.artists),
        type: 'Album',
        uri: `spotify:album:${album.id}`,
      }));
  }

  if (activeNav === 'Playlists') {
    return playlists
      .filter((playlist) => playlist?.id && playlist.name && playlist.uri)
      .map((playlist) => ({
        id: playlist.id,
        title: playlist.name,
        subtitle: playlist.owner?.display_name || 'Unknown owner',
        type: `Playlist (${playlist.tracks?.total ?? 0})`,
        uri: playlist.uri,
      }));
  }

  if (activeNav === 'Search') {
    const trackRows = asSearchItems(searchResults?.tracks)
      .filter(isUriSearchItem)
      .map((track) => ({
        id: `track-${track.id}`,
        title: track.name,
        subtitle: formatArtists(safeArtists(track.artists)),
        type: 'Track',
        uri: track.uri,
      }));

    const albumRows = asSearchItems(searchResults?.albums)
      .filter(isNamedSearchItem)
      .map((album) => ({
        id: `album-${album.id}`,
        title: album.name,
        subtitle: formatArtists(safeArtists(album.artists)),
        type: 'Album',
        uri: `spotify:album:${album.id}`,
      }));

    const playlistRows = asSearchItems(searchResults?.playlists)
      .filter(isUriSearchItem)
      .map((playlist) => {
        const owner = isRecord(playlist.owner) && typeof playlist.owner.display_name === 'string'
          ? playlist.owner.display_name
          : 'Unknown owner';
        return {
          id: `playlist-${playlist.id}`,
          title: playlist.name,
          subtitle: owner,
          type: 'Playlist',
          uri: playlist.uri,
        };
      });

    const artistRows = asSearchItems(searchResults?.artists)
      .filter(isNamedSearchItem)
      .map((artist) => ({
        id: `artist-${artist.id}`,
        title: artist.name,
        subtitle: 'Artist',
        type: 'Artist',
        uri: `spotify:artist:${artist.id}`,
      }));

    const showRows = asSearchItems(searchResults?.shows)
      .filter(isUriSearchItem)
      .map((show) => ({
        id: `show-${show.id}`,
        title: show.name,
        subtitle: typeof show.publisher === 'string' ? show.publisher : 'Podcast',
        type: 'Podcast',
        uri: show.uri,
      }));

    const audiobookRows = asSearchItems(searchResults?.audiobooks)
      .filter(isUriSearchItem)
      .map((book) => ({
        id: `audiobook-${book.id}`,
        title: book.name,
        subtitle: safeArtists(book.authors).map((author) => author.name).join(', '),
        type: 'Audiobook',
        uri: book.uri,
      }));

    return [...trackRows, ...albumRows, ...artistRows, ...playlistRows, ...showRows, ...audiobookRows];
  }

  if (activeNav === 'Queue') {
    return (queue?.queue ?? []).map((track) => ({
      id: `queue-${track.id}`,
      title: track.name,
      subtitle: formatArtists(track.artists),
      type: 'Queued Track',
      uri: track.uri,
    }));
  }

  if (activeNav === 'Recently Played') {
    return recentlyPlayed.map((item, index) => ({
      id: `recent-${item.track.id}-${index}`,
      title: item.track.name,
      subtitle: `${formatArtists(item.track.artists)} · ${new Date(item.played_at).toLocaleString()}`,
      type: 'Recent',
      uri: item.track.uri,
    }));
  }

  return [];
};
