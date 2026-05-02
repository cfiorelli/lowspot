import type { PlaybackState } from '../spotify/types';
import { formatArtists, formatDuration } from '../utils/format';

interface LeanBarProps {
  playback: PlaybackState | null;
  currentTrackLiked: boolean;
  controlsDisabled: boolean;
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onToggleLike: () => void;
  onExpand: () => void;
  onSearchSubmit: (query: string) => void;
}

export function LeanBar({
  playback,
  currentTrackLiked,
  controlsDisabled,
  onPrevious,
  onPlayPause,
  onNext,
  onToggleLike,
  onExpand,
  onSearchSubmit,
}: LeanBarProps) {
  const progressPercent =
    playback?.item && playback.item.duration_ms > 0
      ? Math.min(100, (playback.progress_ms / playback.item.duration_ms) * 100)
      : 0;

  return (
    <section className="lean-bar">
      <div className="transport">
        <p className="lean-wordmark" aria-hidden="true">
          lowspot
        </p>
        <button type="button" className="expand-button" onClick={onExpand} aria-label="Expand view">
          Expand
        </button>
        <button type="button" className="transport-button" onClick={onPrevious} aria-label="Previous" disabled={controlsDisabled}>
          {'<<'}
        </button>
        <button type="button" className="play-toggle" onClick={onPlayPause} aria-label="Play or pause" disabled={controlsDisabled}>
          {playback?.is_playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="transport-button" onClick={onNext} aria-label="Next" disabled={controlsDisabled}>
          {'>>'}
        </button>
        <button type="button" className="like-toggle" onClick={onToggleLike} aria-label="Like current track" disabled={controlsDisabled}>
          {currentTrackLiked ? 'Unlike' : 'Like'}
        </button>
      </div>

      <div className="now-playing">
        {playback?.item ? (
          <>
            <p className="track">{playback.item.name}</p>
            <p className="artist">{formatArtists(playback.item.artists)}</p>
            <p className="meta">
              {formatDuration(playback.progress_ms)} / {formatDuration(playback.item.duration_ms)}
            </p>
          </>
        ) : (
          <p className="artist">Ready. Search or expand to choose music.</p>
        )}
      </div>

      <form
        className="quick-search"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const input = form.elements.namedItem('query') as HTMLInputElement | null;
          if (!input) return;
          const q = input.value.trim();
          if (!q) return;
          onSearchSubmit(q);
          input.value = '';
        }}
      >
        <input name="query" type="search" placeholder="Search" aria-label="Search Spotify" />
        <button type="submit">Go</button>
      </form>

      <div className="progress-line" style={{ width: `${progressPercent}%` }} />
    </section>
  );
}
