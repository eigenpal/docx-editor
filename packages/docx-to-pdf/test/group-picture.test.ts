/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf, PdfFidelityError, type PdfDiagnostic } from '../src/index.ts';
import { formatDefaultsDocx as docx } from './fixture.ts';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
const BMP_1X1 = Uint8Array.from(
  atob('Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAATCwAAEwsAAAAAAAAAAAAA////AA=='),
  (c) => c.charCodeAt(0)
);
const IMAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function pictureMember(y: number, x = 0, blip = '<a:blip r:embed="rIdImg"/>'): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1270000" cy="635000"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
  );
}

const BAR_MEMBER =
  '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="0" y="1270000"/><a:ext cx="1270000" cy="12700"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>';

/** The red bar, 1pt high, 100pt under the group top, in the group's own space. */
const BAR_COMMANDS = '1 0 0 rg\n0 100 m 100 100 l 100 101 l 0 101 l h\nf*';

interface GroupInput {
  /** Wrap the drawing in `mc:AlternateContent`, as Word does. Defaults to true. */
  readonly alternateContent?: boolean;
  readonly relationships?: string;
  /** The bytes of `word/media/image1.png`, or null to leave the part out. */
  readonly media?: Uint8Array | null;
  /** Replaces `wp:wrapNone`; a wrapping mode also puts the group in front of the text. */
  readonly wrap?: string;
  /** Paragraphs after the anchor paragraph. */
  readonly bodyLines?: number;
}

/** Move the picture to a valid BMP part: ready in the editor, but not embeddable in PDF. */
function withBmpPicture(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  delete files['word/media/image1.png'];
  files['word/media/image1.bmp'] = BMP_1X1;
  const rels = strFromU8(files['word/_rels/document.xml.rels']!);
  files['word/_rels/document.xml.rels'] = strToU8(rels.replace('image1.png', 'image1.bmp'));
  const types = strFromU8(files['[Content_Types].xml']!);
  files['[Content_Types].xml'] = strToU8(
    types.replace('<Default', '<Default Extension="bmp" ContentType="image/bmp"/><Default')
  );
  return zipSync(files);
}

const NAMESPACES = `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
      xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
      xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
      xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
      xmlns:v="urn:schemas-microsoft-com:vml"`;

/** A page-anchored group at (72pt, 72pt), 100pt x 200pt, behind the text. */
function input(members: string, options: GroupInput = {}): Uint8Array {
  const drawing = `<w:drawing>
      <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1"
        behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>
      <wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>
      <wp:extent cx="1270000" cy="2540000"/><wp:wrapNone/><wp:docPr id="1" name="Group"/>
      <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
      <wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>
      <a:ext cx="1270000" cy="2540000"/><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="2540000"/>
      </a:xfrm></wpg:grpSpPr>${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor>
      </w:drawing>`;
  const run =
    options.alternateContent === false
      ? `<w:r>${drawing.replace('<w:drawing>', `<w:drawing ${NAMESPACES}>`)}</w:r>`
      : `<w:r><mc:AlternateContent ${NAMESPACES}><mc:Choice Requires="wpg">${drawing}</mc:Choice>
      <mc:Fallback><w:pict><v:group id="Group"/></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
  const media = options.media === undefined ? PNG_1X1 : options.media;
  const wrapped = options.wrap
    ? run.replace('<wp:wrapNone/>', options.wrap).replace('behindDoc="1"', 'behindDoc="0"')
    : run;
  const body = '<w:p><w:r><w:t>Line</w:t></w:r></w:p>'.repeat(options.bodyLines ?? 0);
  return docx(`<w:p>${wrapped}<w:r><w:t>Text</w:t></w:r></w:p>${body}`, {
    'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      options.relationships ??
      `<Relationship Id="rIdImg" Type="${IMAGE_RELATIONSHIP}" Target="media/image1.png"/>`
    }</Relationships>`,
    ...(media ? { 'word/media/image1.png': media } : {}),
  });
}

async function pageCommands(
  bytes: Uint8Array,
  fidelityPolicy: 'strict' | 'best-effort' = 'strict',
  diagnostics: readonly Partial<PdfDiagnostic>[] = []
) {
  const result = await exportPdf(bytes, { useSystemFonts: false, fidelityPolicy });
  expect(result.diagnostics).toEqual(diagnostics.map((d) => expect.objectContaining(d)));
  const pdf = await PDFDocument.load(result.bytes);
  const resources = pdf.getPage(0).node.Resources()!;
  const images = resources.lookup(PDFName.of('XObject'), PDFDict);
  const commands = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) =>
      value instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(value).decode())]
        : []
    )
    .filter((text) => text.includes(' Do Q') || text.includes(' rg'))
    .join('\n');
  return { imageCount: images?.keys().length ?? 0, commands, pageCount: result.pageCount };
}

