import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  cropPercentFromCropPermille,
  cropPercentFromPermille,
  cropPercentFromSourceCrop,
  cropPermilleFromCropPercent,
  cropPermilleFromPercent,
  sourceCropFromCropPercent,
  validateImageCropPercent,
} from '../../store/package/image-crop-units.ts';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { HYPERLINK_RELATIONSHIP_TYPE } from '../../store/package/hyperlink.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function createTestImageDecodePort(): ImageDecodePort {
  return Object.freeze({
    async decode(bytes, mime, _limits) {
      const header = validateRasterHeader(bytes, mime);
      if (!header) throw new Error('invalid image');
      const limits = resolveImageResourceLimits();
      if (header.pixelWidth * header.pixelHeight > limits.maxPixels) {
        throw new Error('too large');
      }
      return Object.freeze({
        pixelWidth: header.pixelWidth,
        pixelHeight: header.pixelHeight,
        dpiX: 96,
        dpiY: 96,
      });
    },
  });
}

function inlinePictureDocument(options?: {
  readonly cropPermille?: {
    readonly l: number;
    readonly t: number;
    readonly r: number;
    readonly b: number;
  };
  readonly hyperlinkRel?: string;
}): Uint8Array {
  const cropAttrs = options?.cropPermille
    ? `<a:srcRect l="${options.cropPermille.l}" t="${options.cropPermille.t}" r="${options.cropPermille.r}" b="${options.cropPermille.b}"/>`
    : '';
  const hlinkChild = options?.hyperlinkRel
    ? `<a:hlinkClick xmlns:a="${A}" xmlns:r="${R}" r:id="${options.hyperlinkRel}"/>`
    : '';
  const drawingInner =
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="1" allowOverlap="0" behindDoc="0" locked="0" layoutInCell="1" relativeHeight="0">` +
    '<wp:simplePos x="120000" y="-45000"/>' +
    '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="914400"/>' +
    '<wp:wrapSquare wrapText="bothSides"/>' +
    `<wp:docPr id="1" name="green" descr="Green square" title="Green title">${hlinkChild}</wp:docPr>` +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
    `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdImage"/>${cropAttrs}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor>';

  const rels =
    `<Relationships xmlns="${REL}">` +
    `<Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/>` +
    (options?.hyperlinkRel
      ? `<Relationship Id="${options.hyperlinkRel}" Type="${R}/hyperlink" Target="https://example.com/original" TargetMode="External"/>`
      : '') +
    '</Relationships>';

  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body><w:p><w:r><w:t>before</w:t></w:r><w:r><w:drawing>${drawingInner}</w:drawing></w:r><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;

  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(body),
    'word/_rels/document.xml.rels': strToU8(rels),
    'word/media/image1.png': PNG_1X1,
  });
}

function lockedNoMoveDocument(): Uint8Array {
  const drawingInner =
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="1" allowOverlap="0" behindDoc="0" locked="0" layoutInCell="1" relativeHeight="0">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="914400"/>' +
    '<wp:wrapSquare wrapText="bothSides"/>' +
    '<wp:docPr id="1" name="green"/>' +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noMove="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
    `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdImage"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>` +
    '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor>';
  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body><w:p><w:r><w:t>before</w:t></w:r><w:r><w:drawing>${drawingInner}</w:drawing></w:r><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(body),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
  });
}

