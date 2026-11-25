// A drawing group (`wpg:wgp`, CT_WordprocessingGroup; ECMA-376 Part 1, 20.4.2.39) paints each member
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
  settle,
} from './image-decode-harness.ts';
import { observeUnsupportedElements, type UnsupportedElement } from '../index.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import {
  furnitureHasHiddenWrap,
  type ContinuedPageFurniture,
} from '../../layout/furniture-drawing-exclusion.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import { hitAnchoredDrawingAtPoint } from '../../layout/semantic-hit-test.ts';
import { drawingPaintsPastBox } from '../../layout/vector-shape-hit.ts';
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
  /** Children of `pic:spPr` after the geometry, such as an outline. */
  readonly frame?: string;
}

/** A 100pt x 50pt picture at (x, y) points in the group. */
function picture(x: number, y: number, options: PictureOptions = {}): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="${options.rel ?? 'rIdPng'}">${options.blipChildren ?? ''}` +
    '</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm${options.xfrmAttributes ?? ''}><a:off x="${x * PT}" y="${y * PT}"/>` +
    `<a:ext cx="${100 * PT}" cy="${50 * PT}"/></a:xfrm>` +
    (options.geometry === 'none'
      ? ''
      : `<a:prstGeom prst="${options.geometry ?? 'rect'}"><a:avLst/></a:prstGeom>`) +
    `${options.frame ?? ''}</pic:spPr></pic:pic>`
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
function docx(members: string, body?: string): Uint8Array {
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
        (body ?? `<w:p>${drawing}<w:r><w:t>Title</w:t></w:r></w:p>`) +
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

  // A turned member paints whole. A picture at the top edge of the group
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

// The frame of a picture member is its fill and outline (`a:ln`, CT_LineProperties; Part 1,
// 20.1.2.2.24). It turns with the picture, and paints whole past the group extent.
describe('the outline of a picture member', () => {
  const OUTLINE = '<a:ln w="38100"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>';

  test('a turned picture paints its outline whole, past the group extent', async () => {
    const members = picture(0, 0, { xfrmAttributes: ' rot="1800000"', frame: OUTLINE });
    await withMounted(docx(members), (surface, container) => {
      const record = groupRecord(surface);
      expect(record.vectorShape?.overflowVisible).toBe(true);
      const outer = container.querySelector<HTMLElement>('.docx-drawing-ready')!;
      const insets = /inset\((.+)\)/.exec(outer.style.clipPath)![1]!.split(' ').map(parseFloat);
      // Corners of the turned picture reach 21.65pt above the extent and 5.80pt to the left.
      // The outline is 3pt wide, so its ink reaches 1.5pt further.
      expect(insets[0]!).toBeLessThanOrEqual(-23.1);
      expect(insets[3]!).toBeLessThanOrEqual(-7.3);
    });
  });

  test('an upright picture keeps its outline in the group extent', async () => {
    await withMounted(docx(picture(0, 0, { frame: OUTLINE })), (surface) => {
      expect(groupRecord(surface).vectorShape?.overflowVisible).toBeUndefined();
    });
  });

  test('an outline with no geometry does not paint, and the report names the member', async () => {
    const members = picture(0, 0, { geometry: 'none', frame: OUTLINE }) + bar(0, 90, '111111');
    await withMounted(docx(members), (surface, container) => {
      expect(groupRecord(surface).groupMembersNotShown).toBe(1);
      expect(layersOf(container).length).toBeGreaterThan(0);
    });
  });

  test('a picture with no geometry and no frame is not reported', async () => {
    const members = picture(0, 0, { geometry: 'none' }) + bar(0, 90, '111111');
    await withMounted(docx(members), (surface) => {
      expect(groupRecord(surface).groupMembersNotShown).toBeUndefined();
    });
  });
});

// A member is not cut at the group extent. A member that reaches past the extent paints whole,
// in the editor as in PDF.
describe('a member that reaches past the group extent', () => {
  const insetsOf = (element: HTMLElement) =>
    /inset\((.+)\)/.exec(element.style.clipPath)![1]!.split(' ').map(parseFloat);

  test('a bar past the right edge paints whole', async () => {
    // The bar runs from 350pt to 450pt in a group 400pt wide.
    await withMounted(docx(bar(350, 20, '111111')), (surface, container) => {
      expect(groupRecord(surface).vectorShape?.overflowVisible).toBe(true);
      const outer = container.querySelector<HTMLElement>('.docx-drawing')!;
      expect(insetsOf(outer)[1]!).toBeLessThanOrEqual(-50);
    });
  });

  test('a bar inside the extent keeps the group clip', async () => {
    await withMounted(docx(bar(100, 20, '111111')), (surface) => {
      expect(groupRecord(surface).vectorShape?.overflowVisible).toBeUndefined();
    });
  });

  test('an upright picture past the left edge paints whole', async () => {
    await withMounted(docx(picture(-50, 20)), (_surface, container) => {
      const outer = container.querySelector<HTMLElement>('.docx-drawing-ready')!;
      expect(insetsOf(outer)[3]!).toBeLessThanOrEqual(-50);
      const [frame] = layersOf(container);
      expect(frame!.style.clipPath).toBe('');
    });
  });

  test('an upright picture inside the extent keeps the outer box closed', async () => {
    await withMounted(docx(picture(0, 20)), (_surface, container) => {
      const outer = container.querySelector<HTMLElement>('.docx-drawing-ready')!;
      expect(outer.style.clipPath).not.toContain('inset(');
    });
  });

  test('a turned picture does not cut a bar that reaches past the extent', async () => {
    const members =
      picture(150, 140, { xfrmAttributes: ' rot="2700000"' }) + bar(350, 20, '111111');
    await withMounted(docx(members), (_surface, container) => {
      const outer = container.querySelector<HTMLElement>('.docx-drawing-ready')!;
      expect(insetsOf(outer)[1]!).toBeLessThanOrEqual(-50);
      const vector = Array.from(
        outer.querySelectorAll<HTMLElement>('.docx-drawing-image-frame')
      ).filter((frame) => frame.querySelector('svg'));
      expect(vector.length).toBeGreaterThan(0);
      // The vector frame is cut at the ink of the vector members, 50pt past the right edge.
      for (const frame of vector) expect(insetsOf(frame)[1]!).toBeLessThanOrEqual(-50);
    });
  });
});

// A picture whose image cannot paint is a member that the group paints without.
describe('a picture of a group that cannot paint', () => {
  const SHAPES_AND_PICTURES =
    bar(0, 0, '111111') + picture(0, 20) + picture(150, 60, { rel: 'rIdGif' });
  const failAll: ImageDecodePort = Object.freeze({
    async decode() {
      throw new Error('decode failed');
    },
  }) as ImageDecodePort;

  async function partial(port?: ImageDecodePort): Promise<UnsupportedElement[]> {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(SHAPES_AND_PICTURES), {
      scale: 1,
      imageDecodePort: port ?? portFailing('none'),
      unsupportedElementRules: [{ includePartial: true }],
    });
    if (!opened.ok) throw new Error(opened.reason);
    await settle();
    let elements: UnsupportedElement[] = [];
    const stop = observeUnsupportedElements(container, (hosts) => {
      elements = hosts.map((host) => host.unsupported);
    });
    stop();
    opened.surface.destroy();
    container.remove();
    return elements;
  }

  test('the editor offers the group as partial', async () => {
    const elements = await partial(failAll);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.support).toBe('partial');
    expect(elements[0]!.drawingIssues).toEqual([
      expect.objectContaining({ code: 'projection-diagnostic', detail: 'group-member-not-shown' }),
    ]);
  });

  test('one failed picture of two also makes the group partial', async () => {
    expect(await partial(portFailing('image/gif'))).toHaveLength(1);
  });

  test('a group whose pictures all paint is not offered', async () => {
    expect(await partial()).toEqual([]);
  });

  /** Whether layout treats the group, as a wrapping header drawing, as a placeholder. */
  const placeholderWrap = (surface: PaginatedSurface): boolean =>
    furnitureHasHiddenWrap(undefined, {
      header: { anchoredDrawings: [{ ...groupRecord(surface), wrap: 'square' }] },
    } as unknown as ContinuedPageFurniture);

  test('a group that still paints its shapes keeps its wrap zone on a layout retry', async () => {
    await withMounted(
      docx(SHAPES_AND_PICTURES),
      (s) => expect(placeholderWrap(s)).toBe(false),
      failAll
    );
  });

  test('a group with only failed pictures is a placeholder on a layout retry', async () => {
    const pictures = picture(0, 20) + picture(150, 60, { rel: 'rIdGif' });
    await withMounted(docx(pictures), (s) => expect(placeholderWrap(s)).toBe(true), failAll);
  });
});

