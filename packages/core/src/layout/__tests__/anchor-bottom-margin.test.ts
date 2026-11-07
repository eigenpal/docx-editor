// A wrapping object that its paragraph or line positions, near the bottom of the page.
//
// Modern modes (`wrappedAnchorsEndAtBottomMargin`): the object moves up to end at the bottom
// margin when it can stay at or below the top of its line. Otherwise its line moves to the next
// page with it, and an object that still crosses the margin there ends the page. Legacy modes
// (`wrappedAnchorsEndOnSheet`) move it up to end at the sheet bottom and never move the line.
// An object that does not wrap text keeps its offset in every mode.
//
// Letter page, 1in margins: a 648pt content box, 72pt from the sheet top and bottom. A filler
// line of exact height puts the anchor paragraph where a test needs it: at 560 by default, with
// 88pt left above the bottom margin. Multi-line paragraphs use exact 14pt lines.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const emu = (pt: number) => String(Math.round(pt * 12_700));
let nextId = 1;

interface Box {
  readonly y: number;
  readonly height: number;
  readonly x?: number;
  readonly wrap?: 'square' | 'none' | 'behind';
  readonly frame?: 'paragraph' | 'line';
}

function anchor({ y, height, x = 0, wrap = 'square', frame = 'paragraph' }: Box): string {
  const id = nextId++;
  const wrapXml = wrap === 'square' ? '<wp:wrapSquare wrapText="bothSides"/>' : '<wp:wrapNone/>';
  return (
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" ` +
    `behindDoc="${wrap === 'behind' ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${emu(x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="${frame}"><wp:posOffset>${emu(y)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${emu(100)}" cy="${emu(height)}"/>${wrapXml}` +
    `<wp:docPr id="${id}" name="Box ${id}"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${emu(100)}" cy="${emu(height)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const text = (value: string) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
const exactLine = (pt: number) =>
  `<w:pPr><w:spacing w:before="0" w:after="0" w:line="${pt * 20}" w:lineRule="exact"/></w:pPr>`;
/** One line of exact `height` points. */
const filler = (height = 560) => `<w:p>${exactLine(height)}<w:r><w:t>Filler</w:t></w:r></w:p>`;
/** One paragraph of `count` lines split by manual breaks, with `content` before line `at`. */
function linesParagraph(content: string, at: number, count: number): string {
  const runs: string[] = [];
  for (let line = 1; line <= count; line += 1) {
    if (line === at) runs.push(content);
    runs.push(`<w:r><w:t>Line ${line}</w:t></w:r>`);
    if (line < count) runs.push('<w:r><w:br/></w:r>');
  }
  return `<w:p>${exactLine(14)}${runs.join('')}</w:p>`;
}

/** `compatibilityMode` null lays the document out with no mode, as a file without one. */
function render(
  body: string,
  compatibilityMode: number | null = 15,
  session?: ReturnType<typeof createLayoutSession>,
  revision = 1
) {
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"` +
      ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
      ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<w:body>${body}</w:body></w:document>`
  );
  return layoutSemanticDocument(part, revision, {
    compatibilityMode: compatibilityMode ?? undefined,
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
    session,
  });
}

type Layout = ReturnType<typeof render>;
/** Page index and y of every drawing, in page order. */
const drawings = (layout: Layout) =>
  layout.pages.flatMap((page, index) =>
    (page.anchoredDrawings ?? []).map((d) => ({ page: index, y: Math.round(d.y * 100) / 100 }))
  );
/** Page index and y of the first line whose text is `value`. */
function lineAt(layout: Layout, value: string) {
  for (const [index, page] of layout.pages.entries())
    for (const fragment of paragraphFragmentsOf(page))
      for (const line of fragment.lines)
        if (
          line.spans
            .map((span) => span.text)
            .join('')
            .trimEnd() === value
        )
          return { page: index, y: line.box.y };
  return null;
}
const after = text('After');

describe('modern modes: a wrapping object that cannot end at the bottom margin', () => {
  test('moves an anchor-only paragraph to the next page with its object', () => {
    const layout = render(filler() + `<w:p>${anchor({ y: 8, height: 300 })}</w:p>` + after);
    expect(drawings(layout)).toEqual([{ page: 1, y: 8 }]);
    expect(lineAt(layout, 'After')!.page).toBe(1);
  });

  test('moves the same paragraph when the object sits at the right of the column', () => {
    const tall = anchor({ y: 8, height: 300, x: 368 });
    expect(drawings(render(filler() + `<w:p>${tall}</w:p>`))).toEqual([{ page: 1, y: 8 }]);
  });

  test('moves a paragraph with text, before or after the object', () => {
    for (const body of [
      `<w:p>${anchor({ y: 8, height: 300 })}<w:r><w:t>Text</w:t></w:r></w:p>`,
      `<w:p><w:r><w:t>Text</w:t></w:r>${anchor({ y: 8, height: 300 })}</w:p>`,
    ]) {
      const layout = render(filler() + body);
      expect(drawings(layout)).toEqual([{ page: 1, y: 8 }]);
      expect(lineAt(layout, 'Text')).toEqual({ page: 1, y: 0 });
    }
  });

  test('moves the paragraph for a tall object after a short one', () => {
    const both = anchor({ y: 8, height: 20 }) + anchor({ y: 8, height: 300, x: 200 });
    expect(drawings(render(filler() + `<w:p>${both}</w:p>`))).toEqual([
      { page: 1, y: 8 },
      { page: 1, y: 8 },
    ]);
  });

  test('moves the paragraph for a line-relative object', () => {
    const tall = anchor({ y: 8, height: 300, frame: 'line' });
    expect(drawings(render(filler() + `<w:p>${tall}</w:p>`))).toEqual([{ page: 1, y: 8 }]);
  });

  test('stops a negative offset at the next page top margin', () => {
    const tall = anchor({ y: -200, height: 300 });
    expect(drawings(render(filler() + `<w:p>${tall}</w:p>`))).toEqual([{ page: 1, y: 0 }]);
  });

  test('splits a paragraph before the line that holds the object', () => {
    // The paragraph starts at 518, so line 5 starts at 574.
    for (const frame of ['paragraph', 'line'] as const) {
      const box = anchor({ y: 8, height: 300, x: 368, frame });
      const layout = render(filler(518) + linesParagraph(box, 5, 8) + after);
      expect(lineAt(layout, 'Line 4')).toEqual({ page: 0, y: 560 });
      expect(lineAt(layout, 'Line 5')).toEqual({ page: 1, y: 0 });
      expect(drawings(layout)).toEqual([{ page: 1, y: 8 }]);
    }
  });

  test('moves the line when the lifted object would rise above that line', () => {
    // Lifted to end at 648, a 110pt object starts at 538: below the paragraph top (518) but
    // above its own line (574).
    const box = anchor({ y: 100, height: 110, x: 368 });
    const layout = render(filler(518) + linesParagraph(box, 5, 8));
    expect(lineAt(layout, 'Line 5')).toEqual({ page: 1, y: 0 });
    expect(drawings(layout)).toEqual([{ page: 1, y: 100 }]);
  });

  test('ends the page after an object taller than the page', () => {
    const layout = render(
      filler() + linesParagraph(anchor({ y: 8, height: 700, x: 368 }), 1, 3) + after
    );
    expect(drawings(layout)).toEqual([{ page: 1, y: 8 }]);
    expect(lineAt(layout, 'Line 1')).toEqual({ page: 1, y: 0 });
    expect(lineAt(layout, 'Line 2')).toEqual({ page: 2, y: 0 });
    expect(lineAt(layout, 'After')!.page).toBe(2);
  });

  test('agrees with a fresh layout after an edit above the paragraph', () => {
    const body = (title: string) =>
      text(title) + filler(532) + linesParagraph(anchor({ y: 8, height: 300, x: 368 }), 3, 5);
    const session = createLayoutSession();
    render(body('Heading'), 15, session);
    const edited = render(body('Changed heading'), 15, session, 2);
    const fresh = render(body('Changed heading'));
    expect(drawings(edited)).toEqual(drawings(fresh));
    expect(lineAt(edited, 'Line 3')).toEqual(lineAt(fresh, 'Line 3'));
    expect(lineAt(fresh, 'Line 3')).toEqual({ page: 1, y: 0 });
    expect(lineAt(fresh, 'Line 2')!.page).toBe(0);
  });
});

describe('modern modes: a wrapping object that can end at the bottom margin', () => {
  test('moves up to end at the margin and keeps its paragraph', () => {
    // Below the margin (offset 120), and across it (offsets 68 and 60).
    for (const [y, height] of [
      [120, 40],
      [68, 40],
      [60, 60],
    ] as const) {
      const layout = render(filler() + `<w:p>${anchor({ y, height })}</w:p>` + after);
      expect(drawings(layout)).toEqual([{ page: 0, y: 648 - height }]);
      expect(lineAt(layout, 'After')!.page).toBe(0);
    }
  });

  test('keeps a paragraph with text and lifts a line-relative object too', () => {
    const withText = `<w:p>${anchor({ y: 120, height: 40 })}<w:r><w:t>Text</w:t></w:r></w:p>`;
    expect(drawings(render(filler() + withText))).toEqual([{ page: 0, y: 608 }]);
    const line = `<w:p>${anchor({ y: 120, height: 40, frame: 'line' })}</w:p>`;
    expect(drawings(render(filler() + line))).toEqual([{ page: 0, y: 608 }]);
  });

  test('keeps a later line when the lifted object stays below it', () => {
    const box = anchor({ y: 100, height: 60, x: 368 });
    const layout = render(filler(518) + linesParagraph(box, 5, 8));
    expect(lineAt(layout, 'Line 8')!.page).toBe(0);
    expect(drawings(layout)).toEqual([{ page: 0, y: 588 }]);
  });

  test('leaves an object that fits where it is', () => {
    expect(drawings(render(filler() + `<w:p>${anchor({ y: 8, height: 60 })}</w:p>`))).toEqual([
      { page: 0, y: 568 },
    ]);
  });
});

describe('objects that do not wrap text', () => {
  for (const mode of [15, 14]) {
    test(`keep their offset and their paragraph in mode ${mode}`, () => {
      for (const wrap of ['none', 'behind'] as const)
        for (const [y, height] of [
          [8, 300],
          [120, 40],
          [60, 60],
        ] as const) {
          const layout = render(
            filler() + `<w:p>${anchor({ y, height, wrap })}</w:p>` + after,
            mode
          );
          expect(drawings(layout)).toEqual([{ page: 0, y: 560 + y }]);
          expect(lineAt(layout, 'After')!.page).toBe(0);
        }
    });
  }
});

describe('legacy modes: a wrapping object near the bottom of the page', () => {
  for (const mode of [14, 12, null]) {
    test(`moves up to end at the sheet bottom and keeps its line in mode ${mode}`, () => {
      // The sheet bottom is 72pt below the content box: 720 in content coordinates.
      const layout = render(filler() + `<w:p>${anchor({ y: 8, height: 300 })}</w:p>` + after, mode);
      expect(drawings(layout)).toEqual([{ page: 0, y: 420 }]);
      expect(lineAt(layout, 'After')!.page).toBe(0);
    });
  }

  test('never moves above the sheet top', () => {
    const layout = render(filler() + `<w:p>${anchor({ y: 8, height: 800 })}</w:p>` + after, 14);
    expect(drawings(layout)).toEqual([{ page: 0, y: -72 }]);
    expect(lineAt(layout, 'After')!.page).toBe(0);
  });

  test('leaves an object that ends above the sheet bottom where it is', () => {
    const layout = render(filler() + `<w:p>${anchor({ y: 120, height: 40 })}</w:p>`, 14);
    expect(drawings(layout)).toEqual([{ page: 0, y: 680 }]);
  });

  test('keeps a later line and lifts its object', () => {
    const box = anchor({ y: 8, height: 300, x: 368 });
    const layout = render(filler(518) + linesParagraph(box, 5, 8), 14);
    expect(lineAt(layout, 'Line 8')!.page).toBe(0);
    expect(drawings(layout)).toEqual([{ page: 0, y: 420 }]);
  });
});
