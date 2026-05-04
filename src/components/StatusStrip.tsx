import { useLayoutEffect, useRef } from 'react';
import type { StatusLogEntry } from '../state/store';

interface StatusStripProps {
  statusLog: StatusLogEntry[];
}

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function StatusStrip({ statusLog }: StatusStripProps) {
  const logRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [statusLog]);

  return (
    <div className="status-strip">
      <div className="status-log" ref={logRef} aria-label="Status message log" role="log" aria-live="polite">
        {statusLog.map((entry) => (
          <div key={entry.id} className={`status-log-line ${entry.level}`}>
            <span>{formatTime(entry.timestamp)}</span>
            <span>{entry.level}</span>
            <span>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
