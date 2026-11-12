// A turned top-level shape or line paints turned about its extent centre, past its extent, and
// a press on what it paints selects it, even outside its unturned box. Its frame rings the
// turned extent; fill and outline edits keep the turn and flips on save.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import type { DocxEditorInstance } from '../docx-editor.ts';
import type { InlineDrawingRecord } from '../../layout/drawing-layout.ts';
import type { BlockFragmentRecord } from '../../layout/semantic-records.ts';
import { findDrawingOverlayFrameInLayout } from '../../layout/semantic-hit-test.ts';
import { selectedDrawingOverlayTargetOf } from '../docx-editor-images.ts';
import {
  EMU,
  SHAPE_URI,
  anchor,
  drawingNamed,
  mount,
  p,
  pressAt,
  saved,
  text,
} from './shape-selection-fixture.ts';

const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');
const RED = '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>';
const OUTLINE = '<a:ln w="25400"><a:solidFill><a:srgbClr val="000080"/></a:solidFill></a:ln>';

function graphic(cx: number, cy: number, xfrm: string, prst: string, paint: string): string {
  return (
    `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm${xfrm}><a:off x="0" y="0"/>` +
    `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    `${paint}</wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

/** A 144 x 72pt red rectangle turned 30 degrees, at (100, 200)pt from the margins. */
const TURNED_RECT = anchor({
  id: 21,
  name: 'Turned',
  x: 100 * EMU,
  y: 200 * EMU,
  cx: 144 * EMU,
  cy: 72 * EMU,
  graphic: graphic(144 * EMU, 72 * EMU, ' rot="1800000" flipH="1"', 'rect', RED),
  uri: SHAPE_URI,
});

/** A 144pt line turned a quarter turn, upright through its centre at (172, 400)pt. */
const TURNED_LINE = anchor({
  id: 22,
  name: 'Upright line',
  x: 100 * EMU,
  y: 400 * EMU,
  cx: 144 * EMU,
  cy: 0,
  graphic: graphic(144 * EMU, 0, ' rot="5400000"', 'line', `<a:noFill/>${OUTLINE}`),
  uri: SHAPE_URI,
});

/** A line with no width and no height at (300, 400)pt: it paints nothing. */
const POINT_LINE = anchor({
  id: 23,
  name: 'Point',
  x: 300 * EMU,
  y: 400 * EMU,
  cx: 0,
  cy: 0,
  graphic: graphic(0, 0, ' rot="2700000"', 'line', `<a:noFill/>${OUTLINE}`),
  uri: SHAPE_URI,
});

async function withEditor(
  body: string,
  run: (editor: DocxEditorInstance, container: HTMLElement) => Promise<void> | void,
  header?: string
) {
  const { editor, container } = await mount(body, header);
  try {
    await run(editor, container);
  } finally {
    editor.destroy();
    container.remove();
  }
}

const centreOf = (editor: DocxEditorInstance, id: number) => {
  const box = drawingNamed(editor, id).geometry.contentBounds;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const painted = (container: HTMLElement, editor: DocxEditorInstance, id: number) =>
  container.querySelector<HTMLElement>(
    `[data-drawing-node-id="${CSS.escape(drawingNamed(editor, id).drawingNodeId)}"]`
  );

const selectedId = (editor: DocxEditorInstance) => editor.getSelectedImage!()?.id ?? null;

test('a turned shape paints past its box and a press on its turned corner selects it', async () => {
  await withEditor(p(TURNED_RECT + text('Anchor')) + FILLERS, (editor, container) => {
    const record = drawingNamed(editor, 21);
    expect(record.vectorShape?.rotationDegrees).toBe(30);
    expect(record.placeholderGraphicKind).not.toBeNull();
    // The paint clip reaches past the extent on every side the turned corners reach.
    expect(painted(container, editor, 21)!.style.clipPath).toContain('-');
    const c = centreOf(editor, 21);
    // Inside the turned rectangle and left of its unturned box: the press reaches the page.
    pressAt(container, editor, c.x - 78, c.y - 4.8);
    expect(selectedId(editor)).toBe(record.drawingNodeId);
    // The frame rings the turned extent: 144 x 72pt turned 30 degrees.
    const frame = selectedDrawingOverlayTargetOf(editor.surface!)!;
    expect(frame.width).toBeCloseTo(160.71, 1);
    expect(frame.height).toBeCloseTo(134.35, 1);
    expect(frame.x).toBeCloseTo(c.x - 80.35, 1);
    expect(frame.y).toBeCloseTo(c.y - 67.18, 1);
    // The unturned box corner, off the turned geometry, goes to the text.
    pressAt(container, editor, c.x - 70, c.y - 34, painted(container, editor, 21)!);
    expect(selectedId(editor)).toBeNull();
  });
});

test('fill and outline edits on a turned shape keep its turn and flip on save', async () => {
  await withEditor(p(TURNED_RECT + text('Anchor')) + FILLERS, async (editor, container) => {
    const c = centreOf(editor, 21);
    pressAt(container, editor, c.x, c.y, painted(container, editor, 21)!);
    expect(editor.getSelectedImage!()?.shapeFormat?.fill).toMatchObject({ color: 'FF0000' });
    expect(editor.getSelectedImage!()?.rotationDegrees).toBe(30);
    expect(editor.getSelectedImage!()?.canResize).toBe(false);
    expect(editor.getSelectedImage!()?.canMove).toBe(true);
    expect(editor.exec({ type: 'setShapeFill', color: '00B050' })).toMatchObject({ ok: true });
    expect(editor.exec({ type: 'setShapeOutline', color: 'C00000', widthPt: 2 })).toMatchObject({
      ok: true,
    });
    const xml = await saved(editor);
    expect(xml).toMatch(/<a:xfrm (flipH="1" rot="1800000"|rot="1800000" flipH="1")>/);
    expect(xml).toContain('<a:srgbClr val="00B050"/>');
    expect(xml).toContain('<a:ln w="25400"><a:solidFill><a:srgbClr val="C00000"/>');
    // The edited shape still paints turned.
    expect(drawingNamed(editor, 21).vectorShape?.rotationDegrees).toBe(30);
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(await saved(editor)).toContain('<a:srgbClr val="FF0000"/>');
    // Delete removes the selected turned shape.
    pressAt(container, editor, c.x, c.y, painted(container, editor, 21)!);
    expect(editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    expect(await saved(editor)).not.toContain('rot="1800000"');
  });
});

test('a turned line takes a press on its turned path, not on its unturned one', async () => {
  await withEditor(p(TURNED_LINE + POINT_LINE + text('Anchor')) + FILLERS, (editor, container) => {
    const line = drawingNamed(editor, 22);
    const c = centreOf(editor, 22);
    pressAt(container, editor, c.x + 1, c.y + 50);
    expect(selectedId(editor)).toBe(line.drawingNodeId);
    const frame = selectedDrawingOverlayTargetOf(editor.surface!)!;
    expect(frame.width).toBeCloseTo(0, 3);
    expect(frame.height).toBeCloseTo(144, 3);
    pressAt(container, editor, c.x + 50, c.y);
    expect(selectedId(editor)).toBeNull();
  });
});

test('a line with no width and no height paints nothing and still selects', async () => {
  await withEditor(
    p(TURNED_LINE + POINT_LINE + text('Anchor')) + FILLERS,
    async (editor, container) => {
      const point = drawingNamed(editor, 23);
      expect(point.vectorShape?.components).toEqual([]);
      expect(painted(container, editor, 23)?.querySelector('path') ?? null).toBeNull();
      const box = point.geometry.contentBounds;
      pressAt(container, editor, box.x + 1, box.y + 1);
      expect(selectedId(editor)).toBe(point.drawingNodeId);
      expect(await saved(editor)).toContain('<a:ext cx="0" cy="0"/>');
    }
  );
});

/** Every inline drawing record on the first page, in fragment order. */
function inlineDrawings(editor: DocxEditorInstance): InlineDrawingRecord[] {
  const found: InlineDrawingRecord[] = [];
  const walk = (blocks: readonly BlockFragmentRecord[]) => {
    for (const block of blocks) {
      if (block.kind !== 'paragraph') continue;
      for (const line of block.lines) found.push(...(line.drawings ?? []));
    }
  };
  walk(editor.surface!.layout().pages[0]!.fragments);
  return found;
}

test('a turned inline shape takes a press where it paints over the line above', async () => {
  const inline =
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${144 * EMU}" cy="${72 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:docPr id="31" name="Inline turned"/><wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${SHAPE_URI}">` +
    graphic(144 * EMU, 72 * EMU, ' rot="1800000"', 'rect', RED) +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const body = p(text('Line above the shape')) + p(inline + text('after')) + FILLERS;
  await withEditor(body, (editor, container) => {
    const [drawing] = inlineDrawings(editor);
    expect(drawing?.vectorShape?.rotationDegrees).toBe(30);
    const box = drawing!.geometry.contentBounds;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Near the top corner, above the shape's own line: on the line above.
    expect(c.y - 50).toBeLessThan(drawing!.y);
    pressAt(container, editor, c.x - 30, c.y - 50);
    expect(selectedId(editor)).toBe(drawing!.drawingNodeId);
  });
});

test('a turned header shape frames its turned extent', async () => {
  const header = p(TURNED_RECT + text('Header'));
  await withEditor(
    p(text('Body')) + FILLERS,
    (editor) => {
      const layout = editor.surface!.layout();
      const drawing = layout.pages[0]!.header?.anchoredDrawings?.[0];
      expect(drawing?.vectorShape?.rotationDegrees).toBe(30);
      const frame = findDrawingOverlayFrameInLayout(layout, drawing!.drawingNodeId, 0)!;
      expect(frame.width).toBeCloseTo(160.71, 1);
      expect(frame.height).toBeCloseTo(134.35, 1);
    },
    header
  );
});
