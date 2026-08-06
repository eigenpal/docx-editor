// PLAYWRIGHT HARNESS for the canonical tree stack. NOT a demo surface.
//
// Exists only so `e2e/browser-first-tree.smoke.spec.ts` can drive the tree binding directly:
// it loads a fixture through `openTreeSession` (bounded OPC read into typed/generic trees,
// `TreeDocumentStore`, the tree binding) and mounts the minimal editable surface over it.
// Nothing here touches `PackageModel`, `openDocxSession`, or the byte-range preservation
// snapshot — that isolation is the point.
//
// Deliberately unstyled beyond a page-like sheet. It makes no pagination or layout claim.

import { useEffect, useRef, useState } from 'react';
import {
  mountTreeSurface,
  openTreeSession,
  type TreeDocxSession,
  type TreeSurface,
  type TreeSurfaceState,
} from '@docx-editor.dev/core/binding';

declare global {
  interface Window {
    /** Exposed so a browser check can read canonical state, not just the DOM. */
    __docxTreeSession?: TreeDocxSession;
    __docxTreeSurface?: TreeSurface;
  }
}

export function TreeSurfaceHarness({ fixtureUrl }: { fixtureUrl: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [state, setState] = useState<TreeSurfaceState | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);

  useEffect(() => {
    let surface: TreeSurface | null = null;
    let cancelled = false;

    void (async () => {
      const response = await fetch(fixtureUrl);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (cancelled) return;

      const opened = openTreeSession(bytes);
      if (!opened.ok) {
        setStatus(`Rejected: ${opened.reason}${opened.detail ? ` (${opened.detail})` : ''}`);
        return;
      }
      const session = opened.session;
      window.__docxTreeSession = session;
      setStatus(
        session.editable
          ? `Editable — ${session.paragraphIds().length} paragraphs (canonical tree)`
          : 'Read-only: the body has no paragraphs'
      );

      const mount = mountRef.current;
      if (!mount) return;
      surface = mountTreeSurface(mount, session, { onChange: setState });
      window.__docxTreeSurface = surface;
      setState(surface.state());
    })();

    return () => {
      cancelled = true;
      surface?.destroy();
      delete window.__docxTreeSession;
      delete window.__docxTreeSurface;
    };
  }, [fixtureUrl]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid var(--doc-border)',
          fontSize: 13,
          flexWrap: 'wrap',
        }}
      >
        <strong data-testid="tree-status">{status}</strong>
        <span data-testid="tree-revision">rev {state?.revision ?? 0}</span>
        <button type="button" onClick={() => window.__docxTreeSurface?.undo()}>
          Undo
        </button>
        <button type="button" onClick={() => window.__docxTreeSurface?.redo()}>
          Redo
        </button>
        <button type="button" onClick={() => window.__docxTreeSurface?.toggleRunProperty('b')}>
          Bold
        </button>
        <button
          type="button"
          onClick={() => window.__docxTreeSurface?.toggleRunProperty('u', { val: 'single' })}
        >
          Underline
        </button>
        <button
          type="button"
          onClick={() => {
            const current = window.__docxTreeSession;
            if (!current) return;
            const reopened = openTreeSession(current.save());
            setSavedText(
              reopened.ok ? reopened.session.bodyText() : `save failed: ${reopened.reason}`
            );
          }}
        >
          Save + reopen
        </button>
        {state?.lastRejection ? (
          <span data-testid="tree-rejection" style={{ color: 'var(--doc-danger, #b00)' }}>
            refused: {state.lastRejection}
          </span>
        ) : null}
      </div>

      <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <div
          className="ep-browser-first__page"
          style={{ background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }}
        >
          <div ref={mountRef} className="ep-browser-first__mount" data-testid="tree-mount" />
        </div>
      </div>

      {savedText !== null ? (
        <pre
          data-testid="tree-saved-text"
          style={{ margin: 16, padding: 12, background: 'var(--doc-bg-subtle)', fontSize: 12 }}
        >
          {savedText}
        </pre>
      ) : null}
    </div>
  );
}
