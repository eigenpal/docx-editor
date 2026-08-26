import React from 'react';

type Adapter = 'react' | 'vue';

interface Props {
  current: Adapter;
}

// This screen IS the sample app, so the link points at the directory that builds it and a
// visitor can read the exact composition they are looking at. It renders unconditionally:
// it says nothing about the other adapter, so it does not belong behind the
// framework-switcher flag.
const sourceUrl: Record<Adapter, string> = {
  react: 'https://github.com/eigenpal/docx-editor/tree/main/examples/vite',
  vue: 'https://github.com/eigenpal/docx-editor/tree/main/examples/vue',
};

const label: Record<Adapter, string> = { react: 'React', vue: 'Vue' };

// The header row is a flex container with its own gap, so this needs no margin.
const style: React.CSSProperties = {
  fontSize: '12px',
  whiteSpace: 'nowrap',
  color: 'var(--doc-text-muted)',
  textDecoration: 'underline',
  textUnderlineOffset: '2px',
};

export function SourceLink({ current }: Props) {
  return (
    <a
      href={sourceUrl[current]}
      target="_blank"
      rel="noreferrer"
      style={style}
      title={`Read the ${label[current]} demo source on GitHub`}
    >
      (see source)
    </a>
  );
}
