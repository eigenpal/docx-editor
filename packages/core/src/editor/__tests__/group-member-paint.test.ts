// A drawing group (`wpg:wgp`, CT_GroupShape; ECMA-376 Part 1, 20.1.2.2.20) paints each member
// that it can, in document order:
//
// - Shapes and pictures interleave: shape, picture, shape, picture, shape paints five layers
//   in that order.
// - A picture member that turns and mirrors (`a:xfrm`, CT_Transform2D; Part 1, 20.1.7.6) turns
//   about the centre of its own frame.
// - The geometry of a picture member (`a:prstGeom`, Part 1, 20.1.9.18) clips its picture.
// - `a:alphaModFix` (Part 1, 20.1.8.6) on the blip of a picture member makes that picture
//   translucent, and no other member.
// - A picture that fails to decode is left out. The other pictures and the shapes still
//   paint, and the group shows no placeholder.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  decodeBytes,
  mountWithImages,
} from './image-decode-harness.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import type { ImageDecodePort } from '../../store/package/image-resources.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

/** A second picture format, so a decode port can fail one picture and not the other. */
const GIF_1X1 = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0)
);

const PT = 12_700;

interface PictureOptions {
  readonly rel?: string;
  readonly xfrmAttributes?: string;
  readonly geometry?: string;
  readonly blipChildren?: string;
}

/** A 100pt x 50pt picture at (x, y) points in the group. */
function picture(x: number, y: number, options: PictureOptions = {}): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="${options.rel ?? 'rIdPng'}">${options.blipChildren ?? ''}` +
    '</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm${options.xfrmAttributes ?? ''}><a:off x="${x * PT}" y="${y * PT}"/>` +
    `<a:ext cx="${100 * PT}" cy="${50 * PT}"/></a:xfrm>` +
    `<a:prstGeom prst="${options.geometry ?? 'rect'}"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
  );
}

/** A 100pt x 10pt bar at (x, y) points in the group, filled with `hex`. */
function bar(x: number, y: number, hex: string): string {
  return (
    '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
    `<a:xfrm><a:off x="${x * PT}" y="${y * PT}"/><a:ext cx="${100 * PT}" cy="${10 * PT}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

