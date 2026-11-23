// Wrap reflow passes must not grow with the document. Pictures positioned against their
// paragraph move whenever the text before them moves. A pass that reads their zones only from
// the previous pass repairs about one page of such a move, so opening a document with many
// pictures, or a page break above them, took a pass count that grew with the page count, each
// pass a full layout.

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { disableFollowingZoneMovesForTest } from '../following-anchor-tops.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  observeExclusionLayoutPassesForTest,
} from '../semantic-layout.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PT = 12700;
const COMPATIBILITY_MODE = 15;

const measurer = createFixedMeasurer(6, 14);

/** How the pictures of `picturesDocument` sit and vary. */
interface PictureOptions {
  /** The wrap distance above each picture, in points. */
  readonly distT?: number;
  /** Vary the text length and picture size from paragraph to paragraph. */
  readonly varied?: boolean;
}

/**
 * `count` paragraphs, each with a square-wrapped picture at its top and `words` repeats of some
 * text, the pictures `step` points apart across. With 22 or 17 repeats each paragraph is a little
 * taller than its picture, and the next paragraph's picture top touches its last line's bottom.
 * `distT` reaches each zone up past that edge, so the last lines wrap the next picture.
 */
function picturesDocument(
  count: number,
  words = 20,
  step = 150,
  { distT = 0, varied = false }: PictureOptions = {}
): string {
  const paragraphs: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = index + 1;
    const x = (index % 3) * step * EMU_PER_PT;
    const size = (90 + (varied ? (index % 3) * 12 - 12 : 0)) * EMU_PER_PT;
    const repeats = varied ? words + ((index * 7) % 9) - 4 : words;
    paragraphs.push(
      '<w:p><w:r><w:drawing>' +
        `<wp:anchor distT="${distT * EMU_PER_PT}" distB="0" distL="114300" distR="114300" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="${id}">` +
        '<wp:simplePos x="0" y="0"/>' +
        `<wp:positionH relativeFrom="column"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        `<wp:extent cx="${size}" cy="${size}"/>` +
        '<wp:wrapSquare wrapText="bothSides"/>' +
        `<wp:docPr id="${id}" name="pic ${id}"/>` +
        `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
        '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        `<pic:spPr><a:xfrm><a:ext cx="${size}" cy="${size}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
        '</wp:anchor></w:drawing></w:r>' +
        `<w:r><w:t>${'words of text '.repeat(repeats)}</w:t></w:r></w:p>`
    );
  }
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${paragraphs.join('')}</w:body></w:document>`
  );
}

/** The part with a page-break paragraph first, keeping every other node id. */
function withLeadingPageBreak(part: OoxmlPart): OoxmlPart {
  const lead = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:br w:type="page"/></w:r></w:p></w:body></w:document>`,
    '/word/lead.xml'
  );
  const find = (node: OoxmlNode): OoxmlNode | undefined =>
    node.kind === 'textValue'
      ? undefined
      : node.localName === 'p'
        ? node
        : node.children.map(find).find(Boolean);
  const paragraph = find(lead.root)!;
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.localName === 'body') return { ...node, children: [paragraph, ...node.children] };
    return { ...node, children: node.children.map(visit) };
  };
  return { ...part, root: visit(part.root) as OoxmlPart['root'] };
}

function countPasses<T>(run: () => T): { result: T; passes: number } {
  let passes = 0;
  const stop = observeExclusionLayoutPassesForTest(() => {
    passes += 1;
  });
  try {
    return { result: run(), passes };
  } finally {
    stop();
  }
}

const layout = (
  part: OoxmlPart,
  revision: number,
  session?: ReturnType<typeof createLayoutSession>
) =>
  layoutSemanticDocument(part, revision, {
    measurer,
    compatibilityMode: COMPATIBILITY_MODE,
    inlineDrawingLayout: layoutContext(part),
    ...(session ? { session } : {}),
  });

/** Opens `count` pictures, then inserts a page break above them in the same session. */
function openThenBreak(count: number) {
  const part = load(picturesDocument(count));
  const session = createLayoutSession();
  const open = countPasses(() => layout(part, 1, session));
  const edited = withLeadingPageBreak(part);
  const edit = countPasses(() => layout(edited, 2, session));
  return { open, edit, edited };
}

