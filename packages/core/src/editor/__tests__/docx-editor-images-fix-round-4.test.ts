// Whole-branch blocker 3 — image command identity preconditions (strict TDD).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';

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

function decodePort(): ImageDecodePort {
  return Object.freeze({
    async decode(bytes, mime) {
      const header = validateRasterHeader(bytes, mime);
      if (!header) throw new Error('invalid');
      const limits = resolveImageResourceLimits();
      if (header.pixelWidth * header.pixelHeight > limits.maxPixels) throw new Error('large');
      return Object.freeze({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 });
    },
  });
}

function anchoredDrawingInner(name: string, rel: string, docPrId: number): string {
  return (
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="1" allowOverlap="0" behindDoc="0" locked="0" layoutInCell="1" relativeHeight="0">` +
    '<wp:simplePos x="120000" y="-45000"/>' +
    '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="914400"/>' +
    '<wp:wrapSquare wrapText="bothSides"/>' +
    `<wp:docPr id="${docPrId}" name="${name}" title="${name}"/>` +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
    `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor>'
  );
}

function inlinePictureDocument(): Uint8Array {
  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body><w:p><w:r><w:t>before</w:t></w:r><w:r><w:drawing>${anchoredDrawingInner('green', 'rIdImage', 1)}</w:drawing></w:r><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
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

function twoAnchoredPictureDocument(): Uint8Array {
  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body><w:p><w:r><w:t>before</w:t></w:r>` +
    `<w:r><w:drawing>${anchoredDrawingInner('first', 'rIdImage1', 1)}</w:drawing></w:r>` +
    `<w:r><w:drawing>${anchoredDrawingInner('second', 'rIdImage2', 2)}</w:drawing></w:r>` +
    `<w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
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
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdImage1" Type="${R}/image" Target="media/image1.png"/>` +
        `<Relationship Id="rIdImage2" Type="${R}/image" Target="media/image2.png"/>` +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
    'word/media/image2.png': PNG_1X1,
  });
}

function mountEditor(bytes: Uint8Array): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    imageDecodePort: decodePort(),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function selectDrawingAtOffset(editor: DocxEditorInstance, offset: number): SelectedImageCapture {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
  const selected = editor.getSelectedImage();
  expect(selected).not.toBeNull();
  const { anchor } = editor.surface!.state().selection;
  return {
    drawingNodeId: selected!.id,
    expectedPackageRevision: editor.surface!.session.packageRevision(),
    selectionParagraphId: anchor.paragraphId,
    selectionOffset: anchor.offset,
  };
}

interface SelectedImageCapture {
  readonly drawingNodeId: string;
  readonly expectedPackageRevision: number;
  readonly selectionParagraphId: string;
  readonly selectionOffset: number;
}

describe('image command identity fix round 4', () => {
  test('setImageProperties refuses when selection moved to another image', () => {
    const editor = mountEditor(twoAnchoredPictureDocument());
    const first = selectDrawingAtOffset(editor, 6);
    selectDrawingAtOffset(editor, 7);
    const command = {
      type: 'setImageProperties' as const,
      ...first,
      description: 'stale target',
    };
    const can = editor.can(command);
    const exec = editor.exec(command);
    expect(can.ok).toBe(false);
    expect(exec.ok).toBe(false);
    if (!can.ok) expect(can.reason).toContain('stale');
    selectDrawingAtOffset(editor, 7);
    expect(editor.getSelectedImage()?.description).not.toBe('stale target');
  });

  test('setImageProperties refuses after concurrent document mutation', () => {
    const editor = mountEditor(inlinePictureDocument());
    const captured = selectDrawingAtOffset(editor, 6);
    editor.surface!.setSelection({
      anchor: { paragraphId: captured.selectionParagraphId, offset: 0 },
      head: { paragraphId: captured.selectionParagraphId, offset: 0 },
    });
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    const command = {
      type: 'setImageProperties' as const,
      ...captured,
      description: 'after mutation',
    };
    const can = editor.can(command);
    const exec = editor.exec(command);
    expect(can.ok).toBe(false);
    expect(exec.ok).toBe(false);
    if (!can.ok) expect(can.reason).toContain('stale');
  });

  test('insertImage refuses stale expectedPackageRevision from command payload', async () => {
    const editor = mountEditor(inlinePictureDocument());
    const capturedRevision = editor.surface!.session.packageRevision();
    editor.surface!.setSelection({
      anchor: { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset: 0 },
      head: { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset: 0 },
    });
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG_1X1,
      mime: 'image/png',
      widthPoints: 72,
      heightPoints: 72,
      expectedPackageRevision: capturedRevision,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('stale');
  });
});
