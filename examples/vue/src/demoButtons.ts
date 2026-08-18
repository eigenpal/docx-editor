import type { CSSProperties } from 'vue';

/** Keep the caret: chrome mousedown must never move focus out of the document. */
export function keepCaret(event: MouseEvent): void {
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