/** A page-anchored group at (36pt, 18pt), 400pt x 200pt, with child space in EMU. */
function docx(members: string): Uint8Array {
  const cx = 400 * PT;
  const cy = 200 * PT;
  const drawing =
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="10" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>228600</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `</wpg:grpSpPr>${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Default Extension="gif" ContentType="image/gif"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rIdPng" Type="${IMG_REL}" Target="media/image1.png"/>` +
        `<Relationship Id="rIdGif" Type="${IMG_REL}" Target="media/image2.gif"/>` +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
    'word/media/image2.gif': GIF_1X1,
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS} xmlns:wpg="${WPG}"><w:body>` +
        `<w:p>${drawing}<w:r><w:t>Title</w:t></w:r></w:p>` +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

/** A decode port that fails every picture of one format. */
function portFailing(mime: string): ImageDecodePort {
  return Object.freeze({
    async decode(bytes: Uint8Array, format: string) {
      if (format === mime) throw new Error('decode failed');
      return Object.freeze({ ...decodeBytes(bytes, format), dpiX: 96, dpiY: 96 });
    },
  }) as ImageDecodePort;
}

async function withMounted(
  bytes: Uint8Array,
  run: (surface: PaginatedSurface, container: HTMLElement) => void,
  port?: ImageDecodePort
): Promise<void> {
  const { surface, container } = await mountWithImages(bytes, port);
  try {
    run(surface, container);
  } finally {
    surface.destroy();
    container.remove();
  }
}

function groupRecord(surface: PaginatedSurface): AnchoredDrawingRecord {
  const record = surface.layout().pages[0]!.anchoredDrawings?.[0];
  if (!record) throw new Error('no anchored drawing');
  return record;
}

/** The layers of the painted group, lowest first. */
function layersOf(container: HTMLElement): HTMLElement[] {
  expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
  const group = container.querySelector<HTMLElement>('.docx-drawing-ready');
  expect(group).not.toBeNull();
  return Array.from(group!.children).filter((child): child is HTMLElement =>
    child.classList.contains('docx-drawing-image-frame')
  );
}

/** `picture` for a picture layer, or the fill colour of a vector layer. */
function kindOf(layer: HTMLElement): string {
  if (layer.querySelector('img')) return 'picture';
  return layer.querySelector('svg path')?.getAttribute('fill') ?? 'empty';
}

const px = (value: string) => Number.parseFloat(value) || 0;

const stageOf = (layer: HTMLElement) =>
  layer.querySelector<HTMLElement>('.docx-drawing-transform-stage')!;

describe('the members of a drawing group', () => {
  test('shape, picture, shape, picture, shape paint five layers in that order', async () => {
    const members =
      bar(0, 0, '111111') +
      picture(0, 20) +
      bar(0, 40, '222222') +
      picture(150, 60, { rel: 'rIdGif' }) +
      bar(150, 100, '333333');
    await withMounted(docx(members), (surface, container) => {
      const record = groupRecord(surface);
      expect(record.resource.kind).toBe('ready');
      expect(record.groupPictureLayers?.map((layer) => layer.resource.kind)).toEqual(['ready']);
      expect(record.vectorShape?.components.map((c) => c.picturesBelow)).toEqual([0, 1, undefined]);
      expect(record.groupMembersNotShown).toBeUndefined();
      const layers = layersOf(container);
      expect(layers.map(kindOf)).toEqual(['#111111', 'picture', '#222222', 'picture', '#333333']);
      // Each picture keeps its own frame in the 400pt x 200pt group.
      const frames = [layers[1]!, layers[3]!].map((layer) => ({
        left: px(layer.style.left),
        top: px(layer.style.top),
        width: px(layer.style.width),
        height: px(layer.style.height),
      }));
      expect(frames).toEqual([
        { left: 0, top: 20, width: 100, height: 50 },
        { left: 150, top: 60, width: 100, height: 50 },
      ]);
    });
  });

  test('a turned and mirrored picture turns about the centre of its own frame', async () => {
    const turned = { xfrmAttributes: ' rot="5400000" flipH="1"' };
    // As the first picture of the group, and as a later one.
    for (const [members, index] of [
      [picture(150, 60, turned) + picture(0, 20, { rel: 'rIdGif' }), 0],
      [picture(0, 20, { rel: 'rIdGif' }) + picture(150, 60, turned), 1],
    ] as const) {
      await withMounted(docx(members), (_surface, container) => {
        const layers = layersOf(container);
        expect(layers.map(kindOf)).toEqual(['picture', 'picture']);
        const layer = layers[index]!;
        // The frame is the upright box of the member; the stage inside it mirrors, then turns.
        expect({ left: px(layer.style.left), top: px(layer.style.top) }).toEqual({
          left: 150,
          top: 60,
        });
        expect({ width: px(layer.style.width), height: px(layer.style.height) }).toEqual({
          width: 100,
          height: 50,
        });
        expect(stageOf(layer).style.transform).toBe('rotate(90deg) scaleX(-1)');
        expect(stageOf(layer).style.transformOrigin).toBe('50% 50%');
        // The other picture stays upright.
        expect(stageOf(layers[1 - index]!).style.transform).toBe('');
      });
    }
  });

  // A turned member paints whole, as Word paints it. A picture at the top edge of the group
  // reaches 25pt above the extent after a quarter turn, so the drawing does not clip there.
  test('a turned picture that reaches past the group extent is not cut', async () => {
    const turned = picture(150, 0, { xfrmAttributes: ' rot="5400000"' });
    for (const members of [turned, bar(0, 100, 'FF0000') + turned]) {
      await withMounted(docx(members), (_surface, container) => {
        const outer = layersOf(container)[0]!.parentElement!;
        expect(outer.style.overflow).toBe('visible');
        const inset = outer.style.clipPath.match(/^inset\((-?[\d.]+)px/);
        expect(inset).not.toBeNull();
        expect(Number(inset![1])).toBeCloseTo(-25, 3);
      });
    }
    // An upright picture keeps the clip of the paint box.
    await withMounted(docx(picture(150, 0)), (_surface, container) => {
      expect(layersOf(container)[0]!.parentElement!.style.overflow).toBe('hidden');
    });
  });

  test('a picture that only turns has no mirror, and one that only mirrors has no turn', async () => {
    const members =
      picture(0, 20, { xfrmAttributes: ' rot="2700000"' }) +
      picture(150, 60, { rel: 'rIdGif', xfrmAttributes: ' flipH="1"' });
    await withMounted(docx(members), (_surface, container) => {
      const [turned, mirrored] = layersOf(container);
      expect(stageOf(turned!).style.transform).toBe('rotate(45deg)');
      expect(stageOf(mirrored!).style.transform).toBe('rotate(0deg) scaleX(-1)');
    });
  });

  test('an ellipse picture member clips its picture, and a rectangle member does not', async () => {
    for (const [members, index] of [
      [picture(0, 20, { geometry: 'ellipse' }) + picture(150, 60, { rel: 'rIdGif' }), 0],
      [picture(0, 20, { rel: 'rIdGif' }) + picture(150, 60, { geometry: 'ellipse' }), 1],
    ] as const) {
      await withMounted(docx(members), (_surface, container) => {
        const layers = layersOf(container);
        expect(layers.map(kindOf)).toEqual(['picture', 'picture']);
        const clip = stageOf(layers[index]!).style.clipPath;
        expect(clip).toMatch(/^polygon\(/);
        // The ring is in percent of the picture's own frame and touches its four sides.
        const points = Array.from(clip.matchAll(/(-?[\d.e-]+)% (-?[\d.e-]+)%/g), (match) => ({
          x: Number(match[1]),
          y: Number(match[2]),
        }));
        expect(points.length).toBeGreaterThanOrEqual(8);
        expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(0, 6);
        expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(100, 6);
        expect(Math.min(...points.map((point) => point.y))).toBeCloseTo(0, 6);
        expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(100, 6);
        // The clip of one member does not reach the other picture.
        expect(stageOf(layers[1 - index]!).style.clipPath).toBe('');
      });
    }
  });

  test('a:alphaModFix makes its own picture translucent, and no other member', async () => {
    const alpha = { blipChildren: '<a:alphaModFix amt="50000"/>' };
    for (const [members, index] of [
      [picture(0, 20, alpha) + picture(150, 60, { rel: 'rIdGif' }) + bar(0, 100, '111111'), 0],
      [picture(0, 20, { rel: 'rIdGif' }) + picture(150, 60, alpha) + bar(0, 100, '111111'), 1],
    ] as const) {
      await withMounted(docx(members), (_surface, container) => {
        const layers = layersOf(container);
        expect(layers.map(kindOf)).toEqual(['picture', 'picture', '#111111']);
        expect(layers[index]!.style.filter).toBe('opacity(0.5)');
        expect(layers[1 - index]!.style.filter).toBe('');
        expect(layers[2]!.style.filter).toBe('');
        expect(layers[2]!.style.opacity).toBe('');
        const group = container.querySelector<HTMLElement>('.docx-drawing-ready')!;
        expect(group.style.filter).toBe('');
        expect(group.style.opacity).toBe('');
      });
    }
  });
});

describe('a group picture that fails to decode', () => {
  // Bar, PNG picture, bar, GIF picture, bar.
  const MEMBERS =
    bar(0, 0, '111111') +
    picture(0, 20) +
    bar(0, 40, '222222') +
    picture(150, 60, { rel: 'rIdGif' }) +
    bar(150, 100, '333333');

  test('the first picture fails: the second picture and the shapes still paint', async () => {
    await withMounted(
      docx(MEMBERS),
      (surface, container) => {
        const record = groupRecord(surface);
        expect(record.resource).toMatchObject({ kind: 'unrenderable', reason: 'decode-failed' });
        expect(record.groupPictureLayers?.map((layer) => layer.resource.kind)).toEqual(['ready']);
        const layers = layersOf(container);
        // The failed picture has no layer. The second bar stays under the second picture.
        expect(layers.map(kindOf)).toEqual(['#111111', '#222222', 'picture', '#333333']);
        expect(px(layers[2]!.style.left)).toBe(150);
        expect(px(layers[2]!.style.top)).toBe(60);
        expect(container.querySelectorAll('.docx-drawing-ready img')).toHaveLength(1);
        expect(container.textContent).toContain('Title');
      },
      portFailing('image/png')
    );
  });

  test('a later picture fails: the first picture and the shapes still paint', async () => {
    await withMounted(
      docx(MEMBERS),
      (surface, container) => {
        const record = groupRecord(surface);
        expect(record.resource.kind).toBe('ready');
        expect(record.groupPictureLayers?.map((layer) => layer.resource)).toEqual([
          expect.objectContaining({ kind: 'unrenderable', reason: 'decode-failed' }),
        ]);
        const layers = layersOf(container);
        expect(layers.map(kindOf)).toEqual(['#111111', 'picture', '#222222', '#333333']);
        expect(px(layers[1]!.style.left)).toBe(0);
        expect(px(layers[1]!.style.top)).toBe(20);
        expect(container.querySelectorAll('.docx-drawing-ready img')).toHaveLength(1);
      },
      portFailing('image/gif')
    );
  });

  test('every picture fails: the shapes paint alone, with no placeholder', async () => {
    const failAll: ImageDecodePort = Object.freeze({
      async decode() {
        throw new Error('decode failed');
      },
    }) as ImageDecodePort;
    await withMounted(
      docx(MEMBERS),
      (_surface, container) => {
        expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
        expect(container.querySelectorAll('.docx-drawing img')).toHaveLength(0);
        const fills = Array.from(container.querySelectorAll('.docx-drawing svg path'), (path) =>
          path.getAttribute('fill')
        );
        expect(fills).toEqual(['#111111', '#222222', '#333333']);
      },
      failAll
    );
  });
});

// `a:biLevel` (Part 1, 20.1.8.11) is a blip colour effect that the projection keeps for each
// picture. Each picture paints with the effect of its own blip.
describe('a:biLevel on a group picture', () => {
  const BILEVEL = { blipChildren: '<a:biLevel thresh="50000"/>' };

  test('a later picture paints with its own black and white filter', async () => {
    const members = picture(0, 20, { rel: 'rIdGif' }) + picture(150, 60, BILEVEL);
    await withMounted(docx(members), (surface, container) => {
      expect(groupRecord(surface).groupPictureLayers?.[0]?.effects?.bilevel).toBe(0.5);
      const [first, second] = layersOf(container);
      expect(first!.style.filter).toBe('');
      expect(second!.style.filter).toMatch(/^url\(#docx-bilevel-\d+\)$/);
    });
  });

  test('the filter of a failed first picture does not move to the next picture', async () => {
    const members = picture(0, 20, BILEVEL) + picture(150, 60, { rel: 'rIdGif' });
    await withMounted(
      docx(members),
      (_surface, container) => {
        const layers = layersOf(container);
        expect(layers.map(kindOf)).toEqual(['picture']);
        expect(layers[0]!.style.filter).toBe('');
      },
      portFailing('image/png')
    );
  });
});