async function refusedGroupCommands(bytes: Uint8Array, message: string) {
  const diagnostic = { code: 'drawing', severity: 'unsupported', message } as const;
  const error = await exportPdf(bytes, { useSystemFonts: false }).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(PdfFidelityError);
  expect((error as PdfFidelityError).diagnostics).toEqual([expect.objectContaining(diagnostic)]);
  return pageCommands(bytes, 'best-effort', [diagnostic]);
}

test('a group picture paints in its member frame, under the vector members', async () => {
  const { imageCount, commands } = await pageCommands(input(pictureMember(0) + BAR_MEMBER));
  expect(imageCount).toBe(1);
  // Clipped to the 100pt x 200pt group at (72pt, 72pt) on the 792pt page, then to its own
  // frame; the image fills only the 100pt x 50pt picture member at the top of the group.
  expect(commands).toMatch(
    /q 72 720 m 172 720 l 172 520 l 72 520 l h W n 72 720 m 172 720 l 172 670 l 72 670 l h W n 100 0 0 50 72 670 cm \/Im\d+ Do Q/
  );
  const image = commands.search(/\/Im\d+ Do/);
  const bar = commands.indexOf('1 0 0 rg');
  expect(image).toBeGreaterThan(-1);
  expect(bar).toBeGreaterThan(image);
});

test('a group with only a picture paints it at its offset inside the group', async () => {
  const { imageCount, commands } = await pageCommands(input(pictureMember(635000)));
  expect(imageCount).toBe(1);
  // The member starts 50pt below the group top: PDF y = 792 - 72 - 50 - 50.
  expect(commands).toMatch(/100 0 0 50 72 620 cm \/Im\d+ Do Q/);
});

const PLAIN_TEXTBOX_MEMBER =
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="1905000"/>' +
  '<a:ext cx="1270000" cy="635000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r>' +
  '<w:t>Label</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>';

test('a group with two pictures paints both in order, with their crops, under the vector members', async () => {
  const cropped = pictureMember(
    635000,
    0,
    '<a:blip r:embed="rIdImg2"/><a:srcRect t="20000" b="5000"/>'
  );
  const bytes = input(PLAIN_TEXTBOX_MEMBER + pictureMember(0) + cropped + BAR_MEMBER, {
    relationships:
      `<Relationship Id="rIdImg" Type="${IMAGE_RELATIONSHIP}" Target="media/image1.png"/>` +
      `<Relationship Id="rIdImg2" Type="${IMAGE_RELATIONSHIP}" Target="media/image1.png"/>`,
  });
  const { imageCount, commands } = await pageCommands(bytes);
  expect(imageCount).toBe(1);
  // The first picture fills its 100pt x 50pt member at the top of the group.
  const first = commands.search(/100 0 0 50 72 670 cm \/Im\d+ Do Q/);
  // The second sits 50pt lower. Its 20% top and 5% bottom crop stretch the image to
  // 50 / 0.75 points and move it down by 5% of that height.
  const second = commands.search(/100 0 0 66\.66\d* 72 616\.66\d* cm \/Im\d+ Do Q/);
  const bar = commands.indexOf('1 0 0 rg');
  expect(first).toBeGreaterThan(-1);
  expect(second).toBeGreaterThan(first);
  expect(bar).toBeGreaterThan(second);
  // The text box member keeps its text.
  expect(commands).toContain('/ActualText <FEFF004c006100620065006c>');
});

test('an MC-wrapped group whose second picture is missing paints its other members', async () => {
  const second = pictureMember(635000, 0, '<a:blip r:embed="rIdMissing"/>');
  const bytes = input(pictureMember(0) + second + BAR_MEMBER, {
    relationships:
      `<Relationship Id="rIdImg" Type="${IMAGE_RELATIONSHIP}" Target="media/image1.png"/>` +
      `<Relationship Id="rIdMissing" Type="${IMAGE_RELATIONSHIP}" Target="media/none.png"/>`,
  });
  // Strict export still refuses the missing picture. Best-effort export leaves it out.
  const { imageCount, commands } = await refusedGroupCommands(
    bytes,
    'Image has no validated raster bytes'
  );
  expect(imageCount).toBe(1);
  // Only the first picture paints, in its member frame at the top of the group.
  expect(commands.match(/\/Im\d+ Do/g)).toHaveLength(1);
  const first = commands.search(/100 0 0 50 72 670 cm \/Im\d+ Do Q/);
  const bar = commands.indexOf(BAR_COMMANDS);
  expect(first).toBeGreaterThan(-1);
  expect(bar).toBeGreaterThan(first);
});

