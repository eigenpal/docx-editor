import React from 'react';

type Adapter = 'react' | 'vue';

interface Props {
  current: Adapter;
}

const wrap: React.CSSProperties = {
  display: 'inline-flex',
  background: '#f1f5f9',
  padding: '3px',
  borderRadius: '8px',
  border: '1px solid #e2e8f0',
};

const pill: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: '12px',
  fontWeight: 500,
  color: '#64748b',
  textDecoration: 'none',
  borderRadius: '5px',
  transition: 'background 0.15s, color 0.15s',
};

const active: React.CSSProperties = {
  ...pill,
  background: '#fff',
  color: '#0f172a',
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
};

// The production build (`bun run build`) serves both demos from the same
// origin under `/react/` + `/vue/`. In dev each adapter has its own port
// (5173 React, 5174 Vue), so we hop ports for the cross-adapter link.
const isDev =
  typeof import.meta !== 'undefined' &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
const reactHref = isDev ? 'http://localhost:5173/' : '/react/';
const vueHref = isDev ? 'http://localhost:5174/' : '/vue/';

export function AdapterSwitcher({ current }: Props) {
  return (
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
  );
}
