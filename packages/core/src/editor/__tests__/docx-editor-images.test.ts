import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  IMAGE_WRAP_TARGETS,
  type ImageWrapTarget,
} from '../../store/package/drawing-projection.ts';
import {
  validateRasterHeader,
  type ImageDecodePort,
  type ImageResourceLookup,
} from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import type { OoxmlDrawingNode, OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { createInlineDrawingLayoutBundle } from '../../layout/inline-drawing-source.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { selectedDrawingOverlayTargetOf } from '../docx-editor-images.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart';

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

function inlinePictureDocument(
  options: {
    readonly embed?: string;
    readonly graphicDataUri?: string;
    readonly docPr?: string;
    readonly wrap?: 'inline' | 'anchor';
    readonly wrapSquare?: string;
    readonly behindDoc?: '0' | '1';
    /** Put the drawing in the FIRST run, so its anchor coincides with the mount-time caret. */
    readonly drawingFirst?: boolean;
  } = {}
): Uint8Array {
  const embed = options.embed ?? 'rIdImage';
  const graphicDataUri = options.graphicDataUri ?? PIC_URI;
  const docPr = options.docPr ?? 'id="1" name="green" descr="Green square" title="Green title"';
  const drawingInner =
    options.wrap === 'anchor'
      ? `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="1" allowOverlap="0" behindDoc="${options.behindDoc ?? '0'}" locked="0" layoutInCell="1" relativeHeight="0">` +
        '<wp:simplePos x="0" y="0"/>' +
        '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
        '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="914400" cy="914400"/>' +
        (options.wrapSquare ??
          '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>') +
        `<wp:docPr ${docPr}/>` +
        '<wp:cNvGraphicFramePr/>' +
        `<a:graphic xmlns:a="${A}"><a:graphicData uri="${graphicDataUri}">` +
        '<pic:pic xmlns:pic="' +
        PIC +
        '"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
        `<pic:blipFill><a:blip r:embed="${embed}"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>` +
        '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:anchor>'
      : `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
        '<wp:extent cx="914400" cy="914400"/>' +
        `<wp:docPr ${docPr}/>` +
        '<wp:cNvGraphicFramePr/>' +
        `<a:graphic xmlns:a="${A}"><a:graphicData uri="${graphicDataUri}">` +
        '<pic:pic xmlns:pic="' +
        PIC +
        '"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
        `<pic:blipFill><a:blip r:embed="${embed}"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>` +
        '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline>';

  const runs = options.drawingFirst
    ? `<w:r><w:drawing>${drawingInner}</w:drawing></w:r><w:r><w:t>after</w:t></w:r>`
    : `<w:r><w:t>before</w:t></w:r><w:r><w:drawing>${drawingInner}</w:drawing></w:r><w:r><w:t>after</w:t></w:r>`;
  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body><w:p>${runs}</w:p></w:body></w:document>`;

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

function drawingParagraphId(editor: DocxEditorInstance): string {
  const ids = editor.surface!.session.paragraphIds();
  return ids[0]!;
}

function selectInlineDrawing(editor: DocxEditorInstance, offset = 6): void {
  const paragraphId = drawingParagraphId(editor);
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

async function settleDrawingResources(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface!.layout();
    const image = editor.snapshot().image;
    if (!image || image.resourceStatus !== 'pending') return;
  }
}

describe('docx-editor selected image context', () => {
  test('text-only package revisions preserve settled drawing resources', async () => {
    const loaded = readOoxmlPackage(inlinePictureDocument());
    if (!loaded.ok) throw new Error(loaded.reason);
    let pkg = loaded.package;
    let revision = 0;
    let resolves = 0;
    const resourceLookup: ImageResourceLookup = {
      async resolveEmbedded() {
        resolves += 1;
        return Object.freeze({ kind: 'missing' as const });
      },
      resolveLinked: () => Object.freeze({ kind: 'missing' as const }),
      async resolveForProjection() {
        resolves += 1;
        return Object.freeze({ kind: 'missing' as const });
      },
      liveReferenceCount: () => 0,
      dispose: () => {},
    };
    const session = {
      packageRevision: () => revision,
      currentPackage: () => pkg,
      part: () => pkg.parts.get(pkg.mainDocumentPart)!,
    };
    const bundle = createInlineDrawingLayoutBundle({
      session,
      decodePort: createTestImageDecodePort(),
      resourceLookup,
      onResourcesChanged: () => {},
    });
    const drawing = (() => {
      const stack: OoxmlElement[] = [session.part().root];
      while (stack.length > 0) {
        const node = stack.shift()!;
        if (node.kind === 'drawing') return node as OoxmlDrawingNode;
        for (const child of node.children) {
          if (child.kind !== 'textValue') stack.push(child);
        }
      }
      throw new Error('missing drawing');
    })();
    const firstProjection = bundle.bodyContext.project(drawing)!;
    expect(bundle.bodyContext.resourceOf(firstProjection).kind).toBe('pending');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bundle.bodyContext.resourceOf(firstProjection).kind).toBe('missing');
    expect(resolves).toBe(1);

    pkg = Object.freeze({ ...pkg, parts: new Map(pkg.parts) });
    revision += 1;
    bundle.sync(session);

    const nextProjection = bundle.bodyContext.project(drawing)!;
    expect(bundle.bodyContext.resourceOf(nextProjection).kind).toBe('missing');
    expect(resolves).toBe(1);
  });

  test('text typed after an inline image reflows onto additional semantic lines', () => {
    const editor = mountEditor(inlinePictureDocument());
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 12 },
      head: { paragraphId, offset: 12 },
    });

    editor.exec({ type: 'insertText', text: ' word'.repeat(200) });

    const fragment = editor
      .surface!.layout()
      .pages.flatMap((page) => page.fragments)
      .find((candidate) => candidate.kind === 'paragraph' && candidate.paragraphId === paragraphId);
    expect(fragment?.kind).toBe('paragraph');
    if (!fragment || fragment.kind !== 'paragraph') throw new Error('missing paragraph fragment');
    expect(fragment.lines.length).toBeGreaterThan(1);
  });

  test('derives selected image context for inline picture with stable references', async () => {
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    await settleDrawingResources(editor);
    const first = editor.snapshot();
    expect(first.image).not.toBeNull();
    expect(first.image!.wrap).toBe('inline');
    expect(first.image!.widthEmu).toBe(914_400);
    expect(first.image!.heightEmu).toBe(914_400);
    expect(first.image!.description).toBe('Green square');
    expect(first.image!.title).toBe('Green title');
    expect(first.image!.name).toBe('green');
    expect(first.image!.resourceStatus).toBe('ready');
    expect(first.image!.intrinsic).toEqual({
      pixelWidth: 1,
      pixelHeight: 1,
      dpiX: 96,
      dpiY: 96,
    });
    expect(editor.getSelectedImage()).toBe(first.image);
    const second = editor.snapshot();
    expect(second.image).toBe(first.image);
  });

  test('viewing mode takes the resize and move handles off the overlay target', async () => {
    // The overlay's capability flags came from the drawing's own OOXML locks alone, so a
    // reader in viewing got eight resize handles, a `move` cursor and a live drag preview —
    // then watched it snap back when the write was refused. The target itself stays: the
    // image is still selectable, copyable and describable in a document open for viewing.
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    await settleDrawingResources(editor);
    const editing = selectedDrawingOverlayTargetOf(editor.surface);
    expect(editing).not.toBeNull();
    expect(editing!.canResize).toBe(true);

    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    const viewing = selectedDrawingOverlayTargetOf(editor.surface);
    expect(viewing).not.toBeNull();
    expect(viewing!.canResize).toBe(false);
    expect(viewing!.canMove).toBe(false);

    // Suggesting refuses every image property edit too, so it gets no handles either.
    editor.exec({ type: 'setEditingMode', mode: 'suggesting' });
    expect(selectedDrawingOverlayTargetOf(editor.surface)!.canResize).toBe(false);

    editor.exec({ type: 'setEditingMode', mode: 'editing' });
    expect(selectedDrawingOverlayTargetOf(editor.surface)!.canResize).toBe(true);
  });

  test('derives null for text caret and range selection', () => {
    const editor = mountEditor(inlinePictureDocument());
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    expect(editor.snapshot().image).toBeNull();
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 2 },
    });
    expect(editor.snapshot().image).toBeNull();
  });

  test('a freshly opened document never reports a selected drawing', async () => {
    // The mount-time caret sits at offset zero of the first paragraph — exactly where this
    // drawing anchors. Nothing PLACED that caret, so nothing is selected: a document must
    // not open with an image ring and eight resize handles.
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: inlinePictureDocument({ wrap: 'anchor', drawingFirst: true }),
      imageDecodePort: createTestImageDecodePort(),
    });
    if (!editor.surface) throw new Error('surface failed to mount');
    expect(editor.surface.hasPlacedSelection()).toBe(false);
    expect(editor.snapshot().image).toBeNull();
    expect(selectedDrawingOverlayTargetOf(editor.surface)).toBeNull();

    // A pointer gesture places the selection even when it lands on the very same offsets,
    // which is how clicking the drawing at the untouched caret position still selects it.
    container.querySelector('.docx-pages')!.dispatchEvent(new Event('pointerdown'));
    expect(editor.surface.hasPlacedSelection()).toBe(true);
    await settleDrawingResources(editor);
    expect(selectedDrawingOverlayTargetOf(editor.surface)).not.toBeNull();
    expect(editor.snapshot().image).not.toBeNull();
  });

  test('an explicit selection write that moves the caret places the selection', () => {
    const editor = mountEditor(inlinePictureDocument({ wrap: 'anchor', drawingFirst: true }));
    expect(editor.surface!.hasPlacedSelection()).toBe(false);
    // A same-position write stays unarmed — the font-load remount restores the saved caret
    // through this path during a plain open.
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    expect(editor.surface!.hasPlacedSelection()).toBe(false);
    selectInlineDrawing(editor, 1);
    expect(editor.surface!.hasPlacedSelection()).toBe(true);
    expect(selectedDrawingOverlayTargetOf(editor.surface)).not.toBeNull();
  });

  test('derives null for non-picture graphic', () => {
    const editor = mountEditor(inlinePictureDocument({ graphicDataUri: CHART_URI }));
    selectInlineDrawing(editor);
    expect(editor.snapshot().image).toBeNull();
  });

  test('reports anchored wrap behind and inFront distinctly', async () => {
    const behind = mountEditor(
      inlinePictureDocument({
        wrap: 'anchor',
        behindDoc: '1',
        wrapSquare: '<wp:wrapNone/>',
      })
    );
    selectInlineDrawing(behind);
    await settleDrawingResources(behind);
    expect(behind.snapshot().image?.wrap).toBe('behind');

    const front = mountEditor(
      inlinePictureDocument({
        wrap: 'anchor',
        behindDoc: '0',
        wrapSquare: '<wp:wrapNone/>',
      })
    );
    selectInlineDrawing(front);
    await settleDrawingResources(front);
    expect(front.snapshot().image?.wrap).toBe('inFront');
  });

  test('reports all nine wrap targets from anchored square sides', () => {
    const cases: ReadonlyArray<{
      readonly wrapSquare: string;
      readonly expected: ImageWrapTarget;
    }> = [
      { wrapSquare: '<wp:wrapSquare wrapText="bothSides"/>', expected: 'square' },
      { wrapSquare: '<wp:wrapSquare wrapText="left"/>', expected: 'squareLeft' },
      { wrapSquare: '<wp:wrapSquare wrapText="right"/>', expected: 'squareRight' },
      {
        wrapSquare:
          '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="914400" y="0"/><wp:lineTo x="914400" y="914400"/><wp:lineTo x="0" y="914400"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>',
        expected: 'tight',
      },
      {
        wrapSquare:
          '<wp:wrapThrough wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="914400" y="0"/><wp:lineTo x="914400" y="914400"/><wp:lineTo x="0" y="914400"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapThrough>',
        expected: 'through',
      },
      { wrapSquare: '<wp:wrapTopAndBottom/>', expected: 'topAndBottom' },
    ];
    for (const { wrapSquare, expected } of cases) {
      const editor = mountEditor(inlinePictureDocument({ wrap: 'anchor', wrapSquare }));
      selectInlineDrawing(editor);
      expect(editor.snapshot().image?.wrap).toBe(expected);
    }
    expect(IMAGE_WRAP_TARGETS).toContain('behind');
    expect(IMAGE_WRAP_TARGETS).toContain('inFront');
  });

  test('unsupported picture reports resource status with null intrinsic', async () => {
    const bytes = inlinePictureDocument({ embed: 'rIdMissing' });
    const editor = mountEditor(bytes);
    selectInlineDrawing(editor);
    await settleDrawingResources(editor);
    const image = editor.snapshot().image;
    expect(image).not.toBeNull();
    expect(image!.resourceStatus).toBe('missing');
    expect(image!.intrinsic).toBeNull();
  });
});

