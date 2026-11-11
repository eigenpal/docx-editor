// Shapes, lines and groups select as objects. A drawing behind the text takes a press where
// no glyph lies under it; a press on text over it places the caret. `wp:anchor/@locked` fixes
// only the anchor paragraph, so a locked drawing still selects, moves and deletes. A shape
// moves and deletes but does not resize: its size also lives in its own geometry.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { selectedDrawingOverlayTargetOf } from '../docx-editor-images.ts';
import { passDrawingFramePressToText } from '../drawing-overlay-press.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const SHAPE_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const GROUP_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

const spPr = (cx: number, cy: number, geometry: string, fill: string) =>
  `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  `<a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>${fill}` +
  '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>';
const wsp = (cx: number, cy: number, geometry: string, fill: string) =>
  `<wps:wsp><wps:cNvSpPr/>${spPr(cx, cy, geometry, fill)}<wps:bodyPr/></wps:wsp>`;
const SOLID = (hex: string) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;

function anchor(options: {
  id: number;
  name: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
  graphic: string;
  uri: string;
  behind?: boolean;
  locked?: boolean;
}): string {
  const { id, name, x, y, cx, cy } = options;
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ` +
    `relativeHeight="${id}" behindDoc="${options.behind ? 1 : 0}" ` +
    `locked="${options.locked ? 1 : 0}" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="margin"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="margin"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${id}" name="${name}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="${options.uri}">${options.graphic}</a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const EMU = 12_700;
/** A pale rectangle behind the first lines, locked to its anchor paragraph. */
const BEHIND = anchor({
  id: 1,
  name: 'Background',
  x: 0,
  y: 0,
  cx: 400 * EMU,
  cy: 60 * EMU,
  graphic: wsp(400 * EMU, 60 * EMU, 'rect', SOLID('FFE699')),
  uri: SHAPE_URI,
  behind: true,
  locked: true,
});
/** A line in front of the text, well below the first lines. */
const LINE = anchor({
  id: 2,
  name: 'Rule',
  x: 0,
  y: 200 * EMU,
  cx: 200 * EMU,
  cy: 0,
  graphic: wsp(200 * EMU, 0, 'line', ''),
  uri: SHAPE_URI,
});
/** A group of two rectangles in front of the text, further down. */
const GROUP = anchor({
  id: 3,
  name: 'Group',
  x: 0,
  y: 300 * EMU,
  cx: 200 * EMU,
  cy: 40 * EMU,
  graphic:
    '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${200 * EMU}" cy="${40 * EMU}"/><a:chOff x="0" y="0"/>` +
    `<a:chExt cx="${200 * EMU}" cy="${40 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
    wsp(100 * EMU, 40 * EMU, 'rect', SOLID('9DC3E6')).replace(
      '<a:off x="0" y="0"/>',
      '<a:off x="0" y="0"/>'
    ) +
    wsp(100 * EMU, 40 * EMU, 'rect', SOLID('A9D18E')).replace(
      '<a:off x="0" y="0"/>',
      `<a:off x="${100 * EMU}" y="0"/>`
    ) +
    '</wpg:wgp>',
  uri: GROUP_URI,
});

function documentBytes(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}" ` +
        `xmlns:wpg="${WPG}" xmlns:mc="${MC}"><w:body>${body}</w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"></Relationships>`),
  });
}

const p = (content: string) => `<w:p>${content}</w:p>`;
const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
const BODY =
  p(BEHIND + text('Short')) +
  p(text('Second')) +
  p(LINE + GROUP + text('Third')) +
  Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

async function mount(body = BODY): Promise<{ editor: DocxEditorInstance; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: documentBytes(body) });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface?.layout();
  }
  return { editor, container };
}

/** The drawing whose `relativeHeight` is `id`: each fixture drawing has its own. */
function drawingNamed(editor: DocxEditorInstance, id: number): AnchoredDrawingRecord {
  for (const page of editor.surface!.layout().pages)
    for (const drawing of page.anchoredDrawings ?? [])
      if (drawing.relativeHeight === id) return drawing;
  throw new Error(`no drawing ${id}`);
}

/** The sheet paints points at CSS pixels: 96 per inch over 72. */
const SCALE = 96 / 72;

/** A primary press at a point in the first page's content box, in its own points. */
function pressAt(
  container: HTMLElement,
  editor: DocxEditorInstance,
  x: number,
  y: number,
  target = container.querySelector<HTMLElement>('.docx-page-content')!
) {
  const page = editor.surface!.layout().pages[0]!;
  const event = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    clientX: (page.contentBox.x + x) * SCALE,
    clientY: (page.contentBox.y + y) * SCALE,
  });
  target.dispatchEvent(event);
  return event;
}

/** A press at the middle of a drawing in front of the text, on its painted element. */
function pressOn(
  container: HTMLElement,
  editor: DocxEditorInstance,
  drawing: AnchoredDrawingRecord
) {
  const painted = container.querySelector<HTMLElement>(
    `[data-drawing-node-id="${CSS.escape(drawing.drawingNodeId)}"]`
  )!;
  const { x, y, width, height } = drawing;
  return pressAt(container, editor, x + width / 2, y + height / 2, painted);
}

async function saved(editor: DocxEditorInstance): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
}

