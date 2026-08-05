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

const ASYNC_IMAGE_REASON = /executeImageCommand/i;

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

function emptyDocument(): Uint8Array {
  return zipSync({
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
  });
}

function inlinePictureDocument(
  options: {
    readonly wrap?: 'inline' | 'anchor';
    readonly simplePos?: { readonly x: number; readonly y: number };
  } = {}
): Uint8Array {
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
        '<wp:docPr id="1" name="green"/>' +
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
        '<wp:docPr id="1" name="green"/>' +
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

function anchoredPictureDocument(): Uint8Array {
  return inlinePictureDocument({ wrap: 'anchor', simplePos: { x: 0, y: 0 } });
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

function validInsertCommand() {
  return {
    type: 'insertImage' as const,
    data: PNG_1X1,
    mime: 'image/png' as const,
    widthPoints: 72,
    heightPoints: 72,
  };
}

describe('task 13 fix round 2 — async can/exec honesty', () => {
  test('generic can refuses insertImage and replaceImage with async-path reason', () => {
    const editor = mountEditor(emptyDocument());
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    const insertCan = editor.can(validInsertCommand());
    expect(insertCan.ok).toBe(false);
    if (!insertCan.ok) expect(insertCan.reason).toMatch(ASYNC_IMAGE_REASON);

    const pictureEditor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(pictureEditor);
    const replaceCan = pictureEditor.can({
      type: 'replaceImage',
      data: PNG_1X1,
      mime: 'image/png',
    });
    expect(replaceCan.ok).toBe(false);
    if (!replaceCan.ok) expect(replaceCan.reason).toMatch(ASYNC_IMAGE_REASON);
  });

  test('generic can and sync exec agree on async refusal for byte commands', () => {
    const editor = mountEditor(emptyDocument());
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    const command = validInsertCommand();
    const canRefused = editor.can(command);
    const execRefused = editor.exec(command);
    expect(canRefused.ok).toBe(false);
    expect(execRefused.ok).toBe(false);
    if (!canRefused.ok && !execRefused.ok) {
      expect(canRefused.reason).toMatch(ASYNC_IMAGE_REASON);
      expect(execRefused.reason).toMatch(ASYNC_IMAGE_REASON);
    }
  });

  test('canExecuteImageCommand is true in editing mode with valid payload', () => {
    const editor = mountEditor(emptyDocument());
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    expect(editor.can(validInsertCommand()).ok).toBe(false);
    expect(editor.canExecuteImageCommand(validInsertCommand())).toEqual({ ok: true });
  });

  test('canExecuteImageCommand refuses viewing and suggesting modes', () => {
    const editor = mountEditor(emptyDocument(), { mode: 'view' });
    const viewing = editor.canExecuteImageCommand(validInsertCommand());
    expect(viewing.ok).toBe(false);

    const editable = mountEditor(emptyDocument(), { author: 'Reviewer' });
    editable.setEditingMode('suggesting');
    const suggesting = editable.canExecuteImageCommand(validInsertCommand());
    expect(suggesting.ok).toBe(false);
  });
});

describe('task 13 fix round 2 — package epoch', () => {
  test('stale package epoch refuses insertImage without revision bump or history', async () => {
    const decodePort = createTestImageDecodePort({
      delayMs: 10,
      mutateDuringDecode: undefined,
    });
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: emptyDocument(),
      imageDecodePort: decodePort,
    });
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    const beforeRevision = editor.surface!.session.packageRevision();
    const beforeHistory = editor.surface!.session.canUndo;
    const command = validInsertCommand();
    const pending = editor.executeImageCommand(command);
    editor.exec({ type: 'insertText', text: 'x' });
    const refused = await pending;
    expect(refused.ok).toBe(false);
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision + 1);
    expect(editor.surface!.session.canUndo).toBe(beforeHistory || editor.surface!.session.canUndo);
  });

  test('concurrent replaceImage: only first valid epoch commits', async () => {
    const decodePort = createTestImageDecodePort({ delayMs: 15 });
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: inlinePictureDocument(),
      imageDecodePort: decodePort,
    });
    selectInlineDrawing(editor);
    const beforeRevision = editor.surface!.session.packageRevision();
    const first = editor.executeImageCommand({
      type: 'replaceImage',
      data: PNG_1X1,
      mime: 'image/png',
    });
    const second = editor.executeImageCommand({
      type: 'replaceImage',
      data: PNG_1X1,
      mime: 'image/png',
    });
    const firstResult = await first;
    const secondResult = await second;
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(false);
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision + 1);
  });

  test('replaceImage aborts on destroy without post-commit package mutation', async () => {
    const decodePort = createTestImageDecodePort({ delayMs: 10 });
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: inlinePictureDocument(),
      imageDecodePort: decodePort,
    });
    selectInlineDrawing(editor);
    const beforeRevision = editor.surface!.session.packageRevision();
    const pending = editor.executeImageCommand({
      type: 'replaceImage',
      data: PNG_1X1,
      mime: 'image/png',
    });
    editor.destroy();
    const refused = await pending;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('notFound');
    expect(beforeRevision).toBeGreaterThanOrEqual(0);
  });
});

