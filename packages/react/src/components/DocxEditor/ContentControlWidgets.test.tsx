import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { act, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';
import { schema } from '@docx-editor.dev/core/prosemirror';
import { ContentControlWidgets } from './ContentControlWidgets';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => cleanup());

const TOC_RAW = [
  '<w:sdt><w:sdtPr><w:id w:val="77"/><w:alias w:val="Table of Contents"/></w:sdtPr>',
  '<w:sdtContent><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>',
  '<w:r><w:instrText>TOC \\h \\o "1-5"</w:instrText></w:r>',
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>',
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
  '</w:sdtContent></w:sdt>',
].join('');

function paragraph(text: string) {
  return schema.node('paragraph', null, text ? [schema.text(text)] : []);
}

function tocBlock() {
  return schema.node(
    'blockSdt',
    {
      id: 77,
      sdtType: 'richText',
      alias: 'Table of Contents',
      rawPropertiesXml: '<w:sdtPr><w:id w:val="77"/><w:alias w:val="Table of Contents"/></w:sdtPr>',
      rawPreserveXml: TOC_RAW,
      rawPreserveText: '',
    },
    [paragraph('')]
  );
}

function docWithPrefix(prefix: string | null) {
  return schema.node('doc', null, [
    ...(prefix == null ? [] : [paragraph(prefix)]),
    tocBlock(),
    paragraph('Heading'),
  ]);
}

function tocPosition(doc: ReturnType<typeof docWithPrefix>): number {
  let position = -1;
  doc.descendants((node, pos) => {
    if (position < 0 && node.type.name === 'blockSdt') position = pos;
    return position < 0;
  });
  return position;
}

function boundary(position: number): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'layout-block-sdt-box';
  box.dataset.sdtGroupId = `sdt@${position}`;
  return box;
}

describe('ContentControlWidgets TOC proxies', () => {
  test('preserves focused proxy identity and painted focus after a position-only repaint', async () => {
    let currentDoc = docWithPrefix(null);
    const onUpdate = mock(() => {});

    function Harness() {
      const containerRef = useRef<HTMLDivElement>(null);
      return (
        <>
          <div ref={containerRef}>
            <div className="paged-editor__pages" data-paint-generation="1">
              <div className="layout-page-content">
                <div
                  className="layout-block-sdt-box"
                  data-sdt-group-id={`sdt@${tocPosition(currentDoc)}`}
                />
              </div>
            </div>
          </div>
          <ContentControlWidgets
            containerRef={containerRef}
            getView={() => ({ state: { doc: currentDoc } }) as EditorView}
            onUpdateTableOfContents={onUpdate}
            tocUpdateLabel="Update table of contents"
          />
        </>
      );
    }

    const rendered = render(<Harness />);
    const pages = rendered.container.querySelector<HTMLElement>('.paged-editor__pages')!;
    const initialButton = await waitFor(() => {
      const button = pages.querySelector<HTMLButtonElement>('[data-toc-refresh]');
      expect(button).not.toBeNull();
      return button!;
    });
    const marker = document.createElement('span');
    initialButton.appendChild(marker);
    // Initial bind already synchronized this completed generation. Its
    // pages-ready signal must not scan/rebuild the same button again.
    await act(async () => {
      pages.dispatchEvent(
        new CustomEvent('docx-editor-react:painted-pages-ready', {
          detail: { paintGeneration: 1 },
        })
      );
    });
    expect(initialButton.contains(marker)).toBe(true);

    // Button mutations on the same pages root must not trigger observer sync.
    initialButton.remove();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(pages.querySelector('[data-toc-refresh]')).toBeNull();

    // The next authoritative pages-ready event sees the incomplete boundary
    // decoration and retries through the core completeness guard.
    await act(async () => {
      pages.dispatchEvent(
        new CustomEvent('docx-editor-react:painted-pages-ready', {
          detail: { paintGeneration: 1 },
        })
      );
    });
    expect(pages.querySelector('[data-toc-refresh]')).not.toBeNull();

    const firstProxy = await waitFor(() => {
      const proxy = rendered.container.querySelector<HTMLButtonElement>('[data-toc-refresh-proxy]');
      expect(proxy).not.toBeNull();
      return proxy!;
    });
    firstProxy.focus();
    expect(document.activeElement).toBe(firstProxy);

    currentDoc = docWithPrefix('Inserted before');
    const nextPosition = tocPosition(currentDoc);
    const content = pages.querySelector<HTMLElement>('.layout-page-content')!;
    await act(async () => {
      content.replaceChildren(boundary(nextPosition));
      pages.dataset.paintGeneration = '2';
      pages.dispatchEvent(
        new CustomEvent('docx-editor-react:painted-pages-ready', {
          detail: { paintGeneration: 2 },
        })
      );
    });

    await waitFor(() => {
      const currentProxy = rendered.container.querySelector<HTMLButtonElement>(
        '[data-toc-refresh-proxy]'
      );
      expect(currentProxy).toBe(firstProxy);
      expect(currentProxy?.dataset.tocPosition).toBe(String(nextPosition));
      expect(document.activeElement).toBe(firstProxy);
      expect(
        pages
          .querySelector('[data-toc-refresh]')
          ?.classList.contains('layout-toc-refresh--proxy-focused')
      ).toBe(true);
    });

    fireEvent.click(firstProxy);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(nextPosition);
  });
});
