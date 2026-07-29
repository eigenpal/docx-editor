// Authoritative machine-readable production package topology (document-engine
// task 1.4). The import-graph test enforces every rule here; the prose mirror of
// this data lives in docs/architecture/production-engine-packages.md.
//
// `internalDeps` is the allowed DAG: the set of sibling @docx-editor.dev/engine-*
// packages a package may import. Anything outside the set is a layering violation.
//
// `forbidden` is a list of import-specifier regex sources a package MUST NOT
// import. Engine-core carries the load-bearing PM/DOM/Yjs/transport/PDF-free
// guarantees named by the task; peripheral packages only forbid sideways/upward
// layering (enforced separately via internalDeps).

export interface PackageRule {
  /** Directory under packages/. */
  readonly dir: string;
  /** npm name. */
  readonly name: string;
  /** Sibling engine packages this package is allowed to import (the DAG). */
  readonly internalDeps: readonly string[];
  /** Whether this package's tsconfig may include the DOM lib. */
  readonly domAllowed: boolean;
  /** Import-specifier regex sources this package MUST NOT import. */
  readonly forbidden: readonly string[];
}

// PM-free, Yjs-free, transport-neutral, PDF-free specifier patterns. DOM-free is
// additionally proven structurally by engine-core's tsconfig omitting the DOM lib.
const PROSEMIRROR = String.raw`^prosemirror(-[a-z-]+)?$`;
const YJS = String.raw`^(yjs(/.*)?|y-[a-z0-9-]+(/.*)?|@y/.*)$`;
const PDF = String.raw`^(pdf-lib|pdfkit|pdfjs-dist|@react-pdf/.*)$`;
const TRANSPORT = String.raw`^(ws|socket\.io.*|undici|node-fetch|axios|(node:)?(http|https|http2|net|tls|dgram|dns))$`;
const DOM_LIB = String.raw`^(jsdom|linkedom|happy-dom)$`;

const CORE_FORBIDDEN = [PROSEMIRROR, YJS, PDF, TRANSPORT, DOM_LIB];

export const CORE = '@docx-editor.dev/engine-core';
export const BINDING = '@docx-editor.dev/engine-binding';
export const SYNC = '@docx-editor.dev/engine-sync';
export const LAYOUT = '@docx-editor.dev/engine-layout';
export const OUTPUT = '@docx-editor.dev/engine-output';
export const SERVER = '@docx-editor.dev/engine-server';
export const CLIENTS = '@docx-editor.dev/engine-clients';
export const EDITOR = '@docx-editor.dev/engine-editor';

export const PACKAGE_RULES: readonly PackageRule[] = [
  {
    dir: 'engine-core',
    name: CORE,
    internalDeps: [],
    domAllowed: false,
    forbidden: CORE_FORBIDDEN,
  },
  {
    dir: 'engine-binding',
    name: BINDING,
    internalDeps: [CORE],
    domAllowed: true,
    // Binding owns PM; it must not reach into sync/layout/output/server.
    forbidden: [YJS, PDF],
  },
  {
    dir: 'engine-sync',
    name: SYNC,
    internalDeps: [CORE],
    domAllowed: false,
    forbidden: [PROSEMIRROR, PDF, DOM_LIB],
  },
  {
    dir: 'engine-layout',
    name: LAYOUT,
    internalDeps: [CORE],
    domAllowed: false,
    // Layout emits the DisplayItem[] IR; it neither paints nor writes PDF.
    forbidden: [PROSEMIRROR, YJS, PDF, DOM_LIB],
  },
  {
    dir: 'engine-output',
    name: OUTPUT,
    internalDeps: [CORE, LAYOUT],
    domAllowed: true,
    forbidden: [PROSEMIRROR, YJS],
  },
  {
    dir: 'engine-server',
    name: SERVER,
    internalDeps: [CORE, SYNC, LAYOUT, OUTPUT],
    domAllowed: false,
    forbidden: [PROSEMIRROR],
  },
  {
    dir: 'engine-clients',
    name: CLIENTS,
    internalDeps: [CORE],
    domAllowed: false,
    forbidden: [PROSEMIRROR, YJS, PDF, TRANSPORT, DOM_LIB],
  },
  {
    dir: 'engine-editor',
    name: EDITOR,
    // The browser editor composition root: it may compose binding (PM-free surface), layout, and
    // output. It is the ONLY package above the binding/layout/output trio.
    internalDeps: [CORE, BINDING, LAYOUT, OUTPUT],
    domAllowed: true,
    // The facade is PM-FREE: it composes engine-binding's PM-free mount, never importing PM
    // directly. It also does not touch Yjs, transport, or pdf-lib directly (output owns PDF).
    forbidden: [PROSEMIRROR, YJS, PDF, TRANSPORT],
  },
];

export const ALL_ENGINE_NAMES = PACKAGE_RULES.map((p) => p.name);

/** Every production package forbids importing disposable spike modules (ADR-S9). */
export const SPIKE_IMPORT = String.raw`(^|/)spike(/|$)|packages/core/spike`;
