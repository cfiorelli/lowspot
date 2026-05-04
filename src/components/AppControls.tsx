import { PlaybackControlSwitch } from './PlaybackControlSwitch';

interface AppControlsProps {
  modeActionLabel: 'Expand' | 'Collapse';
  playbackControlActive: boolean;
  playbackControlPending: boolean;
  onModeAction: () => void;
  onTakePlaybackControl: () => void;
  onReleasePlaybackControl: () => void;
  onLogout: () => void;
}

export function AppControls({
  modeActionLabel,
  playbackControlActive,
  playbackControlPending,
  onModeAction,
  onTakePlaybackControl,
  onReleasePlaybackControl,
  onLogout,
}: AppControlsProps) {
  return (
    <div className="app-controls">
      <button type="button" className="mode-button" onClick={onModeAction}>
        {modeActionLabel}
      </button>
      <PlaybackControlSwitch
        active={playbackControlActive}
        pending={playbackControlPending}
        onToggle={playbackControlActive ? onReleasePlaybackControl : onTakePlaybackControl}
      />
      <button type="button" className="logout-button" onClick={onLogout}>
        Logout
      </button>
    </div>
  );
}