function mountEditor(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: bytes,
    imageDecodePort: createTestImageDecodePort(),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function selectDrawing(editor: DocxEditorInstance, offset = 6): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

function hlinkClickRelFromPart(part: { readonly root: unknown }): string | null {
  let found: string | null = null;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      localName?: string;
      attributes?: readonly { localName: string; value: string; namespaceUri?: string }[];
      children?: readonly unknown[];
    };
    if (n.localName === 'hlinkClick') {
      found =
        n.attributes?.find((a) => a.localName === 'id' && a.namespaceUri?.includes('relationships'))
          ?.value ??
        n.attributes?.find((a) => a.localName === 'id')?.value ??
        null;
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(part.root);
  return found;
}

function drawingAnchorInner(hlinkRel?: string, docPrId = 1): string {
  const hlinkChild = hlinkRel
    ? `<a:hlinkClick xmlns:a="${A}" xmlns:r="${R}" r:id="${hlinkRel}"/>`
    : '';
  return (
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="1" allowOverlap="0" behindDoc="0" locked="0" layoutInCell="1" relativeHeight="0">` +
    '<wp:simplePos x="120000" y="-45000"/>' +
    '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="914400"/>' +
    '<wp:wrapSquare wrapText="bothSides"/>' +
    `<wp:docPr id="${docPrId}" name="pic">${hlinkChild}</wp:docPr>` +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
    `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor>'
  );
}

function hyperlinkExternalTargets(
  editor: DocxEditorInstance,
  ownerPart = '/word/document.xml'
): readonly { readonly id: string; readonly rawTarget: string }[] {
  return editor
    .surface!.session.currentPackage()
    .externalTargets.filter(
      (entry) => entry.ownerPart === ownerPart && entry.type === HYPERLINK_RELATIONSHIP_TYPE
    )
    .map(({ id, rawTarget }) => ({ id, rawTarget }));
}

function documentWithTwoSharedHyperlinkDrawings(): Uint8Array {
  const rels =
    `<Relationships xmlns="${REL}">` +
    `<Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/>` +
    `<Relationship Id="rIdLink" Type="${R}/hyperlink" Target="https://example.com/shared" TargetMode="External"/>` +
    '</Relationships>';
  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>` +
    `<w:p><w:r><w:t>a</w:t></w:r><w:r><w:drawing>${drawingAnchorInner('rIdLink', 1)}</w:drawing></w:r></w:p>` +
    `<w:p><w:r><w:t>b</w:t></w:r><w:r><w:drawing>${drawingAnchorInner('rIdLink', 2)}</w:drawing></w:r></w:p>` +
    `</w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(body),
    'word/_rels/document.xml.rels': strToU8(rels),
    'word/media/image1.png': PNG_1X1,
  });
}

function documentWithHeaderAndBodyDuplicateHyperlinkRel(): Uint8Array {
  const headerInner = drawingAnchorInner('rIdLink', 1);
  const bodyInner = drawingAnchorInner('rIdLink', 2);
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:body><w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/></w:sectPr>` +
        `<w:p><w:r><w:t>x</w:t></w:r><w:r><w:drawing>${bodyInner}</w:drawing></w:r></w:p></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/>` +
        `<Relationship Id="rIdHdr" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdLink" Type="${R}/hyperlink" Target="https://example.com/body" TargetMode="External"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:drawing>${headerInner}</w:drawing></w:r></w:p></w:hdr>`
    ),
    'word/_rels/header1.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/>` +
        `<Relationship Id="rIdLink" Type="${R}/hyperlink" Target="https://example.com/header" TargetMode="External"/>` +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
  });
}

