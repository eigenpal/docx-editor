// DocxEditor.HyperLink against the REAL engine.
//
// The popover is chrome over an engine that already decides everything that matters: which
// gestures mean "show the link UI", what a safe target is, and what a link edit does to the
// document. These tests drive it the way a user does — click a link, press Ctrl/Cmd+K, type
// a URL — and check the document, not the markup.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorHyperLink } from '../src/editor/DocxEditorHyperLink.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string, rels = ''): Uint8Array {
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
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}">${rels}</Relationships>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const EXTERNAL_REL = `<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/>`;
const LINKED = docx(
  `<w:p><w:r><w:t>Visit </w:t></w:r>` +
    `<w:hyperlink r:id="rId9"><w:r><w:t>Example</w:t></w:r></w:hyperlink>` +
    `<w:r><w:t> today</w:t></w:r></w:p>`,
  EXTERNAL_REL
);
const PLAIN = docx('<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>');
const PID = '/word/document.xml#0.0.0';

interface Mounted {
  readonly view: ReturnType<typeof render>;
  editor(): DocxEditorInstance;
}

function mount(source: Uint8Array, children?: React.ReactNode): Mounted {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorToolbar />
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorHyperLink>{children}</DocxEditorHyperLink>
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function caret(mounted: Mounted, offset: number): void {
  act(() => {
    mounted.editor().surface!.setSelection({
      anchor: { paragraphId: PID, offset },
      head: { paragraphId: PID, offset },
    });
  });
}

function select(mounted: Mounted, start: number, end: number): void {
  act(() => {
    mounted.editor().surface!.setSelection({
      anchor: { paragraphId: PID, offset: start },
      head: { paragraphId: PID, offset: end },
    });
  });
}

/** Click the painted anchor whose text is `text`. */
function clickLink(mounted: Mounted, text: string): void {
  const anchors = [...mounted.view.container.querySelectorAll('a.docx-hyperlink')];
  const anchor = anchors.find((element) => element.textContent === text);
  if (!anchor) throw new Error(`no painted link ${JSON.stringify(text)}`);
  act(() => {
    fireEvent.click(anchor);
  });
}

/** Press Ctrl/Cmd+K on the pages layer, the way the surface receives it. */
function pressCommandK(mounted: Mounted): void {
  const pages = mounted.view.container.querySelector('.docx-pages');
  if (!pages) throw new Error('no pages layer');
  act(() => {
    fireEvent.keyDown(pages, { key: 'k', metaKey: true });
  });
}

const bodyText = (mounted: Mounted): string => mounted.editor().surface!.session.bodyText();

afterEach(() => {
  cleanup();
});

describe('DocxEditor.HyperLink', () => {
  test('is not rendered until a gesture opens it', () => {
    const mounted = mount(LINKED);
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });

  test('a click on a link opens the popover showing the target', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    const panel = mounted.view.getByTestId('hyperlink-popup');
    expect(panel.dataset.mode).toBe('reading');
    expect(mounted.view.getByTestId('hyperlink-popup-url').textContent).toContain(
      'https://example.com'
    );
    // The Google-Docs three: copy, edit, unlink.
    expect(mounted.view.getByTestId('hyperlink-popup-copy')).toBeTruthy();
    expect(mounted.view.getByTestId('hyperlink-popup-edit')).toBeTruthy();
    expect(mounted.view.getByTestId('hyperlink-popup-unlink')).toBeTruthy();
  });

  test('the host page never navigates when a link is clicked', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    const anchor = [...mounted.view.container.querySelectorAll('a.docx-hyperlink')].find(
      (element) => element.textContent === 'Example'
    )!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      anchor.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  test('Escape dismisses it', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    expect(mounted.view.queryByTestId('hyperlink-popup')).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });

  test('a mousedown outside dismisses it', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });

  test('unlink keeps the text and removes the link', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-unlink'));
    });
    expect(bodyText(mounted)).toBe('Visit Example today');
    expect(mounted.view.container.querySelectorAll('a.docx-hyperlink')).toHaveLength(0);
    // Its own job done, the panel closes.
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });

  test('edit mode seeds from the link and applies a new target', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-edit'));
    });
    const url = mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
    const text = mounted.view.getByTestId('hyperlink-popup-text') as HTMLInputElement;
    expect(url.value).toBe('https://example.com');
    expect(text.value).toBe('Example');

    act(() => {
      fireEvent.change(url, { target: { value: 'https://example.org' } });
    });
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-apply'));
    });
    caret(mounted, 8);
    expect(mounted.editor().surface!.hyperlinks.linkAtCaret()?.href).toBe('https://example.org');
    expect(bodyText(mounted)).toBe('Visit Example today');
  });

  test('the URL input is typeable and Enter applies', () => {
    const mounted = mount(PLAIN);
    select(mounted, 6, 13);
    pressCommandK(mounted);
    const url = mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(url, { target: { value: 'https://typed.example' } });
    });
    expect(url.value).toBe('https://typed.example');
    act(() => {
      fireEvent.keyDown(url, { key: 'Enter' });
    });
    caret(mounted, 8);
    expect(mounted.editor().surface!.hyperlinks.linkAtCaret()?.href).toBe('https://typed.example');
  });

  test('a refused scheme is not applied and the document is untouched', () => {
    const mounted = mount(PLAIN);
    select(mounted, 6, 13);
    pressCommandK(mounted);
    const url = mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(url, { target: { value: 'javascript:alert(1)' } });
    });
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-apply'));
    });
    expect(bodyText(mounted)).toBe('Visit example today');
    expect(mounted.view.container.querySelectorAll('a.docx-hyperlink')).toHaveLength(0);
    // Still open, so the user can correct the value rather than wondering what happened.
    expect(mounted.view.queryByTestId('hyperlink-popup')).not.toBeNull();
  });

  test('an inert link shows its target with nothing to press', () => {
    const mounted = mount(
      docx(
        `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Click</w:t></w:r></w:hyperlink></w:p>`,
        `<Relationship Id="rId9" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`
      )
    );
    caret(mounted, 2);
    clickLink(mounted, 'Click');
    const readout = mounted.view.getByTestId('hyperlink-popup-url');
    expect(readout.hasAttribute('data-inert')).toBe(true);
    expect(readout.tagName).toBe('SPAN');
    // Copy needs a safe target; there is none.
    expect(mounted.view.queryByTestId('hyperlink-popup-copy')).toBeNull();
  });
});

