/**
 * Sidebar card chrome — shared between React and Vue. Numeric
 * pixel values rather than `'8px'` strings so both adapters'
 * CSSProperties shapes accept them. Lifted from
 * `packages/react/src/components/sidebar/cardStyles.ts` and the
 * Vue mirror so there's one canonical table.
 * @packageDocumentation
 * @public
 */
import type { CSSProperties } from 'react';

export const CARD_STYLE_COLLAPSED: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  backgroundColor: 'var(--doc-card)',
  cursor: 'pointer',
  boxShadow: 'var(--doc-card-shadow)',
};

export const CARD_STYLE_EXPANDED: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  backgroundColor: 'var(--doc-surface)',
  cursor: 'pointer',
  boxShadow: 'var(--doc-card-shadow-strong)',
};
