// Edge cases of the line that joins the two sides of a field whose field codes hold paragraph
// marks (ECMA-376 Part 1, 17.16.18, CT_FldChar). The join has one caret stop only while the
// result side's start paints at the end of the first side. An insert at the start of the
// result side always lands at the end of the first side, outside the field codes.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../../layout/index.ts';
import { layoutHeaderFooterStory } from '../../layout/hf-layout.ts';
import { caretAt, caretStops } from '../../layout/semantic-interaction.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { FIELD_CODE_PASTE_NOTICE } from '../hidden-mark-joins.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** A field whose first side holds `first` and whose result side holds `result` runs. */
const field = (first: string, result: string) =>
  `<w:p>${first}<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  '<w:r><w:instrText xml:space="preserve">IF 1 = 1 "</w:instrText></w:r></w:p>' +
  '<w:p><w:r><w:instrText>Inside</w:instrText></w:r></w:p>' +
  '<w:p><w:r><w:instrText xml:space="preserve">" ""</w:instrText></w:r>' +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
const run = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

function mount(body: string, author?: string): { surface: PaginatedSurface; ids: string[] } {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    ...(author ? { author } : {}),
  });
  if (!opened.ok) throw new Error(opened.reason);
  mounted.push({ surface: opened.surface, container });
  return { surface: opened.surface, ids: opened.surface.session.paragraphIds() };
}

function caret(surface: PaginatedSurface, paragraphId: string, offset: number): void {
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

const head = (surface: PaginatedSurface) => surface.state().selection.head;

/** The saved XML from the field's `begin` to its `separate`: the field codes. */
async function fieldCodes(surface: PaginatedSurface): Promise<string> {
  const xml = strFromU8(unzipSync(await surface.save())['word/document.xml']!);
  return xml.slice(xml.indexOf('w:fldCharType="begin"'), xml.indexOf('w:fldCharType="separate"'));
}

describe('a result side that starts a wrapped line', () => {
  const wrapped = field(run(`${'a'.repeat(40)} `), run('Y'.repeat(60)));

  test('keeps its own caret stop, and Right, Shift+Right, and Home move off the join', () => {
    const { surface, ids } = mount(wrapped);
    const [first, last] = [ids[0]!, ids[2]!];
    const end = caretAt(surface.layout(), { paragraphId: first, offset: 41 });
    const start = caretAt(surface.layout(), { paragraphId: last, offset: 0 });
    expect(start!.y).toBeGreaterThan(end!.y);
    caret(surface, first, 41);
    surface.navigate('right');
    expect(head(surface)).toEqual({ paragraphId: last, offset: 0 });
    surface.navigate('right');
    expect(head(surface)).toEqual({ paragraphId: last, offset: 1 });
    caret(surface, first, 41);
    surface.navigate('right', true);
    surface.navigate('right', true);
    expect(head(surface)).toEqual({ paragraphId: last, offset: 1 });
    caret(surface, last, 5);
    surface.navigate('lineStart');
    expect(head(surface)).toEqual({ paragraphId: last, offset: 0 });
  });

  test('typing at the start of the result still lands outside the field codes', async () => {
    const { surface, ids } = mount(wrapped);
    const before = await fieldCodes(surface);
    caret(surface, ids[2]!, 0);
    surface.type('X');
    expect(paragraphTextOf(surface.session.part(), ids[0]!)).toBe(`${'a'.repeat(40)} X`);
    expect(await fieldCodes(surface)).toBe(before);
  });
});

describe('an insert at the start of the result side', () => {
  const plain = field(run('Alpha'), run('Yes'));

  test('keeps a format armed there', () => {
    const { surface, ids } = mount(plain);
    caret(surface, ids[2]!, 0);
    surface.toggleRunProperty('b');
    surface.type('X');
    const bold = surface
      .layout()
      .pages.flatMap((page) => page.fragments)
      .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      .flatMap((line) => line.spans)
      .find((span) => span.text === 'X');
    expect(bold?.style.bold).toBe(true);
  });

  test('a tracked insertion lands outside the field codes', async () => {
    const { surface, ids } = mount(plain, 'Reviewer');
    const before = await fieldCodes(surface);
    caret(surface, ids[2]!, 0);
    expect(surface.proposeTextChange('insertion', 'X')).toBe(true);
    expect(paragraphTextOf(surface.session.part(), ids[0]!)).toBe('AlphaX');
    expect(await fieldCodes(surface)).toBe(before);
  });
});

describe('a result side that runs right to left after a left-to-right first side', () => {
  test('keeps both caret stops', () => {
    const { surface, ids } = mount(field(run('Alpha'), run('שלום', '<w:rtl/>')));
    const [first, last] = [ids[0]!, ids[2]!];
    const end = caretAt(surface.layout(), { paragraphId: first, offset: 5 });
    const start = caretAt(surface.layout(), { paragraphId: last, offset: 0 });
    expect(start!.y).toBe(end!.y);
    expect(Math.abs(start!.x - end!.x)).toBeGreaterThan(0.5);
    const stops = caretStops(surface.layout()).map((stop) => stop.position);
    expect(stops).toContainEqual({ paragraphId: last, offset: 0 });
    expect(stops).toContainEqual({ paragraphId: first, offset: 5 });
  });

  test('a left-to-right result keeps one stop at the join', () => {
    const { surface, ids } = mount(field(run('Alpha'), run('Yes')));
    const stops = caretStops(surface.layout()).map((stop) => stop.position);
    expect(stops).not.toContainEqual({ paragraphId: ids[2]!, offset: 0 });
    expect(stops).toContainEqual({ paragraphId: ids[0]!, offset: 5 });
  });
});

describe('a field whose field codes hold paragraph marks in a header', () => {
  test('lays the two sides out on one line', () => {
    const parsed = readOoxmlPart(
      `<w:hdr xmlns:w="${W}">${field(run('Alpha'), run('Yes'))}</w:hdr>`,
      {
        name: '/word/header1.xml',
        contentType: 'app/xml',
      }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const story = layoutHeaderFooterStory(parsed.part, 560, createFixedMeasurer(6, 14), 'test');
    const lines = story.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
        : []
    );
    expect(lines).toEqual(['AlphaYes']);
  });
});

function compositionEvent(type: string, data = ''): CompositionEvent {
  const event = new CompositionEvent(type, { bubbles: true });
  Object.defineProperty(event, 'data', { value: data, configurable: true });
  return event;
}

describe('a composition at the start of the result side', () => {
  test('commits outside the field codes', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(field(run('Alpha'), run('Yes'))), {
      scale: 1,
    });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    mounted.push({ surface, container });
    const ids = surface.session.paragraphIds();
    const before = await fieldCodes(surface);
    caret(surface, ids[2]!, 0);
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    pages.dispatchEvent(compositionEvent('compositionstart'));
    const node = document.getSelection()!.focusNode as Text;
    const at = document.getSelection()!.focusOffset;
    node.data = node.data.slice(0, at) + 'X' + node.data.slice(at);
    document.getSelection()!.setBaseAndExtent(node, at + 1, node, at + 1);
    pages.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'X' })
    );
    pages.dispatchEvent(compositionEvent('compositionend', 'X'));
    await new Promise((done) => requestAnimationFrame(() => done(undefined)));
    for (let index = 0; index < 3; index += 1) await new Promise((done) => setTimeout(done, 0));
    expect(paragraphTextOf(surface.session.part(), ids[0]!)).toBe('AlphaX');
    expect(paragraphTextOf(surface.session.part(), ids[2]!)).toBe('Yes');
    expect(await fieldCodes(surface)).toBe(before);
    document.getSelection()?.removeAllRanges();
  });
});

// The first paragraph ends a section, so the two sides keep their own lines. Nothing redirects
// an insert at the start of the result there; the editor's one field-code check refuses it. A
// table goes before the paragraph that holds the field's begin, and a rich paste keeps only its
// text and says so.
describe('a field whose first paragraph ends a section', () => {
  const sectioned = field(run('Alpha'), run('Yes')).replace(
    '<w:p>',
    '<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr>'
  );
  const inserts: [string, (surface: PaginatedSurface) => unknown][] = [
    ['Enter', (surface) => surface.splitParagraph()],
    ['a section break', (surface) => surface.insertSectionBreak()],
  ];
  for (const [label, insert] of inserts) {
    test(`${label} at the start of the result is refused`, async () => {
      const { surface, ids } = mount(sectioned);
      const lines = surface
        .layout()
        .pages.flatMap((page) => page.fragments)
        .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
        .map((line) => line.spans.map((span) => span.text).join(''));
      expect(lines).toEqual(['Alpha', 'Yes']);
      const before = await fieldCodes(surface);
      caret(surface, ids[2]!, 0);
      insert(surface);
      expect(surface.session.paragraphIds()).toEqual(ids);
      expect(await fieldCodes(surface)).toBe(before);
      expect(surface.state().lastRejection).toStartWith('field-code-mark');
    });
  }

  test('a table at the start of the result goes before the field', async () => {
    const { surface, ids } = mount(sectioned);
    const before = await fieldCodes(surface);
    caret(surface, ids[2]!, 0);
    expect(surface.insertTable(1, 1)).toBe(true);
    expect(await fieldCodes(surface)).toBe(before);
  });

  test('a rich paste at the start of the result keeps only its text and says so', async () => {
    const { surface, ids } = mount(sectioned);
    const before = await fieldCodes(surface);
    caret(surface, ids[2]!, 0);
    surface.pasteRich('P\nQ', '<p>P</p><p>Q</p>');
    expect(await fieldCodes(surface)).toBe(before);
    expect(surface.state().lastRejection).toBe(FIELD_CODE_PASTE_NOTICE);
  });
});
