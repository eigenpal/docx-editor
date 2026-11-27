// Turns of text-box stories: the math, and the walks that carry them to span geometry.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../../editor/paginated-surface.ts';
import { forEachSemanticSpan } from '../export-traversal.ts';
import { forEachPageStory, forEachStoryParagraphFragment } from '../semantic-record-queries.ts';
import { turnStoryBox, turnStoryPoint } from '../story-turns.ts';

describe('story turns', () => {
  test('no turn keeps the point and the box', () => {
    const box = { x: 1, y: 2, width: 3, height: 4 };
    expect(turnStoryBox(undefined, box)).toBe(box);
    expect(turnStoryPoint([], { x: 5, y: 6 })).toEqual({ x: 5, y: 6 });
  });

  test('a quarter turn about the centre swaps the axes of the box', () => {
    const turned = turnStoryBox([{ degrees: 90, pivot: { x: 50, y: 10 } }], {
      x: 0,
      y: 0,
      width: 100,
      height: 20,
    });
    expect(turned.x).toBeCloseTo(40, 6);
    expect(turned.y).toBeCloseTo(-40, 6);
    expect(turned.width).toBeCloseTo(20, 6);
    expect(turned.height).toBeCloseTo(100, 6);
  });

  test('turns apply innermost first, each about its own pivot', () => {
    // Inner: a half turn about (10, 0) carries (0, 0) to (20, 0). Outer: a quarter turn about
    // the origin then carries (20, 0) to (0, 20).
    const point = turnStoryPoint(
      [
        { degrees: 90, pivot: { x: 0, y: 0 } },
        { degrees: 180, pivot: { x: 10, y: 0 } },
      ],
      { x: 0, y: 0 }
    );
    expect(point.x).toBeCloseTo(0, 6);
    expect(point.y).toBeCloseTo(20, 6);
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS =
  `xmlns:w="${W}" xmlns:r="${R}" ` +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"';
const EMU = 12_700;

/** A 200 x 60pt shape with one text line, as a group member at (x, y) in child space. */
function member(vert: string, rot = 0): string {
  return (
    `<wps:wsp><wps:cNvPr id="3" name="Label"/><wps:cNvSpPr txBox="1"/><wps:spPr>` +
    `<a:xfrm${rot ? ` rot="${rot * 60_000}"` : ''}><a:off x="${50 * EMU}" y="${70 * EMU}"/>` +
    `<a:ext cx="${200 * EMU}" cy="${60 * EMU}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></wps:spPr>' +
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Turned label</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
    `<wps:bodyPr vert="${vert}" lIns="0" tIns="0" rIns="0" bIns="0"/></wps:wsp>`
  );
}

function docx(groupMember: string): Uint8Array {
  const group =
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0' +
    '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0' +
    `</wp:posOffset></wp:positionV><wp:extent cx="${300 * EMU}" cy="${200 * EMU}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="5" name="Group"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
    '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${300 * EMU}" cy="${200 * EMU}"/><a:chOff x="0" y="0"/>` +
    `<a:chExt cx="${300 * EMU}" cy="${200 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
    `${groupMember}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${NS}><w:body><w:p>${group}<w:r><w:t>Anchor</w:t></w:r></w:p>` +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
  });
}

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.surface.destroy();
    entry.container.remove();
  }
});

function layoutOf(bytes: Uint8Array) {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  mounted.push({ surface: opened.surface, container });
  return opened.surface.layout();
}

function labelSpans(bytes: Uint8Array) {
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  forEachSemanticSpan(layoutOf(bytes), (visit) => {
    if (visit.textboxDepth > 0 && visit.span.text.length > 0)
      boxes.push(turnStoryBox(visit.storyTurns, visit.absoluteBox));
  });
  return boxes;
}

describe('span geometry in turned group text', () => {
  test('vertical member text spans run down the page', () => {
    const [upright] = labelSpans(docx(member('horz')));
    const [vertical] = labelSpans(docx(member('vert')));
    expect(upright!.width).toBeGreaterThan(upright!.height);
    expect(vertical!.height).toBeGreaterThan(vertical!.width);
    // The turned run keeps its length.
    expect(vertical!.height).toBeCloseTo(upright!.width, 3);
  });

  test('a turned member carries its turn to the story context', () => {
    const turns: number[][] = [];
    const layout = layoutOf(docx(member('horz', 90)));
    for (const page of layout.pages) {
      forEachPageStory(page, (root) => {
        forEachStoryParagraphFragment(
          root.host,
          (_fragment, context) => {
            if (context.textboxDepth > 0)
              turns.push((context.storyTurns ?? []).map((turn) => turn.degrees));
          },
          root.origin
        );
      });
    }
    expect(turns).toEqual([[90]]);
  });
});