function selectDrawingInParagraph(
  editor: DocxEditorInstance,
  paragraphIndex: number,
  offset = 1
): void {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

function srcRectPermilleFromPart(part: {
  readonly root: unknown;
}): { l: string; t: string; r: string; b: string } | null {
  let found: { l: string; t: string; r: string; b: string } | null = null;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      kind?: string;
      localName?: string;
      attributes?: readonly { localName: string; value: string }[];
      children?: readonly unknown[];
    };
    if (n.kind === 'pictureSrcRect' || n.localName === 'srcRect') {
      const l = n.attributes?.find((a) => a.localName === 'l')?.value;
      const t = n.attributes?.find((a) => a.localName === 't')?.value;
      const r = n.attributes?.find((a) => a.localName === 'r')?.value;
      const b = n.attributes?.find((a) => a.localName === 'b')?.value;
      if (l !== undefined && t !== undefined && r !== undefined && b !== undefined) {
        found = { l, t, r, b };
      }
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(part.root);
  return found;
}

describe('task 15 fix round 3 — crop unit boundary', () => {
  test('percent 25 round-trips to permille 25000 and back', () => {
    expect(cropPermilleFromPercent(25)).toBe(25000);
    expect(cropPercentFromPermille(25000)).toBe(25);
    expect(cropPermilleFromCropPercent({ left: 25, top: 10, right: 15, bottom: 5 })).toEqual({
      left: 25000,
      top: 10000,
      right: 15000,
      bottom: 5000,
    });
    expect(
      cropPercentFromCropPermille({ left: 25000, top: 10000, right: 15000, bottom: 5000 })
    ).toEqual({
      left: 25,
      top: 10,
      right: 15,
      bottom: 5,
    });
  });

  test('projection fraction converts to UI percent exactly once', () => {
    expect(cropPercentFromSourceCrop({ left: 0.25, top: 0.1, right: 0.15, bottom: 0.05 })).toEqual({
      left: 25,
      top: 10,
      right: 15,
      bottom: 5,
    });
    expect(sourceCropFromCropPercent({ left: 25, top: 10, right: 15, bottom: 5 })).toEqual({
      left: 0.25,
      top: 0.1,
      right: 0.15,
      bottom: 0.05,
    });
  });

  test('opposing edge sums reject at 100 percent', () => {
    expect(validateImageCropPercent({ left: 60, top: 0, right: 40, bottom: 0 })).toBe(false);
    expect(validateImageCropPercent({ left: 25, top: 50, right: 25, bottom: 49 })).toBe(true);
  });

  test('setImageProperties persists permille 25000 for UI crop 25 and reads back 25', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectDrawing(editor);
    const beforeRevision = editor.surface!.session.packageRevision();
    const result = editor.exec({
      type: 'setImageProperties',
      crop: { left: 25, top: 0, right: 25, bottom: 0 },
    });
    expect(result.ok).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision + 1);
    selectDrawing(editor);
    expect(editor.getSelectedImage()?.crop).toEqual({ left: 25, top: 0, right: 25, bottom: 0 });
    const part = editor.surface!.session.part();
    expect(srcRectPermilleFromPart(part)).toEqual({ l: '25000', t: '0', r: '25000', b: '0' });
  });

  test('reads existing permille crop as UI percent on selection', () => {
    const editor = mountEditor(
      inlinePictureDocument({ cropPermille: { l: 25000, t: 10000, r: 15000, b: 5000 } })
    );
    selectDrawing(editor);
    expect(editor.getSelectedImage()?.crop).toEqual({ left: 25, top: 10, right: 15, bottom: 5 });
  });
});

