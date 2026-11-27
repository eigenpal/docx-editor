// Up, Down, and a press past the line end on a line that draws two paragraphs.
//
// Two kinds of line merge paragraphs: a resolved revision view folds a deleted paragraph mark
// away, and the text on either side of multi-paragraph field codes shares one line (ECMA-376
// Part 1, 17.16.18, CT_FldChar). A merged line's own range names only its first paragraph, so
// these motions must read each paragraph's spans instead.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { caretAt } from '../../layout/semantic-interaction.ts';
import { hitTestPage } from '../../layout/semantic-hit-test.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx } from './paginated-surface-fixtures.ts';

const TOP = '<w:p><w:r><w:t>Top line of text here</w:t></w:r></w:p>';
const LAST = 'Yes and more result';
const BOTTOM = '<w:p><w:r><w:t>Bottom line of text here</w:t></w:r></w:p>';

const KINDS = {
  'field codes': {
    body:
      TOP +
      '<w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve">IF 1 = 1 "</w:instrText></w:r></w:p>' +
      '<w:p><w:r><w:instrText>Inside</w:instrText></w:r></w:p>' +
      '<w:p><w:r><w:instrText xml:space="preserve">" ""</w:instrText></w:r>' +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${LAST}</w:t></w:r>` +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      BOTTOM,
    mode: 'all-markup',
    last: 3,
  },
  'a resolved revision view': {
    body:
      TOP +
      '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
      '<w:r><w:t>Alpha</w:t></w:r></w:p>' +
      `<w:p><w:r><w:t>${LAST}</w:t></w:r></w:p>` +
      BOTTOM,
    mode: 'proposed',
    last: 2,
  },
} as const;

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

function mount(kind: keyof typeof KINDS) {
  const { body, mode, last } = KINDS[kind];
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    revisionDisplayMode: mode,
  });
  if (!opened.ok) throw new Error(opened.reason);
  mounted.push({ surface: opened.surface, container });
  const ids = opened.surface.session.paragraphIds();
  return {
    surface: opened.surface,
    top: ids[0]!,
    first: ids[1]!,
    last: ids[last]!,
    bottom: ids.at(-1)!,
  };
}

function caret(surface: PaginatedSurface, paragraphId: string, offset: number): void {
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

for (const kind of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
  describe(`a line merged by ${kind}`, () => {
    test('Up from the second paragraph leaves the line', () => {
      const { surface, top, last } = mount(kind);
      caret(surface, last, 5);
      surface.navigate('up');
      expect(surface.state().selection.head.paragraphId).toBe(top);
    });

    test('Down onto the line lands in the paragraph under the caret', () => {
      const { surface, top, last } = mount(kind);
      caret(surface, top, 10);
      const from = caretAt(surface.layout(), { paragraphId: top, offset: 10 })!;
      surface.navigate('down');
      const head = surface.state().selection.head;
      expect(head.paragraphId).toBe(last);
      const landed = caretAt(surface.layout(), head)!;
      expect(Math.abs(landed.x - from.x)).toBeLessThan(10);
    });

    test('Down from the line leaves it, and Up returns to it', () => {
      const { surface, first, last, bottom } = mount(kind);
      caret(surface, first, 2);
      surface.navigate('down');
      expect(surface.state().selection.head.paragraphId).toBe(bottom);
      surface.navigate('up');
      expect([first, last]).toContain(surface.state().selection.head.paragraphId);
    });

    test('a press right of the line end puts the caret at the end of the second paragraph', () => {
      const { surface, last } = mount(kind);
      const end = caretAt(surface.layout(), { paragraphId: last, offset: LAST.length })!;
      const hit = hitTestPage(surface.layout(), end.pageIndex, { x: end.x + 100, y: end.y + 2 });
      expect(hit?.position).toEqual({ paragraphId: last, offset: LAST.length });
    });
  });
}
