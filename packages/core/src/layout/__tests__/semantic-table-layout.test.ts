// Semantic table conformance: crash-free layout, row-sized cell boxes, nested-table
// geometry, `w:tblHeader` repetition across pages, vMerge deduplication, grid-driven
// column widths, bounded hostile-input handling, and incremental-layout invariants.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import {
  caretStops,
  documentOrder,
  paragraphTextFromLayout,
} from '../semantic-interaction.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { MAX_TABLE_COLUMNS } from '../semantic-table.ts';
import {
  paragraphFragmentsOf,
  type PageRecord,
  type SemanticLayout,
  type TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function fixturePart(name: string): OoxmlPart {
  const bytes = readFileSync(`${import.meta.dir}/../../../../../e2e/fixtures/${name}`);
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(`package read failed: ${result.reason}`);
  return result.package.parts.get(result.package.mainDocumentPart)!;
}

function loadPart(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const tr = (cells: string, trPr = '') => `<w:tr>${trPr}${cells}</w:tr>`;

function layout(part: OoxmlPart): SemanticLayout {
  return layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() });
}

function tableFragments(page: PageRecord): TableFragmentRecord[] {
  return page.fragments.filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
}

function allTableFragments(result: SemanticLayout): TableFragmentRecord[] {
  return result.pages.flatMap(tableFragments);
}