describe('task 15 fix round 3 — hyperlink package atomicity', () => {
  test('setImageProperties applies resize and hyperlink in one package revision', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectDrawing(editor);
    const image = editor.getSelectedImage()!;
    const beforeRevision = editor.surface!.session.packageRevision();
    const result = editor.exec({
      type: 'setImageProperties',
      widthEmu: image.widthEmu + 1000,
      hyperlink: 'https://example.com/new-target',
      title: 'Linked',
      description: image.description,
    });
    expect(result.ok).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision + 1);
    selectDrawing(editor);
    const after = editor.getSelectedImage()!;
    expect(after.widthEmu).toBe(image.widthEmu + 1000);
    expect(after.hyperlink).toBe('https://example.com/new-target');
    expect(hlinkClickRelFromPart(editor.surface!.session.part())).not.toBeNull();
  });

  test('unsafe hyperlink URL blocks the entire properties command', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectDrawing(editor);
    const beforeRevision = editor.surface!.session.packageRevision();
    const beforeWidth = editor.getSelectedImage()!.widthEmu;
    const command = {
      type: 'setImageProperties' as const,
      widthEmu: beforeWidth + 500,
      hyperlink: 'javascript:alert(1)',
    };
    const can = editor.can(command);
    const exec = editor.exec(command);
    expect(can.ok).toBe(false);
    expect(exec.ok).toBe(false);
    if (!can.ok && !exec.ok) expect(can.reason).toBe(exec.reason);
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision);
    selectDrawing(editor);
    expect(editor.getSelectedImage()?.widthEmu).toBe(beforeWidth);
  });

  test('unchanged hyperlink preserves existing relationship id', () => {
    const editor = mountEditor(inlinePictureDocument({ hyperlinkRel: 'rIdLink' }));
    selectDrawing(editor);
    const beforeExternal = editor
      .surface!.session.currentPackage()
      .externalTargets.find((entry) => entry.id === 'rIdLink');
    expect(beforeExternal?.rawTarget).toBe('https://example.com/original');
    const result = editor.exec({
      type: 'setImageProperties',
      description: 'Updated only',
      hyperlink: 'https://example.com/original',
    });
    expect(result.ok).toBe(true);
    const afterExternal = editor
      .surface!.session.currentPackage()
      .externalTargets.filter((entry) => entry.id === 'rIdLink');
    expect(afterExternal).toHaveLength(1);
    expect(afterExternal[0]?.rawTarget).toBe('https://example.com/original');
    expect(hlinkClickRelFromPart(editor.surface!.session.part())).toBe('rIdLink');
  });
});

