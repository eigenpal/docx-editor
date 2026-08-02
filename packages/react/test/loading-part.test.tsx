// `DocxEditor.Loading` — the conditional loading surface.
//
// What these pin down: it shows while the editor has no document and disappears as soon
// as bytes are handed over; it is SAFE TO GATE A MOUNT POINT ON, which is why the
// condition is document presence rather than painted pages (the latter deadlocks, and
// flickers back on when a viewport unmounts); a parse failure ends it rather than
// spinning forever; `when` ORs the host's own pre-mount async in; host children replace
// the packaged screen while `Loading.Spinner` composes it back; the default screen has
// an announceable name; and the server path renders it, so SSR emits a loading screen
// rather than a blank box.

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
import { useEditorState } from '../src/editor/useEditorState.ts';

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

  test('with NO condition wired up, a Root still awaiting its document keeps it up', () => {
    // The point of the default. The facade exists but was handed no bytes, which is the
    // shape a host has while its fetch is in flight — a bare `<DocxEditor.Loading/>` has
    // to cover it, or every host would be forced to hand-wire `when`.
    const view = render(
      <DocxEditorRoot>
        <DocxEditorLoading>
          <span>no document yet</span>
        </DocxEditorLoading>
      </DocxEditorRoot>
    );

    const el = view.container.querySelector(LOADING);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('no document yet');
  });

  test('the same bare part yields as soon as a document is handed over', () => {
    const view = render(
      <DocxEditorRoot>
        <DocxEditorLoading>
          <span>no document yet</span>
        </DocxEditorLoading>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(view.container.querySelector(LOADING)).not.toBeNull();

    // Document identity lands: Root rebuilds the facade, pages paint, screen retires.
    view.rerender(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorLoading>
          <span>no document yet</span>
        </DocxEditorLoading>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(view.container.querySelector(LOADING)).toBeNull();
    expect(view.container.textContent).toContain('hello world');
  });

  test('gating the mount point on it resolves instead of deadlocking', () => {
    // The trap this part must not set. A host that reads the loading state to decide
    // whether to render `Content` is the natural composition — and if the condition were
    // keyed on painted pages it could never clear, because nothing paints until Content
    // mounts and Content would never mount. Document presence is what makes it safe.
    function Gated() {
      const loading = useEditorState((snapshot) => snapshot.isLoading);
      return loading ? (
        <DocxEditorLoading>
          <span>waiting</span>
        </DocxEditorLoading>
      ) : (
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      );
    }

    const view = render(
      <DocxEditorRoot document={SOURCE}>
        <Gated />
      </DocxEditorRoot>
    );

    expect(view.container.querySelector(LOADING)).toBeNull();
    expect(view.container.textContent).toContain('hello world');
    expect(view.container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
  });

  test('unmounting the viewport does not bring the screen back over a loaded document', () => {
    // `detach()` stashes the live bytes, so the document is still there — only the mount
    // point went away. A condition keyed on page count would flip back here.
    const view = render(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorLoading>
          <span>waiting</span>
        </DocxEditorLoading>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(view.container.querySelector(LOADING)).toBeNull();

    view.rerender(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorLoading>
          <span>waiting</span>
        </DocxEditorLoading>
      </DocxEditorRoot>
    );
    expect(view.container.querySelector(LOADING)).toBeNull();
  });

  test('`when` ORs in host async the editor cannot observe, and releases with it', () => {
    // A host that mounts the provider only after its own fetch settles: the editor has
    // a document and reports painted, so only `when` can hold the screen.
    const view = render(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorLoading when>
          <span>fetching fonts</span>
        </DocxEditorLoading>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    const el = view.container.querySelector(LOADING);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('fetching fonts');

    view.rerender(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorLoading when={false}>
          <span>fetching fonts</span>
        </DocxEditorLoading>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(view.container.querySelector(LOADING)).toBeNull();
  });

  test('a document that cannot be parsed ends the loading state rather than spinning forever', () => {
    // Nothing paints, but nothing is arriving either. A permanent spinner would be the
    // worst of the three outcomes, so the part retires and lets the host report.
    const view = render(
      <DocxEditorRoot document={new Uint8Array([1, 2, 3, 4])}>
        <DocxEditorLoading>
          <span>still loading</span>
        </DocxEditorLoading>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
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

  test('the default screen has something to announce, not an empty live region', () => {
    // The spinner is aria-hidden, so without a text node `role="status"` would announce
    // "" — worse than having no live region at all.
    const view = render(<DocxEditorLoading when />);
    const el = view.container.querySelector(LOADING)!;

    expect(el.textContent!.trim().length).toBeGreaterThan(0);
    expect(el.querySelector('.ep-sr-only')).not.toBeNull();
  });

  test('carries its own token scope, so it is styled wherever it is composed', () => {
    // `--doc-*` lives on `.ep-root` and `Root` renders no DOM: without this the part
    // paints an unresolved, contrast-free ring when placed beside the Viewport.
    const view = render(<DocxEditorLoading when />);
    expect(view.container.querySelector(LOADING)!.classList.contains('ep-root')).toBe(true);
  });

  test('Loading.Spinner composes the packaged indicator into custom children', () => {
    const view = render(
      <DocxEditorLoading when>
        <DocxEditorLoading.Spinner />
        <span>my label</span>
      </DocxEditorLoading>
    );
    const el = view.container.querySelector(LOADING)!;

    expect(el.querySelector(SPINNER)).not.toBeNull();
    expect(el.textContent).toContain('my label');
  });

  test('accepts style, as the other container-shaped parts do', () => {
    const view = render(<DocxEditorLoading when style={{ minHeight: '240px' }} />);
    expect(
      (view.container.querySelector(LOADING) as HTMLElement).style.minHeight
    ).toBe('240px');
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

    expect(el.className).toBe('ep-root docx-editor__loading demo-loading');
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
