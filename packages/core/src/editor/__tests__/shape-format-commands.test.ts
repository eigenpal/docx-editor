// `setShapeFill` and `setShapeOutline` on a selected shape, line or group: each is one undo
// step, the selected image state reads the result back, and `can` refuses what exec refuses.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { drawingNamed, gapY, mount, pressAt, pressOn, saved } from './shape-selection-fixture.ts';

test('a fill and an outline each apply as one undo step and read back', async () => {
  const { editor, container } = await mount();
  try {
    pressAt(container, editor, 380, gapY(editor));
    expect(editor.getSelectedImage!()?.shapeFormat).toEqual({
      fill: { type: 'solid', color: 'FFE699', transparency: 0 },
      outline: { visible: true, color: '000000', widthPt: 1 },
    });
    expect(editor.can({ type: 'setShapeFill', color: '#4472c4', transparency: 0.4 })).toEqual({
      ok: true,
    });
    expect(
      editor.exec({ type: 'setShapeFill', color: '#4472c4', transparency: 0.4 })
    ).toMatchObject({ ok: true, changed: true });
    expect(editor.exec({ type: 'setShapeOutline', color: 'C00000', widthPt: 3 })).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(editor.snapshot().image?.shapeFormat).toEqual({
      fill: { type: 'solid', color: '4472C4', transparency: 0.4 },
      outline: { visible: true, color: 'C00000', widthPt: 3 },
    });
    const xml = await saved(editor);
    expect(xml).toContain('<a:srgbClr val="4472C4"><a:alpha val="60000"/></a:srgbClr>');
    expect(xml).toContain('<a:ln w="38100"><a:solidFill><a:srgbClr val="C00000"/>');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.outline.color).toBe('000000');
    expect(editor.getSelectedImage!()?.shapeFormat?.fill.color).toBe('4472C4');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(await saved(editor)).toContain('<a:srgbClr val="FFE699"/>');
    expect(editor.exec({ type: 'setShapeFill', visible: false })).toMatchObject({ ok: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.fill.type).toBe('none');
    expect(editor.exec({ type: 'setShapeFill', visible: true })).toMatchObject({ ok: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.fill.color).toBe('FFE699');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a group takes the fill on every shape; bad values and stale ids refuse in can and exec', async () => {
  const { editor, container } = await mount();
  try {
    const group = drawingNamed(editor, 3);
    pressOn(container, editor, group);
    expect(editor.exec({ type: 'setShapeFill', color: '00B050' })).toMatchObject({ ok: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.fill).toEqual({
      type: 'solid',
      color: '00B050',
      transparency: 0,
    });
    for (const command of [
      { type: 'setShapeFill', color: 'green' },
      { type: 'setShapeFill', transparency: 1.5 },
      { type: 'setShapeFill' },
      { type: 'setShapeOutline', widthPt: 0 },
      { type: 'setShapeOutline', visible: false, color: '000000' },
    ] as const) {
      expect(editor.can(command)).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(editor.exec(command)).toMatchObject({ ok: false, code: 'invalidArgs' });
    }
    expect(editor.can({ type: 'setShapeFill', color: '000000', drawingNodeId: 'x' })).toMatchObject(
      { ok: false, code: 'notFound' }
    );
    const line = drawingNamed(editor, 2);
    pressOn(container, editor, line);
    expect(editor.exec({ type: 'setShapeOutline', visible: false })).toMatchObject({ ok: true });
    expect(editor.getSelectedImage!()?.shapeFormat?.outline.visible).toBe(false);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('with nothing selected the commands refuse', async () => {
  const { editor, container } = await mount();
  try {
    expect(editor.can({ type: 'setShapeOutline', color: '000000' })).toMatchObject({
      ok: false,
      code: 'notFound',
    });
  } finally {
    editor.destroy();
    container.remove();
  }
});
