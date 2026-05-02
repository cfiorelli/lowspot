import type { SearchResponse, SpotifyAlbum, SpotifyPlaylist, SpotifyTrack } from '../spotify/types';
import type { PlaybackState, QueueResponse, RecentlyPlayedItem } from '../spotify/types';
import type { NavItem } from '../utils/constants';
import { NAV_ITEMS } from '../utils/constants';
import { buildRowsForNav } from './rows';
import { formatArtists, formatDuration } from '../utils/format';

interface ExpandedViewProps {
  activeNav: NavItem;
  selectedRow: number;
  likedSongs: SpotifyTrack[];
  likedAlbums: SpotifyAlbum[];
  playlists: SpotifyPlaylist[];
  searchResults: SearchResponse | null;
  queue: QueueResponse | null;
  recentlyPlayed: RecentlyPlayedItem[];
  playback: PlaybackState | null;
  controlsDisabled: boolean;
  playbackSettingsDisabled: boolean;
  shuffleState: boolean;
  repeatState: 'off' | 'track' | 'context';
  shufflePending: boolean;
  repeatPending: boolean;
  sdkMessage: string;
  sdkConnecting: boolean;
  sdkDeviceId: string | null;
  sectionLoading: boolean;
  sectionMessage: string;
  cooldownSummary: string;
  onNavSelect: (nav: NavItem) => void;
  onCollapse: () => void;
  onSearch: (query: string) => void;
  onRowSelect: (index: number) => void;
  onPlayTrack: (trackUri: string) => void;
  onPlayContext: (contextUri: string) => void;
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onSetVolume: (volumePercent: number) => void;
  onConnectPlaybackSdk: () => void;
  onLogout: () => void;
}