test('a press on a shape behind the text, away from any glyph, selects it', async () => {
  const { editor, container } = await mount();
  try {
    const background = drawingNamed(editor, 1);
    const firstLine = editor.surface!.layout().pages[0]!.fragments[0]!;
    // Right of "Short" on the first line, inside the rectangle.
    const event = pressAt(container, editor, 380, firstLine.box.y + 4);
    expect(event.defaultPrevented).toBe(true);
    const selected = editor.getSelectedImage!();
    expect(selected).toMatchObject({ id: background.drawingNodeId, canMove: true });
    // Its size also lives in its own geometry, so it offers no resize.
    expect(selected!.canResize).toBe(false);
    expect(selectedDrawingOverlayTargetOf(editor.surface)).toMatchObject({
      id: background.drawingNodeId,
      canMove: true,
      canResize: false,
    });
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a press on text over a shape behind it places the caret there', async () => {
  const { editor, container } = await mount();
  try {
    const firstLine = editor.surface!.layout().pages[0]!.fragments[0]!;
    const event = pressAt(container, editor, 2, firstLine.box.y + 4);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getSelectedImage!()).toBeNull();
    expect(editor.surface!.drawingSelectionIntent().kind).toBe('none');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a line and a group in front of the text select as objects', async () => {
  const { editor, container } = await mount();
  try {
    for (const id of [2, 3]) {
      const record = drawingNamed(editor, id);
      pressOn(container, editor, record);
      expect(editor.getSelectedImage!()).toMatchObject({
        id: record.drawingNodeId,
        canMove: true,
        canResize: false,
        canCrop: false,
      });
    }
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a selected shape deletes whole and comes back on undo; its anchor stays locked', async () => {
  const { editor, container } = await mount();
  try {
    const firstLine = editor.surface!.layout().pages[0]!.fragments[0]!;
    pressAt(container, editor, 380, firstLine.box.y + 4);
    expect(editor.can({ type: 'deleteImage' })).toEqual({ ok: true });
    expect(editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true, changed: true });
    expect(await saved(editor)).not.toContain('Background');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    const restored = await saved(editor);
    expect(restored).toContain('name="Background"');
    expect(restored).toContain('locked="1"');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a select lock still keeps a shape behind the text from taking the press', async () => {
  const locked = BEHIND.replace(
    '<wp:cNvGraphicFramePr/>',
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noSelect="1"/></wp:cNvGraphicFramePr>`
  );
  const { editor, container } = await mount(p(locked + text('Short')) + p(text('Second')));
  try {
    const firstLine = editor.surface!.layout().pages[0]!.fragments[0]!;
    pressAt(container, editor, 380, firstLine.box.y + 4);
    expect(editor.getSelectedImage!()).toBeNull();
    expect(editor.surface!.drawingSelectionIntent().kind).toBe('none');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a locked anchor stays in its paragraph when the shape moves down the page', async () => {
  const { editor, container } = await mount();
  try {
    const before = drawingNamed(editor, 1);
    const firstLine = editor.surface!.layout().pages[0]!.fragments[0]!;
    pressAt(container, editor, 380, firstLine.box.y + 4);
    const verticalEmu = Math.round(240 * EMU);
    expect(editor.exec({ type: 'setImagePosition', verticalEmu })).toMatchObject({ ok: true });
    const after = drawingNamed(editor, 1);
    expect(after.y).toBeGreaterThan(before.y + 200);
    expect(after.anchorParagraphId).toBe(before.anchorParagraphId);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a press just off a straight line still reaches it; one further away does not', async () => {
  const { editor, container } = await mount();
  try {
    const line = drawingNamed(editor, 2);
    const painted = container.querySelector<HTMLElement>(
      `[data-drawing-node-id="${CSS.escape(line.drawingNodeId)}"]`
    )!;
    pressAt(container, editor, line.x + 50, line.y + 2, painted);
    expect(editor.getSelectedImage!()).toMatchObject({ id: line.drawingNodeId });
    pressAt(container, editor, line.x + 50, line.y + 12);
    expect(editor.getSelectedImage!()).toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('Delete removes a shape selected behind the text', async () => {
  const { editor, container } = await mount();
  try {
    const firstLine = editor.surface!.layout().pages[0]!.fragments[0]!;
    pressAt(container, editor, 380, firstLine.box.y + 4);
    const key = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    container.querySelector<HTMLElement>('.docx-page-content')!.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    const xml = await saved(editor);
    expect(xml).not.toContain('Background');
    expect(xml).toContain('Short');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('with the shape behind the text selected, a press on its frame over text places the caret', async () => {
  const { editor, container } = await mount();
  try {
    const page = editor.surface!.layout().pages[0]!;
    const firstLine = page.fragments[0]!;
    pressAt(container, editor, 380, firstLine.box.y + 4);
    expect(editor.getSelectedImage!()).not.toBeNull();
    // The frame an adapter paints over the drawing: off the pages, as in a portal.
    const frame = document.createElement('div');
    container.append(frame);
    const results: boolean[] = [];
    frame.addEventListener('pointerdown', (event) =>
      results.push(passDrawingFramePressToText(editor, event))
    );
    const press = (x: number) =>
      frame.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          clientX: (page.contentBox.x + x) * SCALE,
          clientY: (page.contentBox.y + firstLine.box.y + 4) * SCALE,
        })
      );
    // Where no glyph lies under it, the frame keeps the press, to move the shape.
    press(380);
    expect(results).toEqual([false]);
    // On "Short", the text takes it: the caret lands there and the shape is no longer selected.
    press(2);
    expect(results).toEqual([false, true]);
    expect(editor.getSelectedImage!()).toBeNull();
    expect(editor.surface!.state().selection.head.offset).toBeLessThan(3);
  } finally {
    editor.destroy();
    container.remove();
  }
});
