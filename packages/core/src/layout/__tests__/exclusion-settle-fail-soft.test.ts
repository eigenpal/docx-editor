// A wrap reflow that runs out of passes must still lay the document out. Before, it threw
// `DrawingExclusionConvergenceError`, nothing caught it for body text, and the document did not
// open. A chain of pictures that each wrap the text before the next one settles about one link
// per pass, so a long enough chain reaches the ceiling (#1803).

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { limitExclusionPassesForTest } from '../exclusion-layout-steps.ts';
import { refusalRetriesWithoutHiddenFurniture } from '../furniture-drawing-exclusion.ts';
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
 * the picture, so each paragraph's last lines wrap the next paragraph's picture.
 */
function pictureChain(count: number, sectionBreakAfter?: number): string {
  const paragraphs: string[] = [];
  const size = 90 * EMU_PER_PT;
  for (let index = 0; index < count; index += 1) {
    const id = index + 1;
    paragraphs.push(
      '<w:p><w:r><w:drawing>' +
        `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="${id}">` +
        '<wp:simplePos x="0" y="0"/>' +
        `<wp:positionH relativeFrom="column"><wp:posOffset>${(index % 3) * 150 * EMU_PER_PT}</wp:posOffset></wp:positionH>` +
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        `<wp:extent cx="${size}" cy="${size}"/>` +
        '<wp:wrapSquare wrapText="bothSides"/>' +
        `<wp:docPr id="${id}" name="pic ${id}"/>` +
        `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
        '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        `<pic:spPr><a:xfrm><a:ext cx="${size}" cy="${size}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
        '</wp:anchor></w:drawing></w:r>' +
        `<w:r><w:t>${'words of text '.repeat(22)}</w:t></w:r></w:p>`
    );
    // A balanced two-column section ends here, laid out by column-balance trials.
    if (index === sectionBreakAfter)
      paragraphs.push(
        '<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:cols w:num="2" w:space="720"/>' +
          '</w:sectPr></w:pPr></w:p>'
      );
  }
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${paragraphs.join('')}</w:body></w:document>`
  );
}

const part = load(pictureChain(24));
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

  test('lays each later edit out in one more pass', () => {
    const session = createLayoutSession();
    withPassLimits(() => layout(part, 1, session));
    let edited = part;
    for (const revision of [2, 3, 4]) {
      edited = withLongerText(edited, 20);
      const edit = withPassLimits(() => countPasses(() => layout(edited, revision, session)));
      // Not a seeded reflow to the limits and then a fresh one: one pass, as the previous
      // layout never settled.
      expect(edit.passes).toBe(1);
      expect(edit.result.pages.length).toBeGreaterThanOrEqual(3);
    }
  }, 60_000);

  test('refuses inside a column-balance trial, so the section still lays out', () => {
    const balanced = load(pictureChain(12, 5));
    const result = withPassLimits(() => layout(balanced));
    const drawings = result.pages.flatMap((page) => page.anchoredDrawings ?? []);
    expect(new Set(drawings.map((drawing) => drawing.drawingNodeId)).size).toBe(12);
  }, 60_000);

  test('never asks for the hidden-furniture retry from inside that retry', () => {
    // During the retry, a reflow that does not settle must publish: a refusal there escapes.
    expect(refusalRetriesWithoutHiddenFurniture({ yieldHiddenFurnitureZones: true })).toBe(false);
  });
});
