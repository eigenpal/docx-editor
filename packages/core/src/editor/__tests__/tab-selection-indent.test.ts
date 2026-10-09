// Tab over a selection outside a list.
//
// A selection of whole paragraphs indents them and keeps the text. A selection that starts
// inside the text, and a caret, still type a tab character.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createKeyDownHandler } from '../surface-input.ts';
import { directParagraphProperties } from '../surface-formatting.ts';
import { INDENT_STEP_TWIPS, nextLeftIndent, tabIndentFor } from '../surface-indent-step.ts';
import { MAX_PARAGRAPH_INDENT_TWIPS } from '../../layout/paragraph-indent.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function mount(body: string): PaginatedSurface {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return opened.surface;
}

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const THREE = paragraph('Alpha beta gamma') + paragraph('Second line') + paragraph('Third');

function paragraphIds(surface: PaginatedSurface): string[] {
  const ids: string[] = [];
  for (const page of surface.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind === 'paragraph' && !ids.includes(fragment.paragraphId)) {
        ids.push(fragment.paragraphId);
      }
    }
  }
  return ids;
}

function indentOf(surface: PaginatedSurface, paragraphId: string): Record<string, string> {
  const ind = directParagraphProperties(surface.session.part(), paragraphId).find(
    (property) => property.localName === 'ind'
  );
  return { ...ind?.attributes };
}

function pressTab(surface: PaginatedSurface, from: [number, number], to: [number, number]) {
  const ids = paragraphIds(surface);
  surface.setSelection({
    anchor: { paragraphId: ids[from[0]]!, offset: from[1] },
    head: { paragraphId: ids[to[0]]!, offset: to[1] },
  });
  createKeyDownHandler(surface)({
    key: 'Tab',
    preventDefault: () => {},
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  } as KeyboardEvent);
  return ids;
}

const hasTab = (surface: PaginatedSurface) =>
  JSON.stringify(surface.session.part().root).includes('"tab"');
const bodyText = (surface: PaginatedSurface) => JSON.stringify(surface.session.part().root);

describe('Tab over a selection', () => {
  test('a whole selected paragraph gets a first-line indent and keeps its text', () => {
    const surface = mount(THREE);
    const ids = pressTab(surface, [0, 0], [0, 16]);
    expect(bodyText(surface)).toContain('Alpha beta gamma');
    expect(hasTab(surface)).toBe(false);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ firstLine: '720' });
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });

  test('a selection that also takes the paragraph mark acts on that paragraph only', () => {
    const surface = mount(THREE);
    const ids = pressTab(surface, [0, 0], [1, 0]);
    expect(bodyText(surface)).toContain('Alpha beta gamma');
    expect(indentOf(surface, ids[0]!).firstLine).toBe('720');
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });

  test('a selection from the paragraph start into the text also indents the first line', () => {
    const surface = mount(THREE);
    const ids = pressTab(surface, [0, 0], [0, 5]);
    expect(bodyText(surface)).toContain('Alpha beta gamma');
    expect(indentOf(surface, ids[0]!).firstLine).toBe('720');
  });

  test('a first line already indented one tab stop steps the left indent', () => {
    const surface = mount(paragraph('Indented', '<w:pPr><w:ind w:firstLine="720"/></w:pPr>'));
    const ids = pressTab(surface, [0, 0], [0, 8]);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '720', firstLine: '720' });
    expect(bodyText(surface)).toContain('Indented');
  });

  test('a selection over several paragraphs steps the left indent of each one', () => {
    const surface = mount(THREE);
    const ids = pressTab(surface, [0, 6], [1, 3]);
    expect(bodyText(surface)).toContain('Alpha beta gamma');
    expect(bodyText(surface)).toContain('Second line');
    expect(hasTab(surface)).toBe(false);
    expect(indentOf(surface, ids[0]!).left).toBe('720');
    expect(indentOf(surface, ids[1]!).left).toBe('720');
    expect(indentOf(surface, ids[2]!)).toEqual({});
  });

  test('a selection that starts inside the text is replaced by a tab', () => {
    const surface = mount(THREE);
    const ids = pressTab(surface, [0, 6], [0, 10]);
    expect(bodyText(surface)).not.toContain('beta');
    expect(hasTab(surface)).toBe(true);
    expect(indentOf(surface, ids[0]!)).toEqual({});
  });

  test('a caret at the paragraph start still types a tab', () => {
    const surface = mount(THREE);
    const ids = pressTab(surface, [0, 0], [0, 0]);
    expect(hasTab(surface)).toBe(true);
    expect(indentOf(surface, ids[0]!)).toEqual({});
  });

  test('a hanging-indent paragraph keeps its hanging indent and moves one step', () => {
    const surface = mount(
      paragraph('Hanging entry', '<w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr>')
    );
    const ids = pressTab(surface, [0, 0], [0, 13]);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '1440', hanging: '720' });
    expect(bodyText(surface)).toContain('Hanging entry');
  });

  test('one undo step restores the paragraph', () => {
    const surface = mount(THREE);
    const ids = pressTab(surface, [0, 6], [1, 3]);
    surface.undo();
    expect(indentOf(surface, ids[0]!)).toEqual({});
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });
});

describe('tabIndentFor', () => {
  const at = (paragraphId: string, offset: number) => ({ paragraphId, offset });
  const none = () => 0;

  test('answers null for a caret and for a selection inside one paragraph', () => {
    expect(tabIndentFor({ from: at('a', 0), to: at('a', 0) }, ['a'], none, 720)).toBeNull();
    expect(tabIndentFor({ from: at('a', 2), to: at('a', 4) }, ['a'], none, 720)).toBeNull();
  });

  test('drops a last paragraph that is touched only at its start', () => {
    expect(tabIndentFor({ from: at('a', 3), to: at('c', 0) }, ['a', 'b', 'c'], none, 720)).toEqual({
      kind: 'left',
      paragraphs: ['a', 'b'],
    });
    expect(tabIndentFor({ from: at('a', 3), to: at('b', 0) }, ['a', 'b'], none, 720)).toBeNull();
  });

  test('a hanging or wide first line steps the left indent instead', () => {
    const hanging = () => -360;
    const wide = () => 800;
    for (const firstLine of [hanging, wide]) {
      expect(tabIndentFor({ from: at('a', 0), to: at('a', 2) }, ['a'], firstLine, 720)).toEqual({
        kind: 'left',
        paragraphs: ['a'],
      });
    }
  });

  test('a step never passes the margin or the layout bound', () => {
    expect(nextLeftIndent(0, -1)).toBe(0);
    expect(nextLeftIndent(MAX_PARAGRAPH_INDENT_TWIPS - 10, 1)).toBe(MAX_PARAGRAPH_INDENT_TWIPS);
    expect(nextLeftIndent(720, 1)).toBe(720 + INDENT_STEP_TWIPS);
  });
});
