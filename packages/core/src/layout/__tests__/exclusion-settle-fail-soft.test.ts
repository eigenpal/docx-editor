// A wrap reflow that runs out of passes must still lay the document out. Before, it threw
// `DrawingExclusionConvergenceError`, nothing caught it for body text, and the document did not
// open. A chain of pictures that each wrap the text before the next one settles about one link
// per pass while the zones of following pictures stay where the previous pass put them, so a
// long enough chain reaches the ceiling (#1803). These tests keep them there.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { limitExclusionPassesForTest } from '../exclusion-layout-steps.ts';
import { disableFollowingZoneMovesForTest } from '../following-anchor-tops.ts';
import { refusalRetriesWithoutHiddenFurniture } from '../furniture-drawing-exclusion.ts';
import { layoutBlocksWithColumnBalance, type BlockLayoutResult } from '../column-balance-layout.ts';
import type { BlockLayoutOptions } from '../semantic-layout-options.ts';
import type { PageRecord } from '../semantic-records.ts';
import { markResultUnsettled } from '../unsettled-exclusion-layout.ts';
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

/**
 * `count` paragraphs, each a square-wrapped picture at its top and text a little taller than
 * the picture. `distT`, in points, reaches each picture's zone up past the bottom of the line
 * above it, so each paragraph's last lines wrap the next paragraph's picture.
 */
