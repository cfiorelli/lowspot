import { useLayoutEffect, useRef } from 'react';
import type { StatusLogEntry } from '../state/store';

interface StatusStripProps {
  errorMessage: string;
  infoMessage: string;
  statusLog: StatusLogEntry[];
  onClearLog: () => void;
}

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function StatusStrip({ errorMessage, infoMessage, statusLog, onClearLog }: StatusStripProps) {
  const logRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [statusLog]);

  return (
    <div className="status-strip" role="status" aria-live="polite">
      <div className="status-current">
        <p className={errorMessage ? 'error' : 'info'}>
          {errorMessage || infoMessage || 'Ready.'}
        </p>
        {statusLog.length > 0 ? (
          <button type="button" className="clear-log" onClick={onClearLog}>
            Clear
          </button>
        ) : null}
      </div>
      {statusLog.length > 0 ? (
        <div className="status-log" ref={logRef} aria-label="Status message log">
          {statusLog.map((entry) => (
            <div key={entry.id} className={`status-log-line ${entry.level}`}>
              <span>{formatTime(entry.timestamp)}</span>
              <span>{entry.level}</span>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
