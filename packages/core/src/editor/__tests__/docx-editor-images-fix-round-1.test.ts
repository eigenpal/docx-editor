import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function createTestImageDecodePort(options?: {
  readonly delayMs?: number;
  readonly mutateDuringDecode?: () => void;
}): ImageDecodePort {
  return Object.freeze({
    async decode(bytes, mime, _limits) {
      if (options?.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      options?.mutateDuringDecode?.();
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

function inlinePictureDocument(
  options: {
    readonly wrap?: 'inline' | 'anchor';
    readonly simplePos?: { readonly x: number; readonly y: number };
    readonly docPr?: string;
  } = {}
): Uint8Array {
  const docPr = options.docPr ?? 'id="1" name="green" descr="Green square" title="Green title"';
  const simplePosAttrs =
    options.simplePos !== undefined
      ? `simplePos="1" distT="0" distB="0" distL="0" distR="0" allowOverlap="0" behindDoc="0" locked="0" layoutInCell="1" relativeHeight="0"`
      : 'distT="0" distB="0" distL="0" distR="0"';
  const drawingInner =
    options.wrap === 'anchor'
      ? `<wp:anchor ${simplePosAttrs}>` +
        (options.simplePos !== undefined
          ? `<wp:simplePos x="${options.simplePos.x}" y="${options.simplePos.y}"/>`
          : '<wp:simplePos x="0" y="0"/>') +
        '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
        '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="914400" cy="914400"/>' +
        '<wp:wrapSquare wrapText="bothSides"/>' +
        `<wp:docPr ${docPr}/>` +
        '<wp:cNvGraphicFramePr/>' +
        `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
        '<pic:pic xmlns:pic="' +
        PIC +
        '"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="rIdImage"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>' +
        '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:anchor>'
      : `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
        '<wp:extent cx="914400" cy="914400"/>' +
        `<wp:docPr ${docPr}/>` +
        '<wp:cNvGraphicFramePr/>' +
        `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}">` +
        '<pic:pic xmlns:pic="' +
        PIC +
        '"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="rIdImage"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>' +
        '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline>';

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

function mountEditor(
  bytes: Uint8Array,
  options?: { author?: string; mode?: 'edit' | 'view' }
): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: bytes,
    imageDecodePort: createTestImageDecodePort(),
    ...(options?.author ? { author: options.author } : {}),
    ...(options?.mode ? { mode: options.mode } : {}),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function drawingParagraphId(editor: DocxEditorInstance): string {
  return editor.surface!.session.paragraphIds()[0]!;
}

function selectInlineDrawing(editor: DocxEditorInstance, offset = 6): void {
  const paragraphId = drawingParagraphId(editor);
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

describe('task 13 fix round 1 — guarded image mutations', () => {
  test('deleteImage in suggesting mode returns trackedDrawingDeletionUnsupported', () => {
    const editor = mountEditor(inlinePictureDocument(), { author: 'Reviewer' });
    selectInlineDrawing(editor);
    editor.setEditingMode('suggesting');
    const refused = editor.exec({ type: 'deleteImage' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('trackedDrawingDeletionUnsupported');
    expect(editor.snapshot().image).not.toBeNull();
  });

  test('setImageWrapType in suggesting mode refuses without mutating', () => {
    const editor = mountEditor(inlinePictureDocument({ wrap: 'anchor' }), { author: 'Reviewer' });
    selectInlineDrawing(editor);
    editor.setEditingMode('suggesting');
    const beforeRevision = editor.surface!.session.packageRevision();
    const refused = editor.exec({ type: 'setImageWrapType', target: 'tight' });
    expect(refused.ok).toBe(false);
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision);
  });

  test('sync exec refuses insertImage and points to executeImageCommand', () => {
    const editor = mountEditor(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            '<Default Extension="png" ContentType="image/png"/>' +
            `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>`
        ),
        'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"></Relationships>`),
      })
    );
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    const syncRefused = editor.exec({
      type: 'insertImage',
      data: PNG_1X1,
      mime: 'image/png',
      widthPoints: 72,
      heightPoints: 72,
    });
    expect(syncRefused.ok).toBe(false);
    if (!syncRefused.ok) expect(syncRefused.reason).toContain('executeImageCommand');
  });

  test('canExecuteImageCommand and executeImageCommand agree for insertImage', async () => {
    const editor = mountEditor(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            '<Default Extension="png" ContentType="image/png"/>' +
            `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>`
        ),
        'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"></Relationships>`),
      })
    );
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    const command = {
      type: 'insertImage' as const,
      data: PNG_1X1,
      mime: 'image/png' as const,
      widthPoints: 72,
      heightPoints: 72,
    };
    expect(editor.canExecuteImageCommand(command)).toEqual({ ok: true });
    const beforeRevision = editor.surface!.session.packageRevision();
    const result = await editor.executeImageCommand(command);
    expect(result.ok).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBeGreaterThan(beforeRevision);
  });

  test('replaceImage aborts when editor is destroyed during decode', async () => {
    const decodePort = createTestImageDecodePort({
      delayMs: 10,
    });
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: inlinePictureDocument(),
      imageDecodePort: decodePort,
    });
    selectInlineDrawing(editor);
    const beforeRevision = editor.surface!.session.packageRevision();
    const command = { type: 'replaceImage' as const, data: PNG_1X1, mime: 'image/png' as const };
    expect(editor.canExecuteImageCommand(command)).toEqual({ ok: true });
    const pending = editor.executeImageCommand(command);
    editor.destroy();
    const refused = await pending;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('notFound');
  });

  test('replaceImage aborts when selection moves off the drawing during decode', async () => {
    const decodePort = createTestImageDecodePort({ delayMs: 10 });
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: inlinePictureDocument(),
      imageDecodePort: decodePort,
    });
    selectInlineDrawing(editor);
    const paragraphId = drawingParagraphId(editor);
    const beforeRevision = editor.surface!.session.packageRevision();
    const pending = editor.executeImageCommand({
      type: 'replaceImage',
      data: PNG_1X1,
      mime: 'image/png',
    });
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    const refused = await pending;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('stale');
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision);
  });
});

