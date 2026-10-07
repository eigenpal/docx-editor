import { expect, test } from 'bun:test';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { bodyLineId } from '../body-line-id.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure, type SemanticTableRow } from '../semantic-table.ts';
import { layoutRowFragment, type TableFlowDeps } from '../semantic-table-layout.ts';
import { cellContentInsets } from '../table-cell-geometry.ts';
import { placementFromPrevious, rememberRowPlacement } from '../table-row-placement-reuse.ts';
import { lay, load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

// A previous placement stands in for a fresh row probe only at the same top, with the same
// vertical inputs, and when its finalized height is still the probe's height. Each case
// below changes exactly one of those and must refuse.

const tc = (text: string, tcPr = '') =>
  `<w:tc><w:tcPr>${tcPr}</w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const table =
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr>${tc('A1')}${tc('B1', '<w:vAlign w:val="center"/>')}${tc('C1')}</w:tr></w:tbl>`;

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;

function setup() {
  const part = load(table);
  lay(part);
  const row = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[0]!;
  const deps: TableFlowDeps = {
    measurer,
    styleCascade,
    // The move reads the placed line back from the break cache.
    cache: createParagraphLayoutCache<never>(),
    producer: 'unit',
    nextLineId: bodyLineId,
    compatibilityMode: 15,
    displayMode: 'all-markup',
  } as TableFlowDeps;
  const narrow = [90, 100, 110];
  const wide = [100.5, 95.25, 104.125];
  const top = 40;
  const probe = layoutRowFragment(row, narrow, 3, top, false, 0, deps);
  rememberRowPlacement(row, probe, top, deps);
  return { row, deps, wide, top, previous: probe.record };
}

test('the unchanged case reuses the previous placement', () => {
  const { row, deps, wide, top, previous } = setup();
  const reused = placementFromPrevious(row, previous, wide, 2.5, top, deps);
  expect(reused).not.toBeNull();
  expect(reused!.record).toEqual(layoutRowFragment(row, wide, 2.5, top, false, 0, deps).record);
});

test('a different top, terminal height, or row height rule refuses', () => {
  const { row, deps, wide, top, previous } = setup();
  expect(placementFromPrevious(row, previous, wide, 2.5, top + 1, deps)).toBeNull();
  // The terminal-row correction finalizes a different height than the probe measured.
  const terminal = { ...previous, box: { ...previous.box, height: previous.box.height + 2 } };
  expect(placementFromPrevious(row, terminal, wide, 2.5, top, deps)).toBeNull();
  const exact: SemanticTableRow = { ...row, height: { rule: 'exact', valuePt: 40 } };
  expect(placementFromPrevious(exact, previous, wide, 2.5, top, deps)).toBeNull();
});

test('each vertical input of any cell refuses when it differs', () => {
  const { row, deps, wide, top, previous } = setup();
  const target = row.cells[2]!;
  const base = cellContentInsets(target, true);
  const insets = (change: Partial<typeof base>) => new Map([[target.id, { ...base, ...change }]]);
  for (const changed of [
    { cellContentInsets: insets({ top: base.top + 1 }) },
    { cellContentInsets: insets({ bottom: base.bottom + 1 }) },
    { cellMinimumContentInsets: new Map([[target.id, { top: 3, bottom: 0 }]]) },
  ] as Partial<TableFlowDeps>[])
    expect(
      placementFromPrevious(row, previous, wide, 2.5, top, { ...deps, ...changed })
    ).toBeNull();
  // Left and right insets move x only, which the move recomputes: not a vertical input.
  const sideways = { cellContentInsets: insets({ left: base.left + 1 }) } as Partial<TableFlowDeps>;
  expect(
    placementFromPrevious(row, previous, wide, 2.5, top, { ...deps, ...sideways })
  ).not.toBeNull();
  const realigned: SemanticTableRow = {
    ...row,
    cells: row.cells.map((cell, index) => (index === 1 ? { ...cell, vAlign: 'bottom' } : cell)),
  };
  expect(placementFromPrevious(realigned, previous, wide, 2.5, top, deps)).toBeNull();
});
