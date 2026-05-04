interface PlaybackControlSwitchProps {
  active: boolean;
  pending: boolean;
  onToggle: () => void;
}

export function PlaybackControlSwitch({
  active,
  pending,
  onToggle,
}: PlaybackControlSwitchProps) {
  return (
    <button
      type="button"
      className={`control-switch ${active ? 'active' : ''}`}
      onClick={onToggle}
      disabled={pending}
      aria-pressed={active}
      aria-label={active ? 'Stop lowspot playback control' : 'Let lowspot control playback'}
    >
      <span className="control-switch-labels" aria-hidden="true">
        <span>off</span>
        <span>on</span>
      </span>
      <span className="control-switch-track" aria-hidden="true">
        <span className="control-switch-wordmark">lowspot</span>
      </span>
    </button>
  );
}