describe('semantic table layout', () => {
  test('a real table document lays out with typed rows, cells and reachable text', () => {
    const part = fixturePart('with-tables.docx');
    const result = layout(part);
    const tables = allTableFragments(result);
    expect(tables.length).toBeGreaterThan(0);
    const rows = tables.flatMap((fragment) => fragment.rows);
    expect(rows).toHaveLength(3);
    const cells = rows.flatMap((row) => row.cells);
    expect(cells).toHaveLength(9);
    // Cell text is reachable through the records, in reading order.
    const texts = cells.map((cell) =>
      cell.blocks
        .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('')
    );
    expect(texts).toEqual(['A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'A3', 'B3', 'C3']);
  });

  test('cells in a row share the row height and sit inside the row box', () => {
    const part = loadPart(`<w:tbl>${tr(tc(p('short')) + tc(p('a much longer cell text that wraps across several lines of the narrow column')))}</w:tbl>`);
    const result = layout(part);
    const [table] = allTableFragments(result);
    const row = table!.rows[0]!;
    for (const cell of row.cells) {
      expect(cell.box.height).toBe(row.box.height);
      expect(cell.box.y).toBe(row.box.y);
    }
    // The taller cell decided the height: it exceeds one default line plus padding.
    expect(row.box.height).toBeGreaterThan(14 + 6);
  });

  test('a nested table lays out with its own geometry inside the cell box', () => {
    const part = loadPart(
      `<w:tbl>${tr(tc(`<w:tbl>${tr(tc(p('inner')))}</w:tbl>${p('after')}`) + tc(p('right')))}</w:tbl>`
    );
    const result = layout(part);
    const [outer] = allTableFragments(result);
    const hostCell = outer!.rows[0]!.cells[0]!;
    const nested = hostCell.blocks.find((block) => block.kind === 'table');
    expect(nested).toBeDefined();
    if (!nested || nested.kind !== 'table') throw new Error('unreachable');
    // Nested geometry sits inside the hosting cell box.
    expect(nested.box.x).toBeGreaterThanOrEqual(hostCell.box.x);
    expect(nested.box.x + nested.box.width).toBeLessThanOrEqual(
      hostCell.box.x + hostCell.box.width + 0.001
    );
    expect(nested.rows[0]!.cells[0]!.blocks[0]!.kind).toBe('paragraph');
  });

  test('a tblHeader row repeats atop each page and stays out of interaction walks', () => {
    const header = tr(tc(p('HEAD')), '<w:trPr><w:tblHeader/></w:trPr>');
    const body = Array.from({ length: 60 }, (_, i) => tr(tc(p(`row ${i}`)))).join('');
    const part = loadPart(`<w:tbl>${header}${body}</w:tbl>`);
    const result = layout(part);
    expect(result.pages.length).toBeGreaterThan(1);

    // Every continuation page's table fragment leads with the repeated header row.
    for (const page of result.pages.slice(1)) {
      const fragments = tableFragments(page);
      if (fragments.length === 0) continue;
      const first = fragments[0]!.rows[0]!;
      expect(first.isHeaderRepeat).toBe(true);
      const text = first.cells[0]!.blocks
        .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('');
      expect(text).toBe('HEAD');
    }

    // Interaction sees each cell paragraph exactly once despite the repeats.
    const order = documentOrder(result);
    expect(new Set(order).size).toBe(order.length);
    const headParagraphs = order.filter(
      (id) => paragraphTextFromLayout(result, id) === 'HEAD'
    );
    expect(headParagraphs).toHaveLength(1);
    const stops = caretStops(result);
    const seen = new Set<string>();
    for (const stop of stops) {
      const key = `${stop.position.paragraphId}:${stop.position.offset}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // Header repeats are still painted: flattening WITH repeats sees the copy.
    const withRepeats = result.pages
      .slice(1)
      .flatMap((page) => paragraphFragmentsOf(page, true))
      .filter((fragment) => fragment.paragraphId === headParagraphs[0]);
    expect(withRepeats.length).toBeGreaterThan(0);
  });

  test('vMerge continue cells emit a box but no content', () => {
    const part = loadPart(
      '<w:tbl>' +
        tr(tc(p('merged'), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('b1'))) +
        tr(tc(p('ghost'), '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p('b2'))) +
        '</w:tbl>'
    );
    const result = layout(part);
    const [table] = allTableFragments(result);
    const continueCell = table!.rows[1]!.cells[0]!;
    expect(continueCell.vMergeContinue).toBe(true);
    expect(continueCell.blocks).toHaveLength(0);
    expect(continueCell.box.height).toBe(table!.rows[1]!.box.height);
    // The continuation's text never reaches the records.
    const order = documentOrder(result);
    const texts = order.map((id) => paragraphTextFromLayout(result, id));
    expect(texts).not.toContain('ghost');
  });

  test('column widths come from the grid when present', () => {
    const part = loadPart(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="4800"/></w:tblGrid>' +
        tr(tc(p('a')) + tc(p('b'))) +
        '</w:tbl>'
    );
    const result = layout(part);
    const row = allTableFragments(result)[0]!.rows[0]!;
    expect(row.cells[0]!.box.width).toBe(120); // 2400 twips = 120 pt
    expect(row.cells[1]!.box.width).toBe(240); // 4800 twips = 240 pt
    expect(row.cells[1]!.box.x).toBe(120);
  });

  test('cell shading is read validated and vetted values only', () => {
    const part = loadPart(
      '<w:tbl>' +
        tr(
          tc(p('shaded'), '<w:tcPr><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr>') +
            tc(p('auto'), '<w:tcPr><w:shd w:val="clear" w:fill="auto"/></w:tcPr>') +
            tc(p('evil'), '<w:tcPr><w:shd w:val="clear" w:fill="url(x)"/></w:tcPr>')
        ) +
        '</w:tbl>'
    );
    const row = allTableFragments(layout(part))[0]!.rows[0]!;
    expect(row.cells[0]!.shading).toBe('D9E2F3');
    expect(row.cells[1]!.shading).toBeUndefined();
    expect(row.cells[2]!.shading).toBeUndefined();
  });

  test('a file-supplied gridSpan cannot drive allocation (bounded columns, bounded time)', () => {
    const part = loadPart(
      `<w:tbl>${tr(tc(p('x'), '<w:tcPr><w:gridSpan w:val="500000000"/></w:tcPr>'))}</w:tbl>`
    );
    const started = performance.now();
    const result = layout(part);
    expect(performance.now() - started).toBeLessThan(2000);
    const [table] = allTableFragments(result);
    const cell = table!.rows[0]!.cells[0]!;
    expect(cell.gridSpan).toBeLessThanOrEqual(MAX_TABLE_COLUMNS);
    expect(cell.box.width).toBeGreaterThan(0);
  });

  test('nesting beyond the ceiling renders an empty cell instead of recursing', () => {
    let inner = p('deepest');
    for (let depth = 0; depth < 24; depth += 1) {
      inner = `<w:tbl>${tr(tc(inner))}</w:tbl>`;
    }
    const part = loadPart(inner);
    // Completes without a stack failure; the deepest tables are simply absent.
    const result = layout(part);
    expect(result.pages.length).toBeGreaterThan(0);
    const texts = documentOrder(result).map((id) => paragraphTextFromLayout(result, id));
    expect(texts).not.toContain('deepest');
  });
});

describe('incremental layout with tables', () => {
  const tableDoc = () =>
    loadPart(
      p('before') +
        `<w:tbl>${tr(tc(p('A1')) + tc(p('B1')))}${tr(tc(p('A2')) + tc(p('B2')))}</w:tbl>` +
        p('after')
    );

  function editCellParagraph(part: OoxmlPart, needle: string, text: string): OoxmlPart {
    const findParagraph = (node: import('../../store/package/ooxml-tree.ts').OoxmlNode): string | null => {
      if (node.kind === 'textValue') return null;
      if (node.kind === 'paragraph' && JSON.stringify(node).includes(`"${needle}"`)) return node.id;
      for (const child of node.children) {
        const found = findParagraph(child);
        if (found) return found;
      }
      return null;
    };
    const paragraphId = findParagraph(part.root);
    if (!paragraphId) throw new Error(`no paragraph containing ${needle}`);
    const result = applyTreeOp(part, { op: 'insertText', paragraphId, offset: 0, text });
    if (!result.ok) throw new Error(`edit rejected: ${result.reason}`);
    return result.part;
  }

  test('an incremental pass after a cell edit equals a clean full pass', () => {
    const measurer = createFixedMeasurer();
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    const before = tableDoc();
    layoutSemanticDocument(before, 0, { measurer, cache, session });

    const after = editCellParagraph(before, 'B2', 'Z');
    const incremental = layoutSemanticDocument(after, 1, { measurer, cache, session });
    const clean = layoutSemanticDocument(after, 1, { measurer: createFixedMeasurer() });
    expect(JSON.parse(JSON.stringify(incremental))).toEqual(JSON.parse(JSON.stringify(clean)));
  });

  test('a no-change pass returns the previous pages by identity', () => {
    const measurer = createFixedMeasurer();
    const session = createLayoutSession();
    const part = tableDoc();
    const first = layoutSemanticDocument(part, 0, { measurer, session });
    const second = layoutSemanticDocument(part, 1, { measurer, session });
    expect(second.pages).toBe(first.pages);
  });

  test('an edit below the table reuses the pages above it by identity', () => {
    const measurer = createFixedMeasurer();
    const session = createLayoutSession();
    // Push the trailing paragraph onto its own page so the table's page can be reused.
    const filler = Array.from({ length: 50 }, (_, i) => p(`filler ${i}`)).join('');
    const part = loadPart(
      `<w:tbl>${tr(tc(p('A1')))}</w:tbl>` + filler + p('tail')
    );
    const first = layoutSemanticDocument(part, 0, { measurer, session });
    expect(first.pages.length).toBeGreaterThan(1);

    const after = editCellParagraph(part, 'tail', 'Z');
    const second = layoutSemanticDocument(after, 1, { measurer, session });
    // The first page (the table's) is carried over by reference.
    expect(second.pages[0]).toBe(first.pages[0]);
  });

  test('the table cache key changes on a cell edit and holds otherwise', () => {
    const measurer = createFixedMeasurer();
    const session = createLayoutSession();
    const part = tableDoc();
    layoutSemanticDocument(part, 0, { measurer, session });
    const keysBefore = [...session.keys];

    const after = editCellParagraph(part, 'A1', 'Z');
    layoutSemanticDocument(after, 1, { measurer, session });
    const keysAfter = [...session.keys];
    expect(keysAfter).toHaveLength(keysBefore.length);
    expect(keysAfter[0]).toBe(keysBefore[0]!); // 'before' paragraph untouched
    expect(keysAfter[1]).not.toBe(keysBefore[1]!); // the table re-keys
    expect(keysAfter[2]).toBe(keysBefore[2]!); // 'after' paragraph untouched
  });
});
