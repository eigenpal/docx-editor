// Title-bar action button styles, shared by the demo surfaces.
//
// Lifted out of the adapter harness rather than copied beside it: two surfaces showing the
// same Open/New/Save row with two sets of literals drift the first time one is touched, and
// the drift shows up as a demo that looks subtly different depending on which URL you opened.
//
// Tokens, never literal colours — the editor chrome is themed and these sit inside it.

import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';

/** Keep the caret: chrome mousedown must never move focus out of the document. */
export function keepCaret(event: ReactMouseEvent): void {
  event.preventDefault();
}

export const DEMO_BUTTON: CSSProperties = {
  padding: '6px 12px',
  background: 'var(--doc-surface)',
  border: '1px solid var(--doc-border)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--doc-text)',
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
};

export const DEMO_SECONDARY_BUTTON: CSSProperties = {
  padding: '6px 12px',
  background: 'var(--doc-bg-subtle)',
  color: 'var(--doc-text)',
  border: '1px solid var(--doc-border)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
};

export const DEMO_PRIMARY_BUTTON: CSSProperties = {
  padding: '6px 12px',
  background: 'var(--doc-text)',
  color: 'var(--doc-on-primary)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  transition: 'background 0.15s',
  whiteSpace: 'nowrap',
};