function pictureChain(count: number, distT = 0): string {
  const paragraphs: string[] = [];
  const size = 90 * EMU_PER_PT;
  const step = 150;
  const words = 22;
  for (let index = 0; index < count; index += 1) {
    const id = index + 1;
    paragraphs.push(
      '<w:p><w:r><w:drawing>' +
        `<wp:anchor distT="${distT * EMU_PER_PT}" distB="0" distL="114300" distR="114300" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="${id}">` +
        '<wp:simplePos x="0" y="0"/>' +
        `<wp:positionH relativeFrom="column"><wp:posOffset>${(index % 3) * step * EMU_PER_PT}</wp:posOffset></wp:positionH>` +
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        `<wp:extent cx="${size}" cy="${size}"/>` +
        '<wp:wrapSquare wrapText="bothSides"/>' +
        `<wp:docPr id="${id}" name="pic ${id}"/>` +
        `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
        '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        `<pic:spPr><a:xfrm><a:ext cx="${size}" cy="${size}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
        '</wp:anchor></w:drawing></w:r>' +
        `<w:r><w:t>${'words of text '.repeat(words)}</w:t></w:r></w:p>`
    );
  }
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${paragraphs.join('')}</w:body></w:document>`
  );
}

const part = load(pictureChain(24, 3));
const layout = (
  source: OoxmlPart,
  revision = 1,
  session?: ReturnType<typeof createLayoutSession>
) =>
  layoutSemanticDocument(source, revision, {
    measurer: createFixedMeasurer(6, 14),
    compatibilityMode: 15,
    inlineDrawingLayout: layoutContext(source),
    ...(session ? { session } : {}),
  });

/** The part with the text of its `nth` text node doubled, keeping every node id. */
function withLongerText(source: OoxmlPart, nth: number): OoxmlPart {
  let seen = -1;
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') {
      seen += 1;
      return seen === nth ? { ...node, value: node.value + node.value } : node;
    }
    return { ...node, children: node.children.map(visit) };
  };
  return { ...source, root: visit(source.root) as OoxmlPart['root'] };
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

/** Runs `run` with a reflow budget of 3 passes and a settling ceiling of 4. */
function withPassLimits<T>(run: () => T): T {
  const restore = limitExclusionPassesForTest(3, 4);
  try {
    return run();
  } finally {
    restore();
  }
}

describe('a wrap reflow that runs out of passes', () => {
  let restoreMoves: () => void;
  beforeAll(() => {
    restoreMoves = disableFollowingZoneMovesForTest();
  });
  afterAll(() => restoreMoves());

  test('needs more passes than the lowered limits allow', () => {
    // The chain settles, given enough passes: the limits below must cut it short.
    const settled = countPasses(() => layout(part));
    expect(settled.passes).toBeGreaterThan(6);
  }, 60_000);

  test('publishes its last pass, the same way every time', () => {
    const first = withPassLimits(() => countPasses(() => layout(part, 1, createLayoutSession())));
    const again = withPassLimits(() => layout(part));
    expect(first.result.pages.length).toBeGreaterThanOrEqual(3);
    // Every picture keeps its place in the output.
    const drawings = first.result.pages.flatMap((page) => page.anchoredDrawings ?? []);
    expect(new Set(drawings.map((drawing) => drawing.drawingNodeId)).size).toBe(24);
    // The budget of 3 and 2 stabilization passes run out, and the last of them publishes. A
    // cycle would publish after one more pass, under its zones.
    expect(first.passes).toBe(5);
    expect(again.pages).toEqual(first.result.pages);
  }, 60_000);

  test('lays an edit out as a fresh layout of the edited document', () => {
    const session = createLayoutSession();
    withPassLimits(() => layout(part, 1, session));
    const edited = withLongerText(part, 20);
    const edit = withPassLimits(() => layout(edited, 2, session));
    expect(edit.pages).toEqual(withPassLimits(() => layout(edited, 2)).pages);
  }, 60_000);

  test('settles an edit from scratch once, after one seeded pass', () => {
    const session = createLayoutSession();
    withPassLimits(() => layout(part, 1, session));
    const edited = withLongerText(part, 20);
    const edit = withPassLimits(() => countPasses(() => layout(edited, 2, session)));
    const fresh = withPassLimits(() => countPasses(() => layout(edited, 2)));
    // A seeded settle that ran to the ceiling before its fresh fallback would take 5 more.
    expect(edit.passes).toBe(fresh.passes + 1);
    expect(edit.result.pages).toEqual(fresh.result.pages);
    // An unchanged layout keeps its pages, and the next edit still settles from scratch.
    const again = withPassLimits(() => countPasses(() => layout(edited, 2, session)));
    expect(again.passes).toBeLessThanOrEqual(1);
    const next = withLongerText(edited, 21);
    const nextEdit = withPassLimits(() => countPasses(() => layout(next, 3, session)));
    expect(nextEdit.passes).toBe(
      withPassLimits(() => countPasses(() => layout(next, 3))).passes + 1
    );
  }, 60_000);

  test('keeps a balanced section unbalanced instead of running every trial to the limits', () => {
    // A natural layout that never settled: each balance trial would run to the limits too.
    let calls = 0;
    const page = {
      fragments: [{ kind: 'paragraph', box: { x: 0, y: 0, width: 200, height: 400 }, lines: [] }],
    } as unknown as PageRecord;
    const pass = (): BlockLayoutResult => {
      calls += 1;
      const result = {
        pages: [page],
        endsOpenPage: true,
        endCursorY: 400,
        endSpaceAfter: 0,
        lineCounter: 0,
      } as unknown as BlockLayoutResult;
      markResultUnsettled(result, 5);
      return result;
    };
    const options = {
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
      sectionColumns: { count: 2, gapTwips: 720, equalWidth: true },
      balanceColumns: true,
    } as unknown as BlockLayoutOptions;
    // Without a session the natural layout is the result: no trials, no second pass.
    expect(layoutBlocksWithColumnBalance([], 1, options, pass).pages).toEqual([page]);
    expect(calls).toBe(1);
    // With a session, one more pass fills it: still no trials.
    calls = 0;
    const session = createLayoutSession();
    layoutBlocksWithColumnBalance([], 1, { ...options, session }, pass);
    expect(calls).toBe(2);
    expect(session.balanceLimit).toBeNull();
  });

  test('never asks for the hidden-furniture retry from inside that retry', () => {
    // During the retry, a reflow that does not settle must publish: a refusal there escapes.
    expect(refusalRetriesWithoutHiddenFurniture({ yieldHiddenFurnitureZones: true })).toBe(false);
  });
});

describe('a wrap reflow that moves zones under lowered limits', () => {
  // A chain whose pictures overlap the lines above them settles a link per ordinary pass, and
  // passes 5 and 6 may move zones. Limits of 6 and 8: the budget ends with the moved passes
  // and the pass after them. Limits of 4 and 5: it ends before a pass may move a zone, and the
  // reflow runs out as an ordinary one does.
  test('publishes, the same way every time, within the passes ordinary passes take', () => {
    for (const [reflow, settling] of [
      [6, 8],
      [4, 5],
    ] as const) {
      const limited = <T>(run: () => T): T => {
        const restore = limitExclusionPassesForTest(reflow, settling);
        try {
          return run();
        } finally {
          restore();
        }
      };
      const moved = limited(() => countPasses(() => layout(part, 1, createLayoutSession())));
      const again = limited(() => layout(part));
      const restore = disableFollowingZoneMovesForTest();
      const ordinary = limited(() => countPasses(() => layout(part)));
      restore();
      const drawings = moved.result.pages.flatMap((page) => page.anchoredDrawings ?? []);
      expect(new Set(drawings.map((drawing) => drawing.drawingNodeId)).size).toBe(24);
      expect(again.pages).toEqual(moved.result.pages);
      expect(moved.passes).toBeLessThanOrEqual(ordinary.passes);
      if (reflow === 4) expect(moved.result.pages).toEqual(ordinary.result.pages);
    }
  }, 60_000);

  test('lays an edit out as a fresh layout of the edited document', () => {
    const session = createLayoutSession();
    const limited = <T>(run: () => T): T => {
      const restore = limitExclusionPassesForTest(6, 8);
      try {
        return run();
      } finally {
        restore();
      }
    };
    limited(() => layout(part, 1, session));
    const edited = withLongerText(part, 20);
    const edit = limited(() => countPasses(() => layout(edited, 2, session)));
    const fresh = limited(() => countPasses(() => layout(edited, 2)));
    expect(edit.result.pages).toEqual(fresh.result.pages);
  }, 60_000);
});
