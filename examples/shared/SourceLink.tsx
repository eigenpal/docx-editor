import React from 'react';
import { sourceUrlFor, type ExampleName } from './config';

interface Props {
  /** Which example this screen IS, by its `config.ts` name — not which adapter it uses.
   *  Several examples here render React, so the adapter would not identify the tree. */
  example: ExampleName;
}

// The header row is a flex container with its own gap, so this needs no margin.
const style: React.CSSProperties = {
  fontSize: '12px',
  whiteSpace: 'nowrap',
  color: 'var(--doc-text-muted)',
  textDecoration: 'underline',
  textUnderlineOffset: '2px',
};

// This screen IS the sample app, so the link points at the directory that builds it and a
// visitor can read the exact composition they are looking at. It renders unconditionally:
// it says nothing about any other example, so it does not belong behind the
// framework-switcher flag.
export function SourceLink({ example }: Props) {
  return (
    <a
      href={sourceUrlFor(example)}
      target="_blank"
      rel="noreferrer"
      style={style}
      title={`Read the ${example} example source on GitHub`}
    >
      (see source)
    </a>
  );
}
