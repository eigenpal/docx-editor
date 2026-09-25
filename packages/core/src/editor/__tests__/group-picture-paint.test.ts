// A drawing group whose picture member sits behind the text on page 1, as a scanned
// letterhead does, with vector bars drawn over it. The group used to paint nothing, so the
// letterhead vanished from the page. This mounts real bytes, reads the laid-out record and
// the painted DOM, edits the anchor paragraph, and checks the group survives save and reopen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  mountWithImages,
} from './image-decode-harness.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';
const EMU_PER_POINT = 12_700;

function pictureMember(y: number): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:off x="0" y="${y}"/><a:ext cx="6350000" cy="1270000"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
  );
}

const BAR_MEMBER =
  '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="1270000" y="3810000"/><a:ext cx="2540000" cy="12700"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="000000"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>';

/** A page-anchored, behind-text group at (36pt, 18pt), 500pt x 600pt, in EMU child space. */
function groupRun(members: string): string {
  return (
    '<w:r><mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="10" ' +
    'behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>228600</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="6350000" cy="7620000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6350000" cy="7620000"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="6350000" cy="7620000"/></a:xfrm></wpg:grpSpPr>' +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>` +
    '<mc:Fallback><w:pict><v:group id="Group 1"/></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

function docx(members: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS} xmlns:wpg="${WPG}" xmlns:mc="${MC}" xmlns:v="${V}" ` +
        'mc:Ignorable=""><w:body>' +
        `<w:p>${groupRun(members)}<w:r><w:t>Title</w:t></w:r></w:p>` +
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

function groupRecord(surface: PaginatedSurface): AnchoredDrawingRecord | undefined {
  return surface.layout().pages[0]!.anchoredDrawings?.[0];
}

function boundsOf(points: readonly { readonly x: number; readonly y: number }[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

async function withMounted(
  bytes: Uint8Array,
  run: (surface: PaginatedSurface, container: HTMLElement) => Promise<void> | void
): Promise<void> {
  const { surface, container } = await mountWithImages(bytes);
  try {
    await run(surface, container);
  } finally {
    surface.destroy();
    container.remove();
  }
}

describe('a drawing group with a picture member', () => {
  test('lays out the picture in its member frame and paints it under the vector members', async () => {
    await withMounted(docx(pictureMember(0) + BAR_MEMBER), (surface, container) => {
      const record = groupRecord(surface)!;
      expect(record.groupPicture).toBe(true);
      expect(record.resource.kind).toBe('ready');
      // Still a non-picture graphic, as a vector shape is: image commands must not offer it.
      expect(record.placeholderGraphicKind).toBe('graphic');
      expect(record.vectorShape?.components).toHaveLength(1);
      // The drawing frame is the whole group; the image fills only the picture member.
      const content = record.geometry.contentBounds;
      expect(content.width).toBeCloseTo(500);
      expect(content.height).toBeCloseTo(600);
      const image = boundsOf(record.geometry.imageTransformCorners!);
      expect(image.x).toBeCloseTo(content.x);
      expect(image.y).toBeCloseTo(content.y);
      expect(image.width).toBeCloseTo(6_350_000 / EMU_PER_POINT);
      expect(image.height).toBeCloseTo(1_270_000 / EMU_PER_POINT);

      const painted = container.querySelector<HTMLElement>('.docx-drawing-ready')!;
      expect(painted).not.toBeNull();
      expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
      const frames = painted.querySelectorAll<HTMLElement>('.docx-drawing-image-frame');
      expect(frames).toHaveLength(2);
      // Image first, then the SVG of the vector members over it.
      expect(frames[0]!.querySelector('img')).not.toBeNull();
      expect(frames[0]!.style.height).toBe(`${100}px`);
      expect(frames[1]!.querySelector('svg path')?.getAttribute('fill')).toBe('#000000');
      expect(frames[1]!.style.height).toBe(`${600}px`);
    });
  });

  test('keeps the picture offset inside the group', async () => {
    await withMounted(docx(pictureMember(2_540_000)), (surface, container) => {
      const record = groupRecord(surface)!;
      expect(record.vectorShape).toBeNull();
      const image = boundsOf(record.geometry.imageTransformCorners!);
      expect(image.y - record.geometry.contentBounds.y).toBeCloseTo(200);
      const frame = container.querySelector<HTMLElement>(
        '.docx-drawing-ready .docx-drawing-image-frame'
      )!;
      expect(Number.parseFloat(frame.style.top)).toBeCloseTo(200);
    });
  });

  test('an edit beside the group keeps its source, and the saved file paints it again', async () => {
    let saved: Uint8Array | null = null;
    await withMounted(docx(pictureMember(0) + BAR_MEMBER), async (surface) => {
      const paragraphId = groupRecord(surface)!.anchorParagraphId;
      // One offset for the group atom, then the five characters of "Title".
      const end = { paragraphId, offset: 6 };
      surface.setSelection({ anchor: end, head: end });
      surface.type('!');
      expect(surface.state().lastRejection).toBeFalsy();
      saved = await surface.save();
    });
    const xml = strFromU8(unzipSync(saved!)['word/document.xml']!);
    expect(xml).toContain('Title!');
    expect(xml).toMatch(/<wpg:wgp>.*<pic:pic>.*r:embed="rIdImg".*<\/pic:pic><wps:wsp>/s);
    expect(xml).toContain('<mc:Fallback>');
    await withMounted(saved!, (surface, container) => {
      expect(groupRecord(surface)?.groupPicture).toBe(true);
      expect(container.querySelector('.docx-drawing-ready img')).not.toBeNull();
    });
  });

  test('a group with two pictures still paints nothing', async () => {
    await withMounted(docx(pictureMember(0) + pictureMember(2_540_000)), (surface, container) => {
      expect(groupRecord(surface)).toBeUndefined();
      expect(container.querySelectorAll('.docx-drawing')).toHaveLength(0);
    });
  });
});