// A press on a picture that paints past the group extent selects the group.
test('a press on a picture outside the group extent hits the group', async () => {
  // The picture runs from 50pt left of the group to 50pt inside it, 20pt under its top.
  await withMounted(docx(picture(-50, 20)), (surface) => {
    const drawings = surface.layout().pages[0]!.anchoredDrawings;
    const group = groupRecord(surface).hitBounds;
    const hit = (dx: number, dy: number) =>
      hitAnchoredDrawingAtPoint(drawings, { x: group.x + dx, y: group.y + dy }, 0);
    expect(hit(-30, 40)).not.toBeNull();
    // Left of the picture, and above it beside the group, nothing is hit.
    expect(hit(-60, 40)).toBeNull();
    expect(hit(-30, 10)).toBeNull();
    expect(hit(-30, 80)).toBeNull();
    // The pointer path asks for drawings that paint past their box.
    expect(drawingPaintsPastBox(groupRecord(surface))).toBe(true);
  });
  // A mirrored picture has the other corner order.
  await withMounted(docx(picture(-50, 20, { xfrmAttributes: ' flipH="1"' })), (surface) => {
    const group = groupRecord(surface).hitBounds;
    const drawings = surface.layout().pages[0]!.anchoredDrawings;
    const at = (dx: number, dy: number) => ({ x: group.x + dx, y: group.y + dy });
    expect(hitAnchoredDrawingAtPoint(drawings, at(-30, 40), 0)).not.toBeNull();
    expect(hitAnchoredDrawingAtPoint(drawings, at(-30, 10), 0)).toBeNull();
  });
  await withMounted(docx(picture(0, 20)), (surface) => {
    expect(drawingPaintsPastBox(groupRecord(surface))).toBe(false);
  });
});