describe('docx-editor image commands', () => {
  test('routes deleteImage through package transactions', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    const id = editor.snapshot().image!.id;
    const beforeRevision = editor.surface!.session.packageRevision();
    const result = editor.exec({ type: 'deleteImage' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.surface!.session.packageRevision()).toBeGreaterThan(beforeRevision);
    selectInlineDrawing(editor);
    expect(editor.snapshot().image).toBeNull();
    editor.exec({ type: 'undo' });
    selectInlineDrawing(editor);
    expect(editor.snapshot().image?.id).toBe(id);
  });

  test('refuses image commands without a selected picture', () => {
    const editor = mountEditor(inlinePictureDocument());
    const paragraphId = drawingParagraphId(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    const refused = editor.can({ type: 'deleteImage' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('no drawing');
  });

  test('refuses deleteImage in read-only viewing mode', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: inlinePictureDocument(),
      mode: 'view',
      imageDecodePort: createTestImageDecodePort(),
    });
    selectInlineDrawing(editor);
    const refused = editor.can({ type: 'deleteImage' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('locked');
  });

  test('routes insertImage through package transactions', async () => {
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
    const beforeRevision = editor.surface!.session.packageRevision();
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG_1X1,
      mime: 'image/png',
      widthPoints: 72,
      heightPoints: 72,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBeGreaterThan(beforeRevision);
    await settleDrawingResources(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    await settleDrawingResources(editor);
    expect(editor.snapshot().image).not.toBeNull();
    expect(editor.snapshot().image!.resourceStatus).toBe('ready');
  });

  test('refuses setImageWrapType with stale drawing id', () => {
    const editor = mountEditor(inlinePictureDocument());
    selectInlineDrawing(editor);
    const staleId = editor.snapshot().image!.id;
    editor.exec({ type: 'deleteImage' });
    const refused = editor.exec({
      type: 'setImageWrapType',
      target: 'square',
      drawingNodeId: staleId,
    } as never);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('stale');
  });
});
