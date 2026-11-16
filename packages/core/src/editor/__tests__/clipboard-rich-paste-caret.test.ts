// A rich paste leaves the caret after the pasted content, as Word and the plain lane do.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

function copied(body: string, from: number, to: number): { text: string; html: string | null } {
  const source = mount(body);
  const ids = source.surface.session.paragraphIds();
  source.surface.setSelection({
    anchor: { paragraphId: ids[0]!, offset: from },
    head: { paragraphId: ids[ids.length - 1]!, offset: to },
  });
  const flavours = source.surface.copyFlavours();
  source.surface.destroy();
  return flavours;
}

describe('caret after a rich paste', () => {
  test('an inline fragment leaves the caret after the pasted text', () => {
    const flavours = copied(paragraph('hello world'), 0, 5);
    expect(flavours.html).toContain('data-docx-fragment="');

    const target = mount(paragraph('abcdef'));
    putCaret(target.surface, 3);
    expect(target.surface.pasteRich(flavours.text, flavours.html)).toBe(true);

    const [id] = target.surface.session.paragraphIds();
    expect(target.surface.session.bodyText()).toBe('abchellodef');
    expect(target.surface.state().selection.head).toEqual({ paragraphId: id!, offset: 8 });
    expect(target.surface.state().selection.anchor).toEqual({ paragraphId: id!, offset: 8 });
    target.surface.destroy();
  });

  test('a multi-paragraph fragment leaves the caret after the last pasted line', () => {
    const flavours = copied(paragraph('one') + paragraph('two!'), 0, 3);

    const target = mount(paragraph('abcdef'));
    putCaret(target.surface, 3);
    expect(target.surface.pasteRich(flavours.text, flavours.html)).toBe(true);

    const ids = target.surface.session.paragraphIds();
    expect(ids).toHaveLength(2);
    expect(target.surface.state().selection.head).toEqual({ paragraphId: ids[1]!, offset: 3 });
    target.surface.destroy();
  });

  test('external HTML leaves the caret after the pasted text', () => {
    const target = mount(paragraph('abcdef'));
    putCaret(target.surface, 3);
    expect(target.surface.pasteRich('new', '<p><b>new</b></p>')).toBe(true);

    const [id] = target.surface.session.paragraphIds();
    expect(target.surface.session.bodyText()).toBe('abcnewdef');
    expect(target.surface.state().selection.head).toEqual({ paragraphId: id!, offset: 6 });
    target.surface.destroy();
  });

  test('a paste over a selection leaves the caret after the replacement', () => {
    const flavours = copied(paragraph('XYZ'), 0, 2);

    const target = mount(paragraph('abcdef'));
    const [id] = target.surface.session.paragraphIds();
    target.surface.setSelection({
      anchor: { paragraphId: id!, offset: 1 },
      head: { paragraphId: id!, offset: 4 },
    });
    expect(target.surface.pasteRich(flavours.text, flavours.html)).toBe(true);

    expect(target.surface.session.bodyText()).toBe('aXYef');
    expect(target.surface.state().selection.head).toEqual({ paragraphId: id!, offset: 3 });
    target.surface.destroy();
  });
});