describe('task 13 fix round 1 — simplePos selection and roundtrip', () => {
  test('selected state reports simplePos coordinates and setImagePosition preserves them', () => {
    const editor = mountEditor(
      inlinePictureDocument({ wrap: 'anchor', simplePos: { x: 120_000, y: -45_000 } })
    );
    selectInlineDrawing(editor);
    const image = editor.snapshot().image;
    expect(image?.position).toEqual({
      mode: 'simple',
      horizontalEmu: 120_000,
      verticalEmu: -45_000,
    });
    const result = editor.exec({
      type: 'setImagePosition',
      horizontalEmu: 120_000,
      verticalEmu: -45_000,
    });
    expect(result.ok).toBe(true);
    selectInlineDrawing(editor);
    expect(editor.snapshot().image?.position).toEqual({
      mode: 'simple',
      horizontalEmu: 120_000,
      verticalEmu: -45_000,
    });
  });
});

describe('task 13 fix round 1 — can/exec payload agreement', () => {
  test('setImageProperties refuses border payloads in can and exec', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    const borderCommand = {
      type: 'setImageProperties' as const,
      borderWidthEmu: 12700,
      borderColor: { kind: 'hex' as const, value: 'FF0000' },
    };
    const canRefused = editor.can(borderCommand);
    expect(canRefused.ok).toBe(false);
    const execRefused = editor.exec(borderCommand);
    expect(execRefused.ok).toBe(false);
    if (!execRefused.ok) expect(execRefused.reason).toContain('border');
  });

  test('empty setImagePosition and setImageProperties refuse consistently', () => {
    const editor = mountEditor(inlinePictureDocument({ wrap: 'anchor' }));
    selectInlineDrawing(editor);
    for (const command of [
      { type: 'setImagePosition' as const },
      { type: 'setImageProperties' as const },
    ]) {
      const canRefused = editor.can(command);
      const execRefused = editor.exec(command);
      expect(canRefused.ok).toBe(false);
      expect(execRefused.ok).toBe(false);
      if (!canRefused.ok && !execRefused.ok) {
        expect(canRefused.reason).toBe(execRefused.reason);
      }
    }
  });
});

describe('task 13 fix round 1 — snapshot cache package revision', () => {
  test('image snapshot reference is stable across repeated reads at one revision', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    const first = editor.snapshot();
    const second = editor.snapshot();
    expect(second.image).toBe(first.image);
  });

  test('image snapshot reference changes after a package mutation', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    const first = editor.snapshot().image;
    const result = editor.exec({
      type: 'setImageProperties',
      widthEmu: 800_000,
      heightEmu: 800_000,
    });
    expect(result.ok).toBe(true);
    selectInlineDrawing(editor);
    const second = editor.snapshot().image;
    expect(second?.widthEmu).toBe(800_000);
    expect(second).not.toBe(first);
  });
});