describe('wrap reflow pass count', () => {
  test('does not grow with the page count', () => {
    const small = openThenBreak(24);
    const large = openThenBreak(96);
    expect(large.open.result.pages.length).toBeGreaterThanOrEqual(
      small.open.result.pages.length * 3
    );
    // Before: 6 and 18 passes to open, and the same again for the page break.
    expect(large.open.passes).toBeLessThanOrEqual(small.open.passes);
    expect(large.edit.passes).toBeLessThanOrEqual(small.edit.passes);
    expect(large.edit.passes).toBeLessThanOrEqual(3);
  }, 60_000);

  test('lays a page break above many pictures out as a fresh layout does', () => {
    const { edit, edited } = openThenBreak(24);
    expect(edit.result.pages).toEqual(layout(edited, 2).pages);
  }, 60_000);
});

/** Runs `run` with every following picture's zone left where the previous pass put it. */
function withoutZoneMoves<T>(run: () => T): T {
  const restore = disableFollowingZoneMovesForTest();
  try {
    return run();
  } finally {
    restore();
  }
}

const layoutWithoutZoneMoves = (part: OoxmlPart) =>
  withoutZoneMoves(() => countPasses(() => layout(part, 1)));

/** The part with its `nth` body text doubled, keeping every node id. */
function withLongerText(source: OoxmlPart, nth: number): OoxmlPart {
  let seen = -1;
  const visit = (node: OoxmlNode, parent?: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') {
      if (parent?.kind !== 'text') return node;
      seen += 1;
      return seen === nth ? { ...node, value: node.value + node.value } : node;
    }
    return { ...node, children: node.children.map((child) => visit(child, node)) };
  };
  return { ...source, root: visit(source.root) as OoxmlPart['root'] };
}

/** Opens `part` in a session, then lays out three edits, each from the opened document. */
function editPasses(part: OoxmlPart, cache?: ReturnType<typeof createParagraphLayoutCache>) {
  const session = createLayoutSession();
  const lay = (source: OoxmlPart, revision: number) =>
    layoutSemanticDocument(source, revision, {
      measurer,
      compatibilityMode: COMPATIBILITY_MODE,
      inlineDrawingLayout: layoutContext(source),
      session,
      ...(cache ? { cache } : {}),
    });
  lay(part, 1);
  const edits = [3, 10, 20].map((nth, index) => {
    const edit = countPasses(() => lay(withLongerText(part, nth), 2 + index * 2));
    lay(part, 3 + index * 2);
    return edit;
  });
  const reopened = [3, 10, 20].map((nth) => {
    const reopen = withLongerText(part, nth);
    return layoutSemanticDocument(reopen, 1, {
      measurer,
      compatibilityMode: COMPATIBILITY_MODE,
      inlineDrawingLayout: layoutContext(reopen),
      ...(cache ? { cache: createParagraphLayoutCache() } : {}),
    }).pages;
  });
  return {
    passes: edits.map((edit) => edit.passes),
    pages: edits.map((e) => e.result.pages),
    reopened,
  };
}

const overlapping = { distT: 3 } as const;