const LINKED = {
  relationships: `<Relationship Id="rIdLink" Type="${IMAGE_RELATIONSHIP}" Target="https://example.invalid/a.png" TargetMode="External"/>`,
  media: null,
} as const;
const LINKED_PICTURE = pictureMember(0, 0, '<a:blip r:link="rIdLink"/>');

// A picture that cannot paint is left out. Strict PDF export refuses the omission;
// best-effort export reports it and paints the other members.
for (const [name, picture, options] of [
  ['linked', LINKED_PICTURE, LINKED],
  ['missing', pictureMember(0), { media: null }],
  ['corrupt', pictureMember(0), { media: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) }],
] as const) {
  test(`an MC-wrapped group with a ${name} picture refuses strict export and paints its vector member`, async () => {
    for (const [members, bars] of [
      [picture, 0],
      [picture + BAR_MEMBER, 1],
    ] as const) {
      const { imageCount, commands } = await refusedGroupCommands(
        input(members, options),
        'Image has no validated raster bytes'
      );
      expect(imageCount).toBe(0);
      expect(commands).not.toMatch(/\/Im\d+ Do/);
      expect(commands.split(BAR_COMMANDS)).toHaveLength(bars + 1);
    }
  });
}

test('an MC-wrapped group leaves out a picture PDF cannot embed, with a notice', async () => {
  const notice = {
    code: 'drawing',
    severity: 'information' as const,
    message: 'Group picture left out: picture format not embeddable: image/bmp',
  };
  for (const [members, bars] of [
    [pictureMember(0), 0],
    [pictureMember(0) + BAR_MEMBER, 1],
  ] as const) {
    const { imageCount, commands } = await pageCommands(withBmpPicture(input(members)), 'strict', [
      notice,
    ]);
    expect(imageCount).toBe(0);
    expect(commands).not.toMatch(/\/Im\d+ Do/);
    // The vector member still paints.
    expect(commands.split(BAR_COMMANDS)).toHaveLength(bars + 1);
  }
});

test('a bare group whose picture cannot paint refuses strict export and paints its vector member', async () => {
  const bareGroup = (media?: null) =>
    input(pictureMember(0) + BAR_MEMBER, { alternateContent: false, media });
  for (const [bare, message] of [
    [bareGroup(null), 'Image has no validated raster bytes'],
    [withBmpPicture(bareGroup()), 'Unsupported PDF image format: image/bmp'],
  ] as const) {
    const { imageCount, commands } = await refusedGroupCommands(bare, message);
    // The picture is left out; the vector member paints without it.
    expect(imageCount).toBe(0);
    expect(commands).not.toMatch(/\/Im\d+ Do/);
    expect(commands.split(BAR_COMMANDS)).toHaveLength(2);
  }
});

test('a group member outside the bound is left out, and strict export refuses', async () => {
  const farBar = BAR_MEMBER.replace(
    '<a:off x="0" y="1270000"/>',
    '<a:off x="999999999999999" y="0"/>'
  );
  const cases = [
    input(pictureMember(0, 999_999_999_999_999) + BAR_MEMBER),
    input(pictureMember(0, 12_700 * 1_000_001) + BAR_MEMBER),
    input(pictureMember(0) + farBar),
    input(pictureMember(0, 999_999_999_999_999) + BAR_MEMBER, { alternateContent: false }),
  ];
  for (const bytes of cases) {
    // The member out of bounds is left out, and strict export refuses the lost content.
    await refusedGroupCommands(bytes, 'Shape group paints without 1 of its members');
  }
});

/** A member that paint cannot represent. Alone in a group, the group paints nothing. */
const FRAME_MEMBER =
  '<wpg:graphicFrame><wpg:cNvPr id="9" name="Frame"/><wpg:cNvFrPr/><wpg:xfrm>' +
  '<a:off x="0" y="0"/><a:ext cx="100" cy="100"/></wpg:xfrm></wpg:graphicFrame>';

test('an unsupported MC group keeps its wrap band and reports omitted content', async () => {
  for (const [wrap, pageCount] of [
    [undefined, 1],
    ['<wp:wrapTopAndBottom/>', 2],
  ] as const) {
    const bytes = input(FRAME_MEMBER, { bodyLines: 46, wrap });
    const {
      imageCount,
      commands,
      pageCount: actualPages,
    } = await refusedGroupCommands(bytes, 'Unsupported drawing: group');
    expect(imageCount).toBe(0);
    expect(commands).not.toContain('1 0 0 rg');
    expect(actualPages).toBe(pageCount);
  }
});
