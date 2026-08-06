import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorPageNumber } from '../src/editor/DocxEditorPageNumber.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const ONE_PAGE = docx(paragraph('one'));
const THREE_PAGES = docx(
  paragraph('one') + pageBreak + paragraph('two') + pageBreak + paragraph('three')
);

afterEach(cleanup);

describe('DocxEditor.PageNumber', () => {
  test('renders nothing for a one-page document', () => {
    const view = render(
      <DocxEditorRoot document={ONE_PAGE}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <DocxEditorPageNumber />
      </DocxEditorRoot>
    );

    expect(view.queryByRole('status')).toBeNull();
  });

  test('reports the viewport page while scrolling, then fades after 600ms idle', async () => {
    let editor: Editor | null = null;
    const view = render(
      <DocxEditorRoot document={THREE_PAGES} onReady={(instance) => (editor = instance)}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <DocxEditorPageNumber className="host-page-number" style={{ right: 32 }} />
      </DocxEditorRoot>
    );
    const viewport = view.getByTestId('docx-editor-scroll');
    const surface = view.container.querySelector<HTMLElement>('.docx-paginated-surface')!;
    Object.defineProperty(viewport, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(surface, 'offsetTop', { value: 0, configurable: true });
    const second = editor!.getPageGeometry()[1]!;
    viewport.scrollTop = second.box.y + second.box.height / 2 - viewport.clientHeight / 2;

    act(() => viewport.dispatchEvent(new Event('scroll')));

    const status = view.getByRole('status');
    expect(status.textContent).toBe('2 of 3');
    expect(status.getAttribute('data-visible')).toBe('true');
    expect(status.classList.contains('docx-editor')).toBe(true);
    expect(status.classList.contains('host-page-number')).toBe(true);
    expect((status as HTMLElement).style.right).toBe('32px');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650));
    });
    expect(status.getAttribute('data-visible')).toBe('false');
  });

  test('is included in the batteries-included editor', () => {
    const view = render(
      <DocxEditor
        document={THREE_PAGES}
        t={(key) => (key === 'viewer.pageIndicator' ? 'Page {current} / {total}' : key)}
      />
    );
    expect(view.getByRole('status').textContent).toBe('Page 1 / 3');
  });

  test('returns to hidden when the editor document changes', () => {
    const tree = (document: Uint8Array) => (
      <DocxEditorRoot document={document}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <DocxEditorPageNumber />
      </DocxEditorRoot>
    );
    const view = render(tree(THREE_PAGES));
    const viewport = view.getByTestId('docx-editor-scroll');
    Object.defineProperty(viewport, 'clientHeight', { value: 300, configurable: true });
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(view.getByRole('status').getAttribute('data-visible')).toBe('true');

    view.rerender(tree(ONE_PAGE));
    expect(view.queryByRole('status')).toBeNull();
    view.rerender(tree(THREE_PAGES));
    expect(view.getByRole('status').getAttribute('data-visible')).toBe('false');
  });
});
