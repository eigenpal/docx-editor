// Tab and Shift+Tab over a selection outside a list.
//
// A selection over paragraphs, or from a paragraph start, changes the indent and keeps the
// text. A selection that starts inside the text, and a caret, still type a tab character.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { PaginatedSurface } from '../paginated-surface.ts';
import { createKeyDownHandler } from '../surface-input.ts';
import { directParagraphProperties } from '../surface-formatting.ts';
import { INDENT_STEP_TWIPS, nextLeftIndent, tabIndentFor } from '../surface-indent-step.ts';
import { MAX_PARAGRAPH_INDENT_TWIPS } from '../../layout/paragraph-indent.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { mount as mountFixture, trackedDocx } from './paginated-surface-fixtures.ts';

const mounted: PaginatedSurface[] = [];
afterEach(() => {
  for (const surface of mounted.splice(0)) surface.destroy();
});

function mount(body: string): PaginatedSurface {
  const { surface } = mountFixture(body);
  mounted.push(surface);
  return surface;
}

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const THREE = paragraph('Alpha beta gamma') + paragraph('Second line') + paragraph('Third');

function paragraphIds(surface: PaginatedSurface): string[] {
  return [...surface.session.paragraphIds()];
}

function indentOf(surface: PaginatedSurface, paragraphId: string): Record<string, string> {
  const ind = directParagraphProperties(surface.session.part(), paragraphId).find(
    (property) => property.localName === 'ind'
  );
  return { ...ind?.attributes };
}

function press(
  surface: PaginatedSurface,
  from: [number, number],
  to: [number, number],
  shiftKey = false
) {
  const ids = paragraphIds(surface);
  surface.setSelection({
    anchor: { paragraphId: ids[from[0]]!, offset: from[1] },
    head: { paragraphId: ids[to[0]]!, offset: to[1] },
  });
  createKeyDownHandler(surface)({
    key: 'Tab',
    preventDefault: () => {},
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  } as KeyboardEvent);
  return ids;
}

const xml = (surface: PaginatedSurface) => serializeOoxmlPart(surface.session.part());
// A tab CHARACTER is a bare `<w:tab/>`; a tab stop always carries attributes.
const hasTab = (surface: PaginatedSurface) => xml(surface).includes('<w:tab/>');

describe('Tab over a selection', () => {
  test('a whole selected paragraph gets a first-line indent and keeps its text', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 0], [0, 16]);
    expect(xml(surface)).toContain('Alpha beta gamma');
    expect(hasTab(surface)).toBe(false);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ firstLine: '720' });
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });

  test('a selection that also takes the paragraph mark acts on that paragraph only', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 0], [1, 0]);
    expect(xml(surface)).toContain('Alpha beta gamma');
    expect(indentOf(surface, ids[0]!).firstLine).toBe('720');
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });

  test('a selection from the paragraph start into the text also indents the first line', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 0], [0, 5]);
    expect(xml(surface)).toContain('Alpha beta gamma');
    expect(indentOf(surface, ids[0]!).firstLine).toBe('720');
  });

  test('hidden leading text does not move the paragraph start', () => {
    const surface = mount(
      '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>hid</w:t></w:r><w:r><w:t>Shown</w:t></w:r></w:p>'
    );
    const ids = press(surface, [0, 3], [0, 8]);
    expect(xml(surface)).toContain('Shown');
    expect(hasTab(surface)).toBe(false);
    expect(indentOf(surface, ids[0]!).firstLine).toBe('720');
  });

  test('a first line already indented one tab stop steps the left indent', () => {
    const surface = mount(paragraph('Indented', '<w:pPr><w:ind w:firstLine="720"/></w:pPr>'));
    const ids = press(surface, [0, 0], [0, 8]);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '720', firstLine: '720' });
    expect(xml(surface)).toContain('Indented');
  });

  test('a hanging-indent paragraph keeps its hanging indent and moves one step', () => {
    const surface = mount(
      paragraph('Hanging entry', '<w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr>')
    );
    const ids = press(surface, [0, 0], [0, 13]);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '1440', hanging: '720' });
    expect(xml(surface)).toContain('Hanging entry');
  });

  test('a selection over several paragraphs steps the left indent of each one', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 6], [1, 3]);
    expect(xml(surface)).toContain('Alpha beta gamma');
    expect(xml(surface)).toContain('Second line');
    expect(hasTab(surface)).toBe(false);
    expect(indentOf(surface, ids[0]!).left).toBe('720');
    expect(indentOf(surface, ids[1]!).left).toBe('720');
    expect(indentOf(surface, ids[2]!)).toEqual({});
  });

  test('an indent at its bound stays put and keeps the text', () => {
    const at = `<w:pPr><w:ind w:left="${MAX_PARAGRAPH_INDENT_TWIPS}"/></w:pPr>`;
    const surface = mount(paragraph('One', at) + paragraph('Two', at));
    press(surface, [0, 1], [1, 2]);
    expect(xml(surface)).toContain('One');
    expect(xml(surface)).toContain('Two');
    expect(hasTab(surface)).toBe(false);
  });

  test('a selection that starts inside the text is replaced by a tab', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 6], [0, 10]);
    expect(xml(surface)).not.toContain('beta');
    expect(hasTab(surface)).toBe(true);
    expect(indentOf(surface, ids[0]!)).toEqual({});
  });

  test('a caret at the paragraph start still types a tab', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 0], [0, 0]);
    expect(hasTab(surface)).toBe(true);
    expect(indentOf(surface, ids[0]!)).toEqual({});
  });

  test('one undo step restores the paragraphs', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 6], [1, 3]);
    surface.undo();
    expect(indentOf(surface, ids[0]!)).toEqual({});
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });
});

