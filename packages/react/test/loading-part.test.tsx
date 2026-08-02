// `DocxEditor.Loading` — the conditional loading surface.
//
// What these pin down: it shows while there is no document to paint and disappears once
// there is; it reads the SAME `isLoading` the rest of the composition layer reads, so
// the loading screen and the chrome can never disagree; `when` ORs the host's own
// pre-mount async in (the fetch of bytes/fonts, which happens before `Root` can be given
// a `document` at all); host children replace the packaged spinner wholesale; and the
// server path renders it, so SSR emits a loading screen rather than a blank box.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

// React's `act` refuses to run outside an act-configured environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorLoading } from '../src/editor/DocxEditorLoading.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

const LOADING = '.docx-editor__loading';
const SPINNER = '.docx-editor__loading-spinner';

afterEach(() => {
  cleanup();
});

describe('DocxEditor.Loading', () => {
  test('is gone once the editor has a document, and the document painted', () => {
    const view = render(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorLoading>
          <span>loading…</span>
        </DocxEditorLoading>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    // The effect that creates the facade has flushed, so the surface reports loaded.
    expect(view.container.querySelector(LOADING)).toBeNull();
    expect(view.container.textContent).not.toContain('loading…');
    // And it yielded to a real painted document rather than an empty box.
    expect(view.container.textContent).toContain('hello world');
  });

  test('`when` keeps it up while the host is still fetching, independent of the editor', () => {
    // The demo case: bytes are still downloading, so `Root` has no document to be given
    // yet. The editor itself reports loaded, and only `when` holds the screen.
    const view = render(
      <DocxEditorRoot>
        <DocxEditorLoading when>
          <span>fetching bytes</span>
        </DocxEditorLoading>
      </DocxEditorRoot>
    );

    const el = view.container.querySelector(LOADING);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('fetching bytes');

    // Same tree, host async settled: the screen goes away.
    view.rerender(
      <DocxEditorRoot>
        <DocxEditorLoading when={false}>
          <span>fetching bytes</span>
        </DocxEditorLoading>
      </DocxEditorRoot>
    );
    expect(view.container.querySelector(LOADING)).toBeNull();
  });

  test('renders the packaged spinner when the host supplies no children', () => {
    const view = render(<DocxEditorLoading when />);
    const el = view.container.querySelector(LOADING)!;

    expect(el.querySelector(SPINNER)).not.toBeNull();
    // Announced as a live status, and the decorative spinner is hidden from it.
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector(SPINNER)!.getAttribute('aria-hidden')).toBe('true');
  });

  test('host children replace the spinner rather than sitting beside it', () => {
    const view = render(
      <DocxEditorLoading when>
        <span className="mine">my screen</span>
      </DocxEditorLoading>
    );
    const el = view.container.querySelector(LOADING)!;

    expect(el.querySelector('.mine')).not.toBeNull();
    expect(el.querySelector(SPINNER)).toBeNull();
  });

  test('className is appended after the load-bearing class, not instead of it', () => {
    const view = render(<DocxEditorLoading when className="demo-loading" />);
    const el = view.container.querySelector(LOADING)!;

    expect(el.className).toBe('docx-editor__loading demo-loading');
  });

  test('outside a Root it stays up: there is no editor to report otherwise', () => {
    // The documented rule for a null editor — `useEditorState` hands out the frozen
    // loading snapshot. Pinned because the demo relies on it for its pre-Root branch.
    const view = render(<DocxEditorLoading />);
    expect(view.container.querySelector(LOADING)).not.toBeNull();
  });

  test('renders on the server, so SSR emits a loading screen and not a blank box', () => {
    const html = renderToString(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorLoading>
          <span>server screen</span>
        </DocxEditorLoading>
      </DocxEditorRoot>
    );

    expect(html).toContain('docx-editor__loading');
    expect(html).toContain('server screen');
  });

  test('is reachable as a namespace static', () => {
    expect(DocxEditor.Loading).toBe(DocxEditorLoading);
  });
});
