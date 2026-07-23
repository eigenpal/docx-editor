// React read-only DOCX preview (queue item 2). A THIN wrapper over the shared,
// framework-agnostic renderDocxPreview — it holds no layout/paint logic of its own, so
// it stays in lockstep with the Vue counterpart. Read-only: editing/saving unsupported.
import React, { useRef, useEffect, useState } from 'react';
import { renderDocxPreview, type PreviewResult, type PreviewOptions } from './enginePreview';

export interface EnginePreviewProps {
  /** URL of a .docx fixture to fetch and render. */
  readonly fixtureUrl: string;
  readonly options?: PreviewOptions;
}

export function EnginePreview({ fixtureUrl, options }: EnginePreviewProps): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    void (async () => {
      try {
        const res = await fetch(fixtureUrl);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (cancelled || !host.current) return;
        setResult(renderDocxPreview(bytes, host.current, options));
      } catch (e) {
        if (!cancelled) setResult({ ok: false, pageCount: 0, error: (e as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, [fixtureUrl, options]);

  return (
    <div className="engine-preview">
      <div className="engine-preview__status" style={{ padding: '8px 12px', font: '13px system-ui, sans-serif', color: '#555' }}>
        Read-only preview (production engine) — editing and saving are not supported.
        {result?.ok ? ` ${result.pageCount} page(s).` : result ? ` Could not open this file (${result.error}).` : ' Loading…'}
      </div>
      <div ref={host} data-testid="engine-preview" />
    </div>
  );
}
