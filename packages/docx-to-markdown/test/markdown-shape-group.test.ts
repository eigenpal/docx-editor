// A shape group with a picture member, such as a scanned letterhead with ruled lines over it,
// renders in the editor and in PDF export. Markdown keeps the group opaque: the picture is one
// member of the drawing, so extracting it alone would stand in for the whole group at the
// group's size and drop the other members without a trace.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { exportMarkdown, type MarkdownWarning } from '../src/index.ts';
import { imageDocx, picture, R } from './media-fixture.ts';

const fast = { measurer: createFixedMeasurer() };

const PICTURE_MEMBER =
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

const BAR_MEMBER =
  '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="0" y="1270000"/><a:ext cx="1270000" cy="12700"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>';

/** An MC-wrapped, page-anchored group of 100pt x 200pt with alternative text. */
function groupRun(members: string): string {
  return (
    '<w:r><mc:AlternateContent ' +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
    'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ' +
    `xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="${R}"><mc:Choice Requires="wpg"><w:drawing>` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1270000" cy="2540000"/><wp:wrapNone/>' +
    '<wp:docPr id="1" name="Group" descr="Letterhead"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
    '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
    '<a:ext cx="1270000" cy="2540000"/><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="2540000"/>' +
    `</a:xfrm></wpg:grpSpPr>${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor>` +
    '</w:drawing></mc:Choice><mc:Fallback><w:pict><v:group id="Group"/></w:pict></mc:Fallback>' +
    '</mc:AlternateContent></w:r>'
  );
}

const OMITTED: readonly MarkdownWarning[] = [
  {
    code: 'omitted-drawing',
    message: 'Images and shapes are omitted from Markdown.',
    pageNumber: 1,
  },
];

describe('a shape group with a picture member in Markdown', () => {
  for (const [name, members] of [
    ['picture and vector', PICTURE_MEMBER + BAR_MEMBER],
    ['picture-only', PICTURE_MEMBER],
  ] as const) {
    test(`a ${name} group is omitted as one drawing, with a warning`, async () => {
      const bytes = imageDocx(`<w:p>${groupRun(members)}<w:r><w:t>Text</w:t></w:r></w:p>`);
      for (const images of [false, true, { syntax: 'html' as const }]) {
        const result = await exportMarkdown(bytes, { ...fast, images });
        expect(result.markdown).toBe('Text');
        expect(result.media).toEqual([]);
        expect(result.warnings).toEqual(OMITTED);
      }
    });
  }

  test('a picture beside the group is still extracted', async () => {
    const bytes = imageDocx(
      `<w:p>${groupRun(PICTURE_MEMBER + BAR_MEMBER)}<w:r><w:t>Text</w:t></w:r></w:p>` +
        `<w:p><w:r>${picture(3, false, 'Logo')}</w:r></w:p>`
    );
    const result = await exportMarkdown(bytes, { ...fast, images: true });
    expect(result.media).toHaveLength(1);
    expect(result.media[0]!.occurrences).toHaveLength(1);
    expect(result.markdown).toContain('![Logo](');
    expect(result.markdown).not.toContain('![Letterhead]');
    expect(result.warnings).toEqual(OMITTED);
  });
});
