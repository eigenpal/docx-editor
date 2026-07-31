// Table editing on the paginated surface (legacy-lane retirement, phase 1e/1f).
//
// Cell paragraphs are first-class: painted with the same data attributes as body text,
// addressable by the session, and edited through the ordinary op path. Cross-cell joins
// stay refused at the store, which makes Backspace at a cell start a safe no-op.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
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
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const TABLE =
  '<w:tbl>' +
  `<w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr>` +
  '</w:tbl>';
const BODY = p('intro') + TABLE + p('outro');

function mount(body: string): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(body), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

/** The session id of the paragraph currently holding `text`. */
function paragraphIdOf(surface: PaginatedSurface, text: string): string {
  for (const id of surface.session.paragraphIds()) {
    if (paragraphTextOf(surface.session.part(), id) === text) return id;
  }
  throw new Error(`no paragraph with text ${text}`);
}

function putCaret(surface: PaginatedSurface, paragraphId: string, offset: number): void {
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

describe('tables on the paginated surface', () => {
  test('cell text paints inside cell boxes with the ordinary data attributes', () => {
    const { container } = mount(BODY);
    const cells = container.querySelectorAll('.docx-table-cell');
    expect(cells.length).toBe(4);
    const shaded = [...cells].filter((cell) => (cell as HTMLElement).style.backgroundColor !== '');
    expect(shaded.length).toBe(1);
    // Cell spans carry the same addressing attributes as body spans.
    const cellSpans = container.querySelectorAll(
      '.docx-table-cell [data-paragraph-id][data-start]'
    );
    expect(cellSpans.length).toBeGreaterThanOrEqual(4);
    const texts = [...cellSpans].map((span) => span.textContent);
    expect(texts).toContain('A1');
    expect(texts).toContain('B2');
  });

  test('the session addresses cell paragraphs and typing in a cell commits', () => {
    const { surface } = mount(BODY);
    // intro + 4 cell paragraphs + outro.
    expect(surface.session.paragraphIds()).toHaveLength(6);
    const b2 = paragraphIdOf(surface, 'B2');
    putCaret(surface, b2, 2);
    surface.type('X');
    expect(paragraphTextOf(surface.session.part(), b2)).toBe('B2X');
    // The edit is undoable like any other.
    surface.undo();
    expect(paragraphTextOf(surface.session.part(), b2)).toBe('B2');
  });

  test('Enter inside a cell splits within the cell', () => {
    const { surface } = mount(BODY);
    const a1 = paragraphIdOf(surface, 'A1');
    const before = surface.session.paragraphIds();
    putCaret(surface, a1, 1);
    surface.splitParagraph();
    const after = surface.session.paragraphIds();
    expect(after).toHaveLength(before.length + 1);
    expect(paragraphTextOf(surface.session.part(), a1)).toBe('A');
    // The minted tail holds the rest and sits right after the head in reading order.
    const tail = after[after.indexOf(a1) + 1]!;
    expect(paragraphTextOf(surface.session.part(), tail)).toBe('1');
  });

  test('Backspace at the start of a cell paragraph is a safe no-op', () => {
    const { surface } = mount(BODY);
    const a1 = paragraphIdOf(surface, 'A1');
    putCaret(surface, a1, 0);
    surface.deleteBackward();
    expect(paragraphTextOf(surface.session.part(), a1)).toBe('A1');
    expect(paragraphTextOf(surface.session.part(), paragraphIdOf(surface, 'intro'))).toBe('intro');
  });

  test('select all reaches cell text', () => {
    const { surface } = mount(BODY);
    surface.selectAll();
    const selected = surface.selectedText();
    for (const piece of ['intro', 'A1', 'B1', 'A2', 'B2', 'outro']) {
      expect(selected).toContain(piece);
    }
  });

  test('deleting a selection that crosses the table clears text without vetoing', () => {
    const { surface } = mount(BODY);
    const intro = paragraphIdOf(surface, 'intro');
    const outro = paragraphIdOf(surface, 'outro');
    surface.setSelection({
      anchor: { paragraphId: intro, offset: 0 },
      head: { paragraphId: outro, offset: 'outro'.length },
    });
    surface.deleteSelection();
    const part = surface.session.part();
    // Every paragraph in range is emptied; the cell paragraphs survive as empty
    // paragraphs because cross-cell joins are refused, and the table stays intact.
    for (const id of surface.session.paragraphIds()) {
      expect(paragraphTextOf(part, id) ?? '').toBe('');
    }
    expect(surface.session.paragraphIds().length).toBeGreaterThanOrEqual(4);
  });
});
