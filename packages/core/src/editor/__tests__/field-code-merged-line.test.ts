// The paragraph that holds a field's `begin` and the paragraph where its field codes end lay
// out as one line, because the first paragraph's mark is field code (ECMA-376 Part 1,
// 17.16.18, CT_FldChar). The tree keeps both paragraphs, so caret, typing, Backspace, and
// Delete must each act on the paragraph that holds the text beside the caret.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { caretAt } from '../../layout/semantic-interaction.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
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

const FIELD =
  '<w:p><w:r><w:t>Top</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve">IF 1 = 1 "</w:instrText></w:r></w:p>' +
  '<w:p><w:r><w:instrText>Inside</w:instrText></w:r></w:p>' +
  '<w:p><w:r><w:instrText xml:space="preserve">" ""</w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Yes</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
  '<w:p><w:r><w:t>Bottom</w:t></w:r></w:p>';

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

function mount(): { surface: PaginatedSurface; ids: string[] } {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(FIELD), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  mounted.push({ surface: opened.surface, container });
  return { surface: opened.surface, ids: opened.surface.session.paragraphIds() };
}

const textOf = (surface: PaginatedSurface, id: string) =>
  paragraphTextOf(surface.session.part(), id);

function caret(surface: PaginatedSurface, paragraphId: string, offset: number): void {
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

/** Each laid-out line's text. */
const lines = (surface: PaginatedSurface) =>
  surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
        : []
    );

describe('the line that joins the two sides of a field', () => {
  test('shows both sides on one line, and the caret moves across it', () => {
    const { surface, ids } = mount();
    expect(lines(surface)).toEqual(['Top', 'AlphaYes', 'Bottom']);
    const [alpha, yes] = [ids[1]!, ids[3]!];
    const end = caretAt(surface.layout(), { paragraphId: alpha, offset: 5 });
    const start = caretAt(surface.layout(), { paragraphId: yes, offset: 0 });
    expect(end?.y).toBe(start?.y);
    expect(end?.x).toBeCloseTo(start!.x, 3);
    // The join is one caret stop: the end of the first side.
    caret(surface, alpha, 4);
    const steps: unknown[] = [];
    for (let step = 0; step < 3; step += 1) {
      surface.navigate('right');
      steps.push(surface.state().selection.head);
    }
    expect(steps).toEqual([
      { paragraphId: alpha, offset: 5 },
      { paragraphId: yes, offset: 1 },
      { paragraphId: yes, offset: 2 },
    ]);
    surface.navigate('left');
    surface.navigate('left');
    surface.navigate('left');
    expect(surface.state().selection.head).toEqual({ paragraphId: alpha, offset: 4 });
  });

  test('types into the paragraph on each side and stays one line', () => {
    const { surface, ids } = mount();
    const [alpha, yes] = [ids[1]!, ids[3]!];
    caret(surface, alpha, 5);
    surface.type('!');
    caret(surface, yes, 3);
    surface.type('?');
    expect([textOf(surface, alpha), textOf(surface, yes)]).toEqual(['Alpha!', 'Yes?']);
    expect(surface.session.paragraphIds()).toEqual(ids);
    expect(lines(surface)).toEqual(['Top', 'Alpha!Yes?', 'Bottom']);
    surface.undo();
    surface.undo();
    expect(lines(surface)).toEqual(['Top', 'AlphaYes', 'Bottom']);
    surface.redo();
    expect(lines(surface)).toEqual(['Top', 'Alpha!Yes', 'Bottom']);
  });

  test('Backspace and Delete take the character beside the caret and keep the field codes', () => {
    const { surface, ids } = mount();
    const [alpha, yes] = [ids[1]!, ids[3]!];
    caret(surface, yes, 0);
    surface.deleteBackward();
    caret(surface, alpha, 4);
    surface.deleteForward();
    expect([textOf(surface, alpha), textOf(surface, yes)]).toEqual(['Alph', 'es']);
    expect(surface.session.paragraphIds()).toEqual(ids);
    expect(surface.state().lastRejection).toBeNull();
    expect(lines(surface)).toEqual(['Top', 'Alphes', 'Bottom']);
  });

  test('Backspace at the start of the line joins it to the paragraph before', () => {
    const { surface, ids } = mount();
    caret(surface, ids[1]!, 0);
    surface.deleteBackward();
    expect(textOf(surface, ids[0]!)).toBe('TopAlpha');
    expect(lines(surface)).toEqual(['TopAlphaYes', 'Bottom']);
  });
});

/** The saved XML from the field's `begin` to its `separate`: the field codes. */
async function fieldCodes(surface: PaginatedSurface): Promise<string> {
  const xml = strFromU8(unzipSync(await surface.save())['word/document.xml']!);
  return xml.slice(xml.indexOf('w:fldCharType="begin"'), xml.indexOf('w:fldCharType="separate"'));
}

// A collapsed caret at the start of the result side sits before the field codes that continue
// into that paragraph. An insert there lands at the end of the first side instead, the same
// place on the page, or before the whole line for a table, so the field codes keep exactly
// their paragraph marks.
describe('a structural insert at the start of the result side', () => {
  const inserts: [string, (surface: PaginatedSurface) => unknown, string[]][] = [
    ['Enter', (surface) => surface.splitParagraph(), ['Top', 'Alpha', 'Yes', 'Bottom']],
    [
      'a pasted line break',
      (surface) => surface.insertPlainText('P\nQ'),
      ['Top', 'AlphaP', 'QYes', 'Bottom'],
    ],
    [
      'a section break',
      (surface) => surface.insertSectionBreak(),
      ['Top', 'Alpha', 'Yes', 'Bottom'],
    ],
    ['a table', (surface) => surface.insertTable(1, 1), ['Top', 'AlphaYes', 'Bottom']],
  ];
  for (const [label, insert, shown] of inserts) {
    test(`${label} adds no paragraph mark inside the field codes`, async () => {
      const { surface, ids } = mount();
      const before = await fieldCodes(surface);
      caret(surface, ids[3]!, 0);
      insert(surface);
      expect(surface.state().lastRejection).toBeNull();
      expect(lines(surface)).toEqual(shown);
      const tables = surface
        .layout()
        .pages.flatMap((page) => page.fragments)
        .filter((fragment) => fragment.kind === 'table');
      expect(tables).toHaveLength(label === 'a table' ? 1 : 0);
      // The begin and the paragraph inside keep their marks; no table or section mark joins.
      const after = await fieldCodes(surface);
      // Every paragraph start, self-closing ones included.
      const paragraphs = (xml: string) => xml.match(/<w:p[ >/]/g)?.length ?? 0;
      expect(paragraphs(after)).toBe(paragraphs(before));
      expect(after).not.toContain('<w:tbl');
      expect(after).not.toContain('<w:sectPr');
    });
  }

  test('typing there lands in the shared line, not in the field codes', async () => {
    const { surface, ids } = mount();
    const before = await fieldCodes(surface);
    caret(surface, ids[3]!, 0);
    surface.type('X');
    expect(lines(surface)).toEqual(['Top', 'AlphaXYes', 'Bottom']);
    // Before the field's begin, outside the field, where a field update cannot replace it.
    expect(textOf(surface, ids[1]!)).toBe('AlphaX');
    expect(await fieldCodes(surface)).toBe(before);
  });
});