describe('task 15 fix round 3 — orphan drawing hyperlink rel cleanup', () => {
  test('sole URL change removes the prior owner rel when unreferenced', () => {
    const editor = mountEditor(inlinePictureDocument({ hyperlinkRel: 'rIdLink' }));
    selectDrawing(editor);
    expect(hyperlinkExternalTargets(editor)).toEqual([
      { id: 'rIdLink', rawTarget: 'https://example.com/original' },
    ]);
    const result = editor.exec({
      type: 'setImageProperties',
      hyperlink: 'https://example.com/new-target',
    });
    expect(result.ok).toBe(true);
    const targets = hyperlinkExternalTargets(editor);
    expect(targets.some((entry) => entry.rawTarget === 'https://example.com/original')).toBe(false);
    expect(targets.some((entry) => entry.rawTarget === 'https://example.com/new-target')).toBe(
      true
    );
    expect(targets).toHaveLength(1);
  });

  test('shared rel is preserved when another drawing in the same part still references it', () => {
    const editor = mountEditor(documentWithTwoSharedHyperlinkDrawings());
    selectDrawingInParagraph(editor, 0, 1);
    const result = editor.exec({
      type: 'setImageProperties',
      hyperlink: 'https://example.com/other',
    });
    expect(result.ok).toBe(true);
    const targets = hyperlinkExternalTargets(editor);
    expect(targets.some((entry) => entry.rawTarget === 'https://example.com/shared')).toBe(true);
    expect(targets.some((entry) => entry.rawTarget === 'https://example.com/other')).toBe(true);
    selectDrawingInParagraph(editor, 1, 1);
    expect(editor.getSelectedImage()?.hyperlink).toBe('https://example.com/shared');
  });

  test('hyperlink removal drops the owner rel when it was the sole reference', () => {
    const editor = mountEditor(inlinePictureDocument({ hyperlinkRel: 'rIdLink' }));
    selectDrawing(editor);
    const result = editor.exec({
      type: 'setImageProperties',
      hyperlink: null,
    });
    expect(result.ok).toBe(true);
    expect(hyperlinkExternalTargets(editor)).toHaveLength(0);
    expect(hlinkClickRelFromPart(editor.surface!.session.part())).toBeNull();
  });

  test('unchanged same-target hyperlink keeps the existing relationship id', () => {
    const editor = mountEditor(inlinePictureDocument({ hyperlinkRel: 'rIdLink' }));
    selectDrawing(editor);
    const result = editor.exec({
      type: 'setImageProperties',
      description: 'Still linked',
      hyperlink: 'https://example.com/original',
    });
    expect(result.ok).toBe(true);
    expect(hlinkClickRelFromPart(editor.surface!.session.part())).toBe('rIdLink');
    expect(hyperlinkExternalTargets(editor)).toEqual([
      { id: 'rIdLink', rawTarget: 'https://example.com/original' },
    ]);
  });

  test('header/body duplicate rId cleanup is scoped by owner part', () => {
    const editor = mountEditor(documentWithHeaderAndBodyDuplicateHyperlinkRel());
    selectDrawing(editor, 1);
    const result = editor.exec({
      type: 'setImageProperties',
      hyperlink: 'https://example.com/body-new',
    });
    expect(result.ok).toBe(true);
    const bodyTargets = hyperlinkExternalTargets(editor);
    expect(bodyTargets).toHaveLength(1);
    expect(bodyTargets[0]?.rawTarget).toBe('https://example.com/body-new');
    expect(bodyTargets[0]?.id).not.toBe('rIdLink');
    expect(hyperlinkExternalTargets(editor, '/word/header1.xml')).toEqual([
      { id: 'rIdLink', rawTarget: 'https://example.com/header' },
    ]);
  });

  test('undo and redo restore hyperlink rel ownership exactly', () => {
    const editor = mountEditor(inlinePictureDocument({ hyperlinkRel: 'rIdLink' }));
    selectDrawing(editor);
    const beforeRevision = editor.surface!.session.packageRevision();
    const changed = editor.exec({
      type: 'setImageProperties',
      hyperlink: 'https://example.com/new-target',
    });
    expect(changed.ok).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision + 1);
    expect(hyperlinkExternalTargets(editor)).toHaveLength(1);
    expect(hyperlinkExternalTargets(editor)[0]?.rawTarget).toBe('https://example.com/new-target');

    editor.surface!.undo();
    expect(hlinkClickRelFromPart(editor.surface!.session.part())).toBe('rIdLink');
    expect(hyperlinkExternalTargets(editor)).toEqual([
      { id: 'rIdLink', rawTarget: 'https://example.com/original' },
    ]);

    editor.surface!.redo();
    expect(hyperlinkExternalTargets(editor)).toHaveLength(1);
    expect(hyperlinkExternalTargets(editor)[0]?.rawTarget).toBe('https://example.com/new-target');
    expect(hyperlinkExternalTargets(editor).some((entry) => entry.id === 'rIdLink')).toBe(false);
  });
});

describe('task 15 fix round 3 — dirty field omission and locks', () => {
  test('metadata-only apply preserves exact width emu values', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectDrawing(editor);
    const image = editor.getSelectedImage()!;
    const beforeRevision = editor.surface!.session.packageRevision();
    const result = editor.exec({
      type: 'setImageProperties',
      description: 'Screen reader only',
    });
    expect(result.ok).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision + 1);
    selectDrawing(editor);
    expect(editor.getSelectedImage()?.widthEmu).toBe(image.widthEmu);
    expect(editor.getSelectedImage()?.heightEmu).toBe(image.heightEmu);
    expect(editor.getSelectedImage()?.position).toEqual(image.position);
  });

  test('position fields refuse when noMove lock is set', () => {
    const editor = mountEditor(lockedNoMoveDocument());
    selectDrawing(editor);
    expect(editor.getSelectedImage()?.canMove).toBe(false);
    const command = {
      type: 'setImageProperties' as const,
      horizontalEmu: 1000,
    };
    const can = editor.can(command);
    const exec = editor.exec(command);
    expect(can.ok).toBe(false);
    expect(exec.ok).toBe(false);
    if (!can.ok && !exec.ok) expect(can.reason).toBe(exec.reason);
  });
});
