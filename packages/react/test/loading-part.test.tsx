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
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorLoading } from '../src/editor/DocxEditorLoading.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorHorizontalRuler } from '../src/editor/DocxEditorRulers.tsx';
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

/**
 * ~`length` bytes of numbered text: zips well like real WordprocessingML while staying
 * far under the zip-bomb ratio cap the parse enforces (zero-fill would be refused).
 */
function compressibleText(length: number): Uint8Array {
  const lines: string[] = [];
  let total = 0;
  for (let line = 1; total < length; line += 1) {
    const text = `filler line ${line} carrying a little ordinary sentence text.\n`;
    lines.push(text);
    total += text.length;
  }
  return strToU8(lines.join('').slice(0, length));
}

/**
 * Past the engine's open-yield threshold by UNCOMPRESSED content while zipping small:
 * the engine mounts this one behind a painted frame, exactly as it does a long text
 * document that zips under any zipped-size threshold.
 */
const LARGE_SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="bin" ContentType="application/octet-stream"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>large body</w:t></w:r></w:p></w:body></w:document>`
  ),
  'word/media/filler.bin': compressibleText(1024 * 1024),
});

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

  test('a LARGE document holds the screen through the open yield, then yields to pages', async () => {
    // The engine mounts a document past its yield threshold behind one painted frame,
    // so a frozen page becomes a visible loading screen. `isOpening` is what this part
    // reads for that window; no condition is wired up by the host.
    const view = render(
      <DocxEditorRoot document={LARGE_SOURCE}>
        <DocxEditorLoading>
          <span>opening…</span>
        </DocxEditorLoading>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    // The store notification is deferred to a microtask; flush it.
    await act(async () => {});
    expect(view.container.querySelector(LOADING)).not.toBeNull();
    expect(view.container.textContent).not.toContain('large body');

    await waitFor(() => {
      expect(view.container.textContent).toContain('large body');
    });
    await waitFor(() => {
      expect(view.container.querySelector(LOADING)).toBeNull();
    });
  });

  test('a ruler snaps to the centred loading page before a deferred replacement', async () => {
    let editor: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={SOURCE}
        onReady={(ready) => {
          editor = ready as DocxEditorInstance;
        }}
      >
        <DocxEditorHorizontalRuler />
        <DocxEditorLoading />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await waitFor(() => expect(editor).not.toBeNull());

    act(() => {
      editor!.load(LARGE_SOURCE);
    });
    expect(editor!.snapshot().isOpening).toBe(true);
    await act(async () => {});

    expect(view.container.querySelector('.docx-ruler-frame--opening')).not.toBeNull();
    await waitFor(() => {
      expect(view.container.textContent).toContain('large body');
    });
    expect(view.container.querySelector('.docx-ruler-frame--opening')).toBeNull();
  });

  test('onReady waits for a LARGE document to mount, so it can scroll a real document', async () => {
    // The engine opens big files behind one painted frame. A host that scrolls or
    // selects from onReady must observe the mounted document, not the yield window.
    const readings: number[] = [];
    render(
      <DocxEditorRoot
        document={LARGE_SOURCE}
        onReady={(editor) => readings.push(editor.getTotalPages())}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    await act(async () => {});
    expect(readings).toHaveLength(0);

    await waitFor(() => {
      expect(readings.length).toBeGreaterThan(0);
    });
    expect(readings).toHaveLength(1);
    expect(readings[0]).toBeGreaterThan(0);
  });

  test('overlay renders the pinned variant, className still appended last', () => {
    const view = render(<DocxEditorLoading when overlay className="demo-overlay" />);
    const el = view.container.querySelector(LOADING)!;

    expect(el.className).toBe(
      'docx-editor docx-editor__loading docx-editor__loading--overlay demo-overlay'
    );
  });

  test('renders one packaged loading page when the host supplies no children', () => {
    const view = render(<DocxEditorLoading when />);
    const el = view.container.querySelector(LOADING)!;

    expect(el.querySelectorAll('.docx-editor__loading-page')).toHaveLength(1);
    expect(el.querySelector('.docx-editor__loading-lines')).toBeNull();
    expect(el.querySelector(SPINNER)).not.toBeNull();
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  test('the default screen announces loading without a visible label', () => {
    const view = render(<DocxEditorLoading when />);
    const el = view.container.querySelector(LOADING)!;
    const page = el.querySelector('.docx-editor__loading-page')!;

    expect(page.querySelector('.docx-editor-sr-only')?.textContent).toBe('Loading');
    expect(page.querySelector('.docx-editor__loading-page-status')).not.toBeNull();
    expect(el.querySelector(SPINNER)!.getAttribute('aria-hidden')).toBe('true');
  });

  test('carries its own token scope, so it is styled wherever it is composed', () => {
    // `--doc-*` lives on `.docx-editor` and `Root` renders no DOM: without this the part
    // paints an unresolved, contrast-free ring when placed beside the Viewport.
    const view = render(<DocxEditorLoading when />);
    expect(view.container.querySelector(LOADING)!.classList.contains('docx-editor')).toBe(true);
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
    expect((view.container.querySelector(LOADING) as HTMLElement).style.minHeight).toBe('240px');
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

    expect(el.className).toBe('docx-editor docx-editor__loading demo-loading');
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

describe('packaged DocxEditor loading screen', () => {
  test('mounts the default loading page while no document is available', () => {
    const view = render(<DocxEditor />);
    const loading = view.container.querySelector('.docx-editor__loading--overlay');

    expect(loading).not.toBeNull();
    expect(loading!.querySelectorAll('.docx-editor__loading-page')).toHaveLength(1);
    expect(
      (view.container.querySelector('[data-testid="docx-toolbar"]') as HTMLFieldSetElement).disabled
    ).toBe(true);
    expect(
      (view.container.querySelector('[data-testid="editing-mode-trigger"]') as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  test('keeps the default loading page up while a large document opens', async () => {
    const view = render(<DocxEditor document={LARGE_SOURCE} />);

    await act(async () => {});
    expect(view.container.querySelector('.docx-editor__loading-page')).not.toBeNull();
    expect(view.container.textContent).not.toContain('large body');

    await waitFor(() => {
      expect(view.container.textContent).toContain('large body');
    });
    expect(view.container.querySelector('.docx-editor__loading')).toBeNull();
    expect(
      (view.container.querySelector('[data-testid="docx-toolbar"]') as HTMLFieldSetElement).disabled
    ).toBe(false);
  });
});
