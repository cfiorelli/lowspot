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
    const trackRows = (searchResults?.tracks?.items ?? []).map((track) => ({
      id: `track-${track.id}`,
      title: track.name,
      subtitle: formatArtists(track.artists),
      type: 'Track',
      uri: track.uri,
    }));

    const albumRows = (searchResults?.albums?.items ?? []).map((album) => ({
      id: `album-${album.id}`,
      title: album.name,
      subtitle: formatArtists(album.artists),
      type: 'Album',
      uri: `spotify:album:${album.id}`,
    }));

    const playlistRows = (searchResults?.playlists?.items ?? []).map((playlist) => ({
      id: `playlist-${playlist.id}`,
      title: playlist.name,
      subtitle: playlist.owner.display_name || 'Unknown owner',
      type: 'Playlist',
      uri: playlist.uri,
    }));

    const artistRows = (searchResults?.artists?.items ?? []).map((artist) => ({
      id: `artist-${artist.id}`,
      title: artist.name,
      subtitle: 'Artist',
      type: 'Artist',
      uri: `spotify:artist:${artist.id}`,
    }));

    const showRows = (searchResults?.shows?.items ?? []).map((show) => ({
      id: `show-${show.id}`,
      title: show.name,
      subtitle: show.publisher,
      type: 'Podcast',
      uri: show.uri,
    }));

    const audiobookRows = (searchResults?.audiobooks?.items ?? []).map((book) => ({
      id: `audiobook-${book.id}`,
      title: book.name,
      subtitle: book.authors.map((author) => author.name).join(', '),
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
