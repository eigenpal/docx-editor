import { useEffect, useState } from 'react';
import { emptyStateMessage, type PdfStatus } from './pdf-export-state';

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Elapsed time belongs to the current phase, never a guessed completion percentage. */
export function PdfProgress({
  status,
  overlay = false,
}: {
  readonly status: PdfStatus;
  readonly overlay?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(performance.now() - started), 100);
    return () => window.clearInterval(timer);
  }, [status]);

  return (
    <div className={overlay ? 'pdf-progress-overlay' : 'pdf-export-loading'}>
      <div className="pdf-progress" role="status" aria-live="polite">
        <span className="pdf-spinner" aria-hidden="true" />
        <span>{emptyStateMessage(status, null)}</span>
        <span className="pdf-progress-time" aria-hidden="true">
          {formatDuration(elapsed)}
        </span>
      </div>
    </div>
  );
}
