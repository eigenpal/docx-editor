import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { caretAt } from '@docx-editor.dev/core/layout';
import { docx as sharedDocx, paragraph } from './paginated-surface-fixtures.ts';
import {
  mountPaginatedSurface,
  setPaginatedSurfaceScale,
  type PaginatedSurface,
} from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

/** The shared package with a styles part that pins the format defaults. */
function docx(body: string): Uint8Array {
  const files = unzipSync(sharedDocx(body));
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    )
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
  );
  files['word/styles.xml'] = strToU8(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}</w:styles>`);
  return zipSync(files);
}

function mount(body: string): {
  readonly surface: PaginatedSurface;
  readonly scroller: HTMLElement;
} {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  document.body.append(scroller);
  const host = document.createElement('div');
  scroller.append(host);
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', { value: 100_000, configurable: true });
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
    configurable: true,
  });
  const opened = mountPaginatedSurface(host, docx(body), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  return { surface: opened.surface, scroller };
}

describe('bookmark navigation', () => {
  test('a bookmark jump after rescaling uses the current scale', () => {
    const filler = Array.from({ length: 120 }, (_, index) =>
      paragraph(`paragraph ${index} ${'word '.repeat(20)}`)
    ).join('');
    const { surface, scroller } = mount(
      filler +
        `<w:p><w:bookmarkStart w:id="1" w:name="target"/><w:r><w:t>Destination</w:t></w:r></w:p>`
    );
    const target = surface.bookmarks().get('target');
    expect(target).not.toBeUndefined();

    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);
    expect(surface.navigation.goToBookmark('target')).toBe(true);

    const bookmark = surface.bookmarks().get('target')!;
    const caret = caretAt(surface.layout(), {
      paragraphId: bookmark.paragraphId,
      offset: bookmark.offset,
    });
    expect(caret).not.toBeNull();
    const page = surface.layout().pages[caret!.pageIndex]!;
    const sheetY = page.box.y + (page.contentBox.y - page.box.y) + caret!.y;
    expect(scroller.scrollTop).toBeCloseTo(Math.max(0, sheetY * 2 - 24), 5);
    expect(surface.state().selection.head.paragraphId).toBe(bookmark.paragraphId);

    surface.destroy();
    scroller.remove();
  });
});

describe('caret following', () => {
  test('scrolls the nearest edge into view when a collapsed caret changes page', () => {
    const filler = Array.from({ length: 120 }, (_, index) =>
      paragraph(`paragraph ${index} ${'word '.repeat(20)}`)
    ).join('');
    const { surface, scroller } = mount(filler);
    surface.focus();

    const targetId = surface.session.paragraphIds().find((paragraphId) => {
      const caret = caretAt(surface.layout(), { paragraphId, offset: 0 });
      return caret !== null && caret.pageIndex > 0;
    });
    expect(targetId).toBeDefined();

    surface.setSelection({
      anchor: { paragraphId: targetId!, offset: 0 },
      head: { paragraphId: targetId!, offset: 0 },
    });

    const caret = caretAt(surface.layout(), { paragraphId: targetId!, offset: 0 })!;
    const page = surface.layout().pages[caret.pageIndex]!;
    const sheetY = page.box.y + (page.contentBox.y - page.box.y) + caret.y;
    expect(scroller.scrollTop).toBeCloseTo(
      Math.max(0, sheetY + caret.height + 24 - scroller.clientHeight),
      5
    );

    surface.destroy();
    scroller.remove();
  });

  test('does not follow a range selection', () => {
    const filler = Array.from({ length: 120 }, (_, index) =>
      paragraph(`paragraph ${index} ${'word '.repeat(20)}`)
    ).join('');
    const { surface, scroller } = mount(filler);
    surface.focus();
    const ids = surface.session.paragraphIds();

    surface.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 0 },
      head: { paragraphId: ids[ids.length - 1]!, offset: 0 },
    });

    expect(scroller.scrollTop).toBe(0);
    surface.destroy();
    scroller.remove();
  });
});