describe('the document tab grid', () => {
  test('Tab indents the first line by the default tab stop', () => {
    const bytes = trackedDocx('<w:defaultTabStop w:val="708"/>');
    const opened = mountPaginatedSurface(document.createElement('div'), bytes, { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    mounted.push(surface);
    const ids = press(surface, [0, 0], [0, 7]);
    expect(indentOf(surface, ids[0]!).firstLine).toBe('708');
    expect(xml(surface)).toContain('tracked');
  });
});

describe('Shift+Tab over a selection', () => {
  test('reverses two Tab presses, the left indent first and then the first line', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 0], [0, 16]);
    press(surface, [0, 0], [0, 16]);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '720', firstLine: '720' });
    press(surface, [0, 0], [0, 16], true);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '0', firstLine: '720' });
    press(surface, [0, 0], [0, 16], true);
    expect(indentOf(surface, ids[0]!).firstLine ?? '0').toBe('0');
    expect(xml(surface)).toContain('Alpha beta gamma');
  });

  test('steps the leading indent of a right-to-left paragraph back before its first line', () => {
    const surface = mount(
      paragraph('Right to left', '<w:pPr><w:bidi/><w:ind w:left="720" w:firstLine="720"/></w:pPr>')
    );
    const ids = press(surface, [0, 0], [0, 13], true);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '0', firstLine: '720' });
    press(surface, [0, 0], [0, 13], true);
    expect(indentOf(surface, ids[0]!).firstLine ?? '0').toBe('0');
  });

  test('leaves a last paragraph touched only at its start alone, as Tab does', () => {
    const indented = '<w:pPr><w:ind w:left="720"/></w:pPr>';
    const surface = mount(
      paragraph('One', indented) + paragraph('Two', indented) + paragraph('Three', indented)
    );
    const ids = press(surface, [0, 1], [2, 0], true);
    expect(indentOf(surface, ids[0]!).left).toBe('0');
    expect(indentOf(surface, ids[1]!).left).toBe('0');
    expect(indentOf(surface, ids[2]!).left).toBe('720');
  });
});

describe('tabIndentFor', () => {
  const at = (paragraphId: string, offset: number) => ({ paragraphId, offset });
  const reads = (start = 0, firstLine = 0, paragraphStart = 0) => ({
    paragraphStart: () => paragraphStart,
    indent: () => ({ start, firstLine }),
  });

  test('answers null for a caret and for a selection inside one paragraph', () => {
    const caret = { from: at('a', 0), to: at('a', 0) };
    const inside = { from: at('a', 2), to: at('a', 4) };
    expect(tabIndentFor(caret, ['a'], reads(), 'increase', 720)).toBeNull();
    expect(tabIndentFor(inside, ['a'], reads(), 'increase', 720)).toBeNull();
  });

  test('drops a last paragraph that is touched only at its start', () => {
    const toC = { from: at('a', 3), to: at('c', 0) };
    const toB = { from: at('a', 3), to: at('b', 0) };
    expect(tabIndentFor(toC, ['a', 'b', 'c'], reads(), 'increase', 720)).toEqual({
      write: 'stepLeft',
      paragraphs: ['a', 'b'],
    });
    expect(tabIndentFor(toB, ['a', 'b'], reads(), 'increase', 720)).toBeNull();
  });

  test('a hanging or wide first line steps the left indent instead', () => {
    const range = { from: at('a', 0), to: at('a', 2) };
    for (const firstLine of [-360, 800]) {
      expect(tabIndentFor(range, ['a'], reads(0, firstLine), 'increase', 720)).toEqual({
        write: 'stepLeft',
        paragraphs: ['a'],
      });
    }
  });

  test('an end before the first painted offset of the last paragraph drops it', () => {
    const range = { from: at('a', 0), to: at('b', 3) };
    expect(tabIndentFor(range, ['a', 'b'], reads(0, 0, 3), 'increase', 720)).toEqual({
      write: 'setFirstLine',
      paragraphs: ['a'],
    });
  });

  test('a start before the first painted offset is the paragraph start', () => {
    const range = { from: at('a', 3), to: at('a', 6) };
    expect(tabIndentFor(range, ['a'], reads(0, 0, 3), 'increase', 720)).toEqual({
      write: 'setFirstLine',
      paragraphs: ['a'],
    });
  });

  test('Shift+Tab clears the first line only once the left indent is gone', () => {
    const range = { from: at('a', 0), to: at('a', 2) };
    expect(tabIndentFor(range, ['a'], reads(720, 720), 'decrease', 720)?.write).toBe('stepLeft');
    expect(tabIndentFor(range, ['a'], reads(0, 720), 'decrease', 720)?.write).toBe(
      'clearFirstLine'
    );
  });

  test('a step never passes the margin or the bound, and never moves backwards', () => {
    expect(nextLeftIndent(0, -1)).toBe(0);
    expect(nextLeftIndent(MAX_PARAGRAPH_INDENT_TWIPS - 10, 1)).toBe(MAX_PARAGRAPH_INDENT_TWIPS);
    expect(nextLeftIndent(720, 1)).toBe(720 + INDENT_STEP_TWIPS);
    expect(nextLeftIndent(40_000, 1)).toBe(40_000);
    expect(nextLeftIndent(-720, -1)).toBe(-720);
  });
});
