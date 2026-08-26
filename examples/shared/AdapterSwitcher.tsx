import React from 'react';

type Adapter = 'react' | 'vue';

interface Props {
  current: Adapter;
}

// Tokenized so the switcher follows the editor's light/dark theme.
const wrap: React.CSSProperties = {
  display: 'inline-flex',
  background: 'var(--doc-bg-subtle)',
  padding: '3px',
  borderRadius: '8px',
  border: '1px solid var(--doc-border)',
};

const pill: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--doc-text-muted)',
  textDecoration: 'none',
  borderRadius: '5px',
  transition: 'background 0.15s, color 0.15s',
};

const active: React.CSSProperties = {
  ...pill,
  background: 'var(--doc-surface)',
  color: 'var(--doc-text)',
  boxShadow: '0 1px 2px var(--doc-shadow-subtle)',
};

// The header row is a flex container with its own gap, so this needs no margin.
const sourceLink: React.CSSProperties = {
  fontSize: '12px',
  whiteSpace: 'nowrap',
  color: 'var(--doc-text-muted)',
  textDecoration: 'underline',
  textUnderlineOffset: '2px',
};

// This screen IS the sample app: the switcher points at the directory that builds it,
// so a visitor comparing the two adapters can read the exact composition on screen.
const sourceUrl: Record<Adapter, string> = {
  react: 'https://github.com/eigenpal/docx-editor/tree/main/examples/vite',
  vue: 'https://github.com/eigenpal/docx-editor/tree/main/examples/vue',
};

// The production build (`bun run build`) serves both demos from the same
// origin under `/react/` + `/vue/`. In dev each adapter has its own port
// (5173 React, 5174 Vue), so we hop ports for the cross-adapter link.
const isDev =
  typeof import.meta !== 'undefined' &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
const reactHref = isDev ? 'http://localhost:5173/react/' : '/react/';
const vueHref = isDev ? 'http://localhost:5174/vue/' : '/vue/';

export function AdapterSwitcher({ current }: Props) {
  return (
    <>
      <span style={wrap} role="tablist" aria-label="Adapter">
        <a
          href={reactHref}
          role="tab"
          aria-selected={current === 'react'}
          style={current === 'react' ? active : pill}
        >
          React
        </a>
        <a
          href={vueHref}
          role="tab"
          aria-selected={current === 'vue'}
          style={current === 'vue' ? active : pill}
        >
          Vue
        </a>
      </span>
      <a
        href={sourceUrl[current]}
        target="_blank"
        rel="noreferrer"
        style={sourceLink}
        title={`Read the ${current === 'react' ? 'React' : 'Vue'} demo source on GitHub`}
      >
        (see source)
      </a>
    </>
  );
}