export function ExpandedView({
  activeNav,
  selectedRow,
  likedSongs,
  likedAlbums,
  playlists,
  searchResults,
  queue,
  recentlyPlayed,
  playback,
  controlsDisabled,
  playbackSettingsDisabled,
  shuffleState,
  repeatState,
  shufflePending,
  repeatPending,
  sdkMessage,
  sdkConnecting,
  sdkDeviceId,
  sectionLoading,
  sectionMessage,
  cooldownSummary,
  onNavSelect,
  onCollapse,
  onSearch,
  onRowSelect,
  onPlayTrack,
  onPlayContext,
  onPrevious,
  onPlayPause,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
  onSetVolume,
  onConnectPlaybackSdk,
  onLogout,
}: ExpandedViewProps) {
  const rows = buildRowsForNav(activeNav, likedSongs, likedAlbums, playlists, searchResults, queue, recentlyPlayed, playback);
  const progressPercent =
    playback?.item && playback.item.duration_ms > 0
      ? Math.min(100, (playback.progress_ms / playback.item.duration_ms) * 100)
      : 0;

  return (
    <section className="expanded-view">
      <aside className="sidebar">
        <header>
          <h2>lowspot</h2>
          <button type="button" onClick={onCollapse}>
            Collapse
          </button>
        </header>
        <nav>
          {NAV_ITEMS.map((item) => (
            <button
              key={item}
              type="button"
              className={item === activeNav ? 'active' : ''}
              onClick={() => onNavSelect(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <p className="sdk-message">{sdkMessage}</p>
        <button type="button" className="logout" onClick={onLogout}>
          Logout
        </button>
      </aside>

      <main className="content">
        <header className="content-header">
          <div className="content-title-group">
            <button type="button" className="collapse-inline" onClick={onCollapse}>
              Collapse
            </button>
            <h3>{activeNav}</h3>
          </div>
          <div className="playback-controls">
            <button type="button" className="transport-button" onClick={onPrevious} disabled={controlsDisabled} aria-label="Previous">
              {'<<'}
            </button>
            <button type="button" className="play-toggle" onClick={onPlayPause} disabled={controlsDisabled && rows.length === 0} aria-label="Play or pause">
              {playback?.is_playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="transport-button" onClick={onNext} disabled={controlsDisabled} aria-label="Next">
              {'>>'}
            </button>
            <button
              type="button"
              className={`shuffle-toggle ${shuffleState ? 'toggle-active' : ''}`}
              aria-pressed={shuffleState}
              aria-label="Toggle shuffle"
              disabled={playbackSettingsDisabled || shufflePending}
              onClick={onToggleShuffle}
            >
              {shufflePending ? 'Shuffle…' : `Shuffle ${shuffleState ? 'On' : 'Off'}`}
            </button>
            <button
              type="button"
              className={`repeat-toggle ${repeatState !== 'off' ? 'toggle-active' : ''}`}
              aria-pressed={repeatState !== 'off'}
              aria-label="Cycle repeat"
              disabled={playbackSettingsDisabled || repeatPending}
              onClick={onCycleRepeat}
            >
              {repeatPending ? 'Repeat…' : `Repeat ${repeatState}`}
            </button>
            <label>
              Vol
              <input
                type="range"
                min={0}
                max={100}
                defaultValue={playback?.device?.volume_percent ?? 50}
                disabled={playbackSettingsDisabled}
                onMouseUp={(event) => {
                  const target = event.target as HTMLInputElement;
                  onSetVolume(Number(target.value));
                }}
              />
            </label>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const input = form.elements.namedItem('search') as HTMLInputElement | null;
              if (!input) return;
              onSearch(input.value);
            }}
          >
            <input id="global-search" name="search" type="search" placeholder="Search tracks, albums, playlists" />
            <button type="submit">Search</button>
          </form>
        </header>

        <section className="table">
          <div className="expanded-now-playing" aria-live="polite">
            {playback?.item ? (
              <>
                <p className="track">{playback.item.name}</p>
                <p className="meta">{formatArtists(playback.item.artists)}</p>
                <div className="progress-row">
                  <span>{formatDuration(playback.progress_ms)}</span>
                  <div className="progress-line-track" aria-label="Current track progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)}>
                    <div className="progress-line-fill" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <span>{formatDuration(playback.item.duration_ms)}</span>
                </div>
              </>
            ) : (
              <p className="meta">No active track.</p>
            )}
          </div>
          {activeNav === 'Settings' ? (
            <div className="settings-note">
              <p>Set these env values locally and allowlist both Spotify callbacks:</p>
              <p className="mono">VITE_SPOTIFY_CLIENT_ID=</p>
              <p className="mono">VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback</p>
              <p className="mono">http://127.0.0.1:7878/callback</p>
              <p>Spotify cooldown:</p>
              <p className="mono">{cooldownSummary || 'No active app-recorded cooldown.'}</p>
              <p>Local playback device:</p>
              <p className="mono">{sdkDeviceId ? `Connected: ${sdkDeviceId}` : sdkMessage}</p>
              <button type="button" onClick={onConnectPlaybackSdk} disabled={sdkConnecting}>
                {sdkConnecting ? 'Connecting...' : 'Connect Local Device'}
              </button>
            </div>
          ) : null}
          <div className="table-head">
            <span>Title</span>
            <span>Meta</span>
            <span>Type</span>
          </div>
          <div className="table-body">
            {rows.length === 0 ? (
              <p className="empty">{sectionLoading ? 'Loading this section...' : sectionMessage || 'No items for this section yet.'}</p>
            ) : null}
            {rows.map((row, index) => (
              <button
                key={row.id}
                type="button"
                className={`row ${index === selectedRow ? 'selected' : ''}`}
                onClick={() => {
                  const canPlay = row.type === 'Track' || row.type === 'Album' || row.type === 'Playlist' || row.type === 'Artist';
                  if (activeNav === 'Search' && row.uri && canPlay) {
                    if (row.type === 'Track') {
                      onPlayTrack(row.uri);
                    } else {
                      onPlayContext(row.uri);
                    }
                    return;
                  }
                  onRowSelect(index);
                }}
                onDoubleClick={() => {
                  const canPlay = row.type === 'Track' || row.type === 'Album' || row.type === 'Playlist' || row.type === 'Artist';
                  if (!row.uri || !canPlay) return;
                  if (row.type === 'Track') {
                    onPlayTrack(row.uri);
                  } else {
                    onPlayContext(row.uri);
                  }
                }}
              >
                <span>{row.title}</span>
                <span>{row.subtitle}</span>
                <span>{row.type}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </section>
  );
}