describe('Ctrl/Cmd+K', () => {
  test('opens edit mode over the selection', () => {
    const mounted = mount(PLAIN);
    select(mounted, 6, 13);
    pressCommandK(mounted);
    const panel = mounted.view.getByTestId('hyperlink-popup');
    expect(panel.dataset.mode).toBe('editing');
    // Seeded with the selected text, so the user only has to supply the URL.
    expect((mounted.view.getByTestId('hyperlink-popup-text') as HTMLInputElement).value).toBe(
      'example'
    );
  });

  test('on an existing link it opens edit pre-filled', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    pressCommandK(mounted);
    expect(mounted.view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');
    expect((mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement).value).toBe(
      'https://example.com'
    );
    expect((mounted.view.getByTestId('hyperlink-popup-text') as HTMLInputElement).value).toBe(
      'Example'
    );
  });
});

describe('the toolbar link control', () => {
  test('is enabled, and opens the popover rather than running a bare command', () => {
    const mounted = mount(PLAIN);
    select(mounted, 6, 13);
    const button = mounted.view.container.querySelector(
      '[data-slot="text.link"]'
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
    act(() => {
      fireEvent.click(button);
    });
    expect(mounted.view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');
    // No link was created by the press itself — a link needs a target.
    expect(bodyText(mounted)).toBe('Visit example today');
  });
});

describe('the customization ladder', () => {
  test('a part child replaces its slot in place, and `hidden` removes it', () => {
    const mounted = mount(
      LINKED,
      <>
        <DocxEditorHyperLink.Copy className="my-copy" />
        <DocxEditorHyperLink.Unlink hidden />
      </>
    );
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    // The consumer's class landed, and there is still exactly ONE copy button.
    const copies = mounted.view.container.querySelectorAll('[data-testid="hyperlink-popup-copy"]');
    expect(copies).toHaveLength(1);
    expect(copies[0]!.className).toContain('my-copy');
    // Unlink is gone, and edit — which the consumer did not name — is untouched.
    expect(mounted.view.queryByTestId('hyperlink-popup-unlink')).toBeNull();
    expect(mounted.view.queryByTestId('hyperlink-popup-edit')).not.toBeNull();
  });

  test('a custom icon replaces the glyph without changing the wiring', () => {
    const mounted = mount(
      LINKED,
      <DocxEditorHyperLink.Unlink icon={<span data-testid="my-glyph">x</span>} />
    );
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    expect(mounted.view.getByTestId('my-glyph')).toBeTruthy();
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-unlink'));
    });
    expect(mounted.view.container.querySelectorAll('a.docx-hyperlink')).toHaveLength(0);
  });
});