// A table cell still cuts a member that paints past the group extent.
describe('a group that a table cell cuts', () => {
  /** An inline group, 400pt wide, in a fixed cell 200pt wide. */
  function inCell(members: string): Uint8Array {
    const cx = 400 * PT;
    const cy = 100 * PT;
    const drawing =
      '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Group 1"/>` +
      `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
      `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/>` +
      `<a:chOff x="0" y="0"/><a:chExt cx="${cx}" cy="${cy}"/></a:xfrm>` +
      `</wpg:grpSpPr>${members}</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const cell = (content: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
    return docx(
      members,
      '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr>' +
        `${cell(`<w:p>${drawing}</w:p>`)}${cell('<w:p><w:r><w:t>Next</w:t></w:r></w:p>')}` +
        '</w:tr></w:tbl><w:p/>'
    );
  }
  const insetsOf = (element: HTMLElement) =>
    /inset\((.+)\)/.exec(element.style.clipPath)![1]!.split(' ').map(parseFloat);

  test('a picture above the extent stays cut at the cell edge', async () => {
    await withMounted(inCell(picture(250, -5)), (_surface, container) => {
      const outer = container.querySelector<HTMLElement>('.docx-drawing-ready')!;
      const [top, right] = insetsOf(outer);
      // The clip opens above the extent, and not past the cell edge on the right.
      expect(top!).toBeLessThanOrEqual(-5);
      expect(right!).toBeGreaterThanOrEqual(0);
    });
  });

  test('a turned picture stays cut at the cell edge', async () => {
    const members = picture(150, 20, { xfrmAttributes: ' rot="1800000"' });
    await withMounted(inCell(members), (_surface, container) => {
      const outer = container.querySelector<HTMLElement>('.docx-drawing-ready')!;
      const match = /inset\((.+)\)/.exec(outer.style.clipPath);
      if (match) expect(parseFloat(match[1]!.split(' ')[1]!)).toBeGreaterThanOrEqual(0);
      // With no widened clip, the outer box cuts at its paint bounds.
      else expect(outer.style.overflow).not.toBe('visible');
    });
  });

  test('the text of a group stays cut at the cell edge when a member reaches past', async () => {
    const textbox =
      '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>' +
      `<a:xfrm><a:off x="${150 * PT}" y="${40 * PT}"/><a:ext cx="${200 * PT}" cy="${40 * PT}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></wps:spPr>' +
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Text box text here</w:t></w:r></w:p>' +
      '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>';
    await withMounted(inCell(bar(20, -5, '2040C0') + textbox), (_surface, container) => {
      const layer = container.querySelector<HTMLElement>('.docx-drawing-group-text')!;
      expect(layer.style.overflow).toBe('visible');
      const [top, right] = insetsOf(layer);
      expect(top!).toBeLessThan(-1000);
      expect(right!).toBe(0);
    });
  });
});
