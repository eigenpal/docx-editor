import { expect, test } from 'bun:test';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { cachedAutofitCellWidths } from '../table-autofit-cell-cache.ts';
import {
  autofitContextOf,
  carryTableAutofitScope,
  type AutofitView,
} from '../table-autofit-widths.ts';
import { readTableStructure } from '../semantic-table.ts';
import { load, row, table, measurer, styleCascade } from './table-row-keep-fixtures.ts';

function fixture() {
  const part = load(table([row('value')]));
  const node = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  const cell = readTableStructure(node, 310, 0, styleCascade)!.rows[0]!.cells[0]!;
  const view: AutofitView = {
    styleCascade,
    displayMode: 'all-markup',
    authorFilter: undefined,
    readNested: () => null,
  };
  return { cell, view, node };
}
const value = { least: 10, most: 20, left: 1, right: 1, wideLeft: 2, wideRight: 2 };

test('unchanged cells reuse widths across verified section revisions', () => {
  const { cell, view } = fixture();
  const first = {};
  const deps = { measurer, producer: 'same' };
  carryTableAutofitScope(null, first, false, deps);
  let reads = 0;
  const read = () => {
    reads++;
    return value;
  };
  expect(cachedAutofitCellWidths(cell, true, autofitContextOf(deps), view, read)).toBe(value);
  const nextDeps = { ...deps };
  expect(carryTableAutofitScope(first, {}, true, nextDeps)).toBe(true);
  expect(cachedAutofitCellWidths(cell, true, autofitContextOf(nextDeps), view, read)).toBe(value);
  expect(reads).toBe(1);
  cachedAutofitCellWidths({ ...cell }, true, autofitContextOf(nextDeps), view, read);
  expect(reads).toBe(2);
});

test('producer, view, and border-spacing changes invalidate cell widths', () => {
  const { cell, view } = fixture();
  const first = {};
  const deps = { measurer, producer: 'first' };
  carryTableAutofitScope(null, first, false, deps);
  let reads = 0;
  const read = () => {
    reads++;
    return value;
  };
  const context = autofitContextOf(deps);
  cachedAutofitCellWidths(cell, true, context, view, read);
  cachedAutofitCellWidths(cell, false, context, view, read);
  cachedAutofitCellWidths(cell, false, context, { ...view, displayMode: 'original' }, read);
  const changed = { ...deps, producer: 'second' };
  expect(carryTableAutofitScope(first, {}, true, changed)).toBe(false);
  cachedAutofitCellWidths(cell, false, autofitContextOf(changed), view, read);
  expect(reads).toBe(4);
});

test('unproven contexts and nested tables retain their regular measurement path', () => {
  const { cell, view, node } = fixture();
  const deps = { measurer, producer: 'same' };
  let reads = 0;
  const read = () => {
    reads++;
    return value;
  };
  for (let i = 0; i < 2; i++)
    cachedAutofitCellWidths(cell, true, autofitContextOf(deps), view, read);
  carryTableAutofitScope(null, {}, false, deps);
  const nested = { ...cell, blocks: [node] };
  for (let i = 0; i < 2; i++)
    cachedAutofitCellWidths(nested, true, autofitContextOf(deps), view, read);
  expect(reads).toBe(4);
});