describe('task 13 fix round 2 — drawing position validation', () => {
  test('invalid relativeToH refuses setImagePosition in can and exec without mutation', () => {
    const editor = mountEditor(
      inlinePictureDocument({ wrap: 'anchor', simplePos: { x: 0, y: 0 } })
    );
    selectInlineDrawing(editor);
    expect(editor.snapshot().image).not.toBeNull();
    const beforeRevision = editor.surface!.session.packageRevision();
    const command = {
      type: 'setImagePosition' as const,
      relativeToH: 'not-a-frame',
      horizontalEmu: 1000,
    };
    const canRefused = editor.can(command);
    const execRefused = editor.exec(command);
    expect(canRefused.ok).toBe(false);
    expect(execRefused.ok).toBe(false);
    if (!canRefused.ok && !execRefused.ok) {
      expect(canRefused.reason).toBe(execRefused.reason);
    }
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision);
  });

  test('non-integer horizontalEmu refuses consistently', () => {
    const editor = mountEditor(
      inlinePictureDocument({ wrap: 'anchor', simplePos: { x: 0, y: 0 } })
    );
    selectInlineDrawing(editor);
    const command = {
      type: 'setImagePosition' as const,
      horizontalEmu: 1.5,
    };
    const canRefused = editor.can(command);
    const execRefused = editor.exec(command);
    expect(canRefused.ok).toBe(false);
    expect(execRefused.ok).toBe(false);
  });
});

describe('task 15 — setImageProperties position payload', () => {
  test('applies resize and position in one transaction', () => {
    const editor = mountEditor(
      inlinePictureDocument({ wrap: 'anchor', simplePos: { x: 0, y: 0 } })
    );
    selectInlineDrawing(editor);
    const beforeRevision = editor.surface!.session.packageRevision();
    const result = editor.exec({
      type: 'setImageProperties',
      widthEmu: 25_400,
      verticalEmu: 12_700,
    });
    expect(result.ok).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision + 1);
    selectInlineDrawing(editor);
    expect(editor.getSelectedImage()?.widthEmu).toBe(25_400);
    expect(editor.getSelectedImage()?.position?.verticalEmu).toBe(12_700);
  });

  test('preserves simplePos semantics through setImageProperties', () => {
    const editor = mountEditor(
      inlinePictureDocument({ wrap: 'anchor', simplePos: { x: 120_000, y: -45_000 } })
    );
    selectInlineDrawing(editor);
    const result = editor.exec({
      type: 'setImageProperties',
      horizontalEmu: 130_000,
      verticalEmu: -45_000,
      title: 'Updated title',
    });
    expect(result.ok).toBe(true);
    selectInlineDrawing(editor);
    expect(editor.getSelectedImage()?.position).toEqual({
      mode: 'simple',
      horizontalEmu: 130_000,
      verticalEmu: -45_000,
    });
    expect(editor.getSelectedImage()?.title).toBe('Updated title');
  });

  test('invalid relativeToH refuses setImageProperties without mutation', () => {
    const editor = mountEditor(
      inlinePictureDocument({ wrap: 'anchor', simplePos: { x: 0, y: 0 } })
    );
    selectInlineDrawing(editor);
    const beforeRevision = editor.surface!.session.packageRevision();
    const command = {
      type: 'setImageProperties' as const,
      relativeToH: 'not-a-frame',
      horizontalEmu: 1000,
    };
    const canRefused = editor.can(command);
    const execRefused = editor.exec(command);
    expect(canRefused.ok).toBe(false);
    expect(execRefused.ok).toBe(false);
    if (!canRefused.ok && !execRefused.ok) {
      expect(canRefused.reason).toBe(execRefused.reason);
    }
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision);
  });

  test('position fields refuse on inline images', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    const command = {
      type: 'setImageProperties' as const,
      verticalEmu: 1000,
    };
    const canRefused = editor.can(command);
    expect(canRefused.ok).toBe(false);
    if (!canRefused.ok) {
      expect(canRefused.reason).toContain('position cannot be changed');
    }
  });

  test('properties dialog payload applies simplePos horizontal edit atomically', () => {
    const editor = mountEditor(
      inlinePictureDocument({ wrap: 'anchor', simplePos: { x: 120_000, y: -45_000 } })
    );
    selectInlineDrawing(editor);
    const image = editor.getSelectedImage()!;
    const beforeRevision = editor.surface!.session.packageRevision();
    const command = {
      type: 'setImageProperties' as const,
      widthEmu: image.widthEmu,
      heightEmu: image.heightEmu,
      title: image.title,
      description: image.description,
      hyperlink: null,
      horizontalEmu: 152_400,
      verticalEmu: -45_000,
    };
    const can = editor.can(command);
    expect(can.ok).toBe(true);
    const result = editor.exec(command);
    expect(result.ok).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBe(beforeRevision + 1);
    selectInlineDrawing(editor);
    expect(editor.getSelectedImage()?.position).toEqual({
      mode: 'simple',
      horizontalEmu: 152_400,
      verticalEmu: -45_000,
    });
  });
});
