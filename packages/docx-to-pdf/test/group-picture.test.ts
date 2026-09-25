/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf, PdfFidelityError, type PdfDiagnostic } from '../src/index.ts';
import { docx } from './fixture.ts';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
const GIF_1X1 = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
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

interface GroupInput {
  /** Wrap the drawing in `mc:AlternateContent`, as Word does. Defaults to true. */
  readonly alternateContent?: boolean;
  readonly relationships?: string;
  /** The bytes of `word/media/image1.png`, or null to leave the part out. */
  readonly media?: Uint8Array | null;
}

/** Move the picture to a valid GIF part: ready in the editor, but not embeddable in PDF. */
function withGifPicture(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  delete files['word/media/image1.png'];
  files['word/media/image1.gif'] = GIF_1X1;
  const rels = strFromU8(files['word/_rels/document.xml.rels']!);
  files['word/_rels/document.xml.rels'] = strToU8(rels.replace('image1.png', 'image1.gif'));
  const types = strFromU8(files['[Content_Types].xml']!);
  files['[Content_Types].xml'] = strToU8(
    types.replace('<Default', '<Default Extension="gif" ContentType="image/gif"/><Default')
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
  return docx(`<w:p>${run}<w:r><w:t>Text</w:t></w:r></w:p>`, {
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
  return { imageCount: images?.keys().length ?? 0, commands };
}

test('a group picture paints in its member frame, under the vector members', async () => {
  const { imageCount, commands } = await pageCommands(input(pictureMember(0) + BAR_MEMBER));
  expect(imageCount).toBe(1);
  // Clipped to the 100pt x 200pt group at (72pt, 72pt) on the 792pt page; the image fills
  // only the 100pt x 50pt picture member at the top of the group.
  expect(commands).toMatch(
    /q 72 720 m 172 720 l 172 520 l 72 520 l h W n 100 0 0 50 72 670 cm \/Im\d+ Do Q/
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

test('a group with two pictures still exports no image', async () => {
  const { imageCount } = await pageCommands(input(pictureMember(0) + pictureMember(635000)));
  expect(imageCount).toBe(0);
});

const LINKED = {
  relationships: `<Relationship Id="rIdLink" Type="${IMAGE_RELATIONSHIP}" Target="https://example.invalid/a.png" TargetMode="External"/>`,
  media: null,
} as const;
const LINKED_PICTURE = pictureMember(0, 0, '<a:blip r:link="rIdLink"/>');

// Word stores groups in mc:AlternateContent. A group whose picture resource fails there is
// left out, like every MC payload the engine cannot draw, so the default strict export
// still succeeds and paints no part of the group.
for (const [name, picture, options] of [
  ['linked', LINKED_PICTURE, LINKED],
  ['missing', pictureMember(0), { media: null }],
  ['corrupt', pictureMember(0), { media: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) }],
] as const) {
  test(`an MC-wrapped group with a ${name} picture exports without the group`, async () => {
    for (const members of [picture, picture + BAR_MEMBER]) {
      const { imageCount, commands } = await pageCommands(input(members, options));
      expect(imageCount).toBe(0);
      expect(commands).not.toContain('1 0 0 rg');
    }
  });
}

test('an MC-wrapped group with a picture PDF cannot embed is left out with a notice', async () => {
  const notice = {
    code: 'drawing',
    severity: 'information' as const,
    message: 'Shape group left out: picture format not embeddable: image/gif',
  };
  for (const members of [pictureMember(0), pictureMember(0) + BAR_MEMBER]) {
    const { imageCount, commands } = await pageCommands(withGifPicture(input(members)), 'strict', [
      notice,
    ]);
    expect(imageCount).toBe(0);
    expect(commands).not.toContain('1 0 0 rg');
  }
});

test('a bare group whose picture cannot paint is refused as a whole', async () => {
  const bareGroup = (media?: null) =>
    input(pictureMember(0) + BAR_MEMBER, { alternateContent: false, media });
  for (const [bare, message] of [
    [bareGroup(null), 'Image has no validated raster bytes'],
    [withGifPicture(bareGroup()), 'Unsupported PDF image format: image/gif'],
  ] as const) {
    const error = await exportPdf(bare, { useSystemFonts: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfFidelityError);
    const { imageCount, commands } = await pageCommands(bare, 'best-effort', [
      { code: 'drawing', severity: 'unsupported', message },
    ]);
    // No vector member paints without its picture.
    expect(imageCount).toBe(0);
    expect(commands).not.toContain('1 0 0 rg');
  }
});

test('a picture offset far outside the group exports under both policies', async () => {
  // Refused at projection, so the MC group is not shown and no coordinate reaches the writer.
  for (const x of [999_999_999_999_999, 12_700 * 1_000_001]) {
    for (const policy of ['strict', 'best-effort'] as const) {
      const { imageCount } = await pageCommands(input(pictureMember(0, x) + BAR_MEMBER), policy);
      expect(imageCount).toBe(0);
    }
  }
  // The picture makes its vector members visible, so they are bounded the same way.
  const farBar = BAR_MEMBER.replace(
    '<a:off x="0" y="1270000"/>',
    '<a:off x="999999999999999" y="0"/>'
  );
  for (const policy of ['strict', 'best-effort'] as const) {
    const { imageCount } = await pageCommands(input(pictureMember(0) + farBar), policy);
    expect(imageCount).toBe(0);
  }
  const bare = input(pictureMember(0, 999_999_999_999_999) + BAR_MEMBER, {
    alternateContent: false,
  });
  const { imageCount } = await pageCommands(bare, 'best-effort', [
    { code: 'drawing', severity: 'unsupported', message: 'Unsupported drawing: graphic' },
  ]);
  expect(imageCount).toBe(0);
});