describe("wrap around the next paragraph's picture", () => {
  // Each paragraph's last lines wrap the next paragraph's picture, whose zone came from the
  // previous pass: each pass settled about one more paragraph of the chain (#1803).
  test('settles an overlapping chain in a pass count that does not grow with it', () => {
    for (const words of [22, 18]) {
      const passes = [12, 48, 96].map(
        (count) =>
          countPasses(() => layout(load(picturesDocument(count, words, 150, overlapping)), 1))
            .passes
      );
      // Ordinary passes: 25 and 47 passes for 48 and 96 pictures with 22 words, 20 and 36 with
      // 18 words.
      expect(passes[1]!).toBeLessThanOrEqual(8);
      expect(passes[2]!).toBeLessThanOrEqual(12);
    }
  }, 120_000);

  test('publishes the layout that ordinary passes settle on', () => {
    for (const [count, options] of [
      [48, overlapping],
      [96, { ...overlapping, varied: true }],
    ] as const) {
      const part = load(picturesDocument(count, 22, 150, options));
      const moved = countPasses(() => layout(part, 1));
      const ordinary = layoutWithoutZoneMoves(part);
      expect(ordinary.passes).toBeGreaterThan(moved.passes);
      expect(moved.result.pages).toEqual(ordinary.result.pages);
    }
  }, 120_000);

  test('settles a chain of pictures that only touch the line above in a few passes', () => {
    // Without a wrap distance each picture's top meets the bottom of the last line above it.
    // That line stays clear of the picture (`WRAP_EDGE_TOUCH_PT`), so no chain forms. Before,
    // rounding decided that wrap: 26 passes for 96 pictures with 22 words.
    for (const words of [22, 17, 12]) {
      const part = load(picturesDocument(96, words));
      const moved = countPasses(() => layout(part, 1));
      const ordinary = layoutWithoutZoneMoves(part);
      expect(moved.passes).toBeLessThanOrEqual(3);
      expect(moved.passes).toBeLessThanOrEqual(ordinary.passes);
      expect(moved.result.pages).toEqual(ordinary.result.pages);
    }
  }, 120_000);

  test('takes no more passes than ordinary passes where nothing drifts', () => {
    // 14 words: the chain settles in two passes. 40 words: each paragraph clears the next
    // picture by a line or more. Neither leaves a move to make.
    for (const words of [14, 40]) {
      const part = load(picturesDocument(24, words));
      const moved = countPasses(() => layout(part, 1));
      const ordinary = layoutWithoutZoneMoves(part);
      expect(moved.passes).toBeLessThanOrEqual(ordinary.passes);
      expect(moved.result.pages).toEqual(ordinary.result.pages);
    }
  }, 60_000);

  // Edits and reopens, with and without the break cache that the editor uses, on chains that
  // touch, overlap, and vary from paragraph to paragraph. 24 pictures keep a chain that ordinary
  // passes settle more slowly (14 passes against 8 for the third edit) at a third of the cost of
  // 48: each edit lays the whole document out once per pass. The pass ceilings above cover
  // longer chains.
  const editShapes: readonly [string, number, PictureOptions][] = [
    ['touching', 22, {}],
    ['touching, 17 words', 17, {}],
    ['overlapping', 22, overlapping],
    ['overlapping, varied', 22, { ...overlapping, varied: true }],
    ['varied', 18, { varied: true }],
  ];
  for (const cached of [false, true])
    test(`lays edits out as ordinary passes do${cached ? ', with the break cache' : ''}`, () => {
      const cacheOf = () => (cached ? createParagraphLayoutCache() : undefined);
      for (const [, words, options] of editShapes) {
        const part = load(picturesDocument(24, words, 150, options));
        const moved = editPasses(part, cacheOf());
        const ordinary = withoutZoneMoves(() => editPasses(part, cacheOf()));
        for (const [index, passes] of moved.passes.entries()) {
          expect(passes).toBeLessThanOrEqual(ordinary.passes[index]!);
          expect(moved.pages[index]).toEqual(ordinary.pages[index]);
          // An edit lays out as a reopen does wherever ordinary passes do.
          if (Bun.deepEquals(ordinary.pages[index], ordinary.reopened[index]))
            expect(moved.pages[index]).toEqual(moved.reopened[index]);
        }
      }
    }, 300_000);

  test('takes no more passes than ordinary passes in balanced columns', () => {
    // A two-column section that a continuous section follows balances its last page: each
    // trial of that search is a reflow of its own, as is each column of the flow.
    const geometry =
      '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
    const part = load(
      picturesDocument(16, 8, 40).replace(
        '</w:body>',
        `<w:p><w:pPr><w:sectPr>${geometry}<w:cols w:num="2" w:space="720"/></w:sectPr></w:pPr></w:p>` +
          `<w:p><w:r><w:t>After</w:t></w:r></w:p><w:sectPr><w:type w:val="continuous"/>${geometry}</w:sectPr></w:body>`
      )
    );
    const moved = countPasses(() => layout(part, 1));
    const ordinary = layoutWithoutZoneMoves(part);
    expect(moved.passes).toBeLessThanOrEqual(ordinary.passes);
    expect(moved.result.pages).toEqual(ordinary.result.pages);
  }, 60_000);
});
