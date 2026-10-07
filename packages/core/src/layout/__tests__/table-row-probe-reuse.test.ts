import { expect, test } from 'bun:test';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { createRowProbeReuse } from '../table-row-probe-reuse.ts';
import { layoutRowFragment, type TableFlowDeps } from '../semantic-table-layout.ts';
import { readTableStructure } from '../semantic-table.ts';
import { load, row, table, para, measurer, styleCascade } from './table-row-keep-fixtures.ts';

function fixture(xml = row('text', { first: para('first', 3) + para('second', 2) })) {
  const part = load(table([xml]));
  const node = part.root.children
    .find((n) => n.kind === 'body')!
    .children.find((n) => n.kind === 'table')! as OoxmlElement;
  return readTableStructure(node, 310, 0, styleCascade)!;
}
function deps(): TableFlowDeps {
  let n = 0;
  return {
    measurer,
    styleCascade,
    producer: 'test',
    nextLineId: (id, start, index) => `${id}:${start}:${index}:${n++}`,
  };
}

for (const top of [0, 14.123456789, 83.33333333333333]) {
  test(`reused row has exact placement and line identities at ${top}`, () => {
    const s = fixture();
    const p = createRowProbeReuse(s.columnWidthsPt, s.cellSpacingPt);
    const d = deps();
    p.measure(s.rows[0]!, 2.3456789, top, d);
    const actual = p.take(s.rows[0]!, 2.3456789, top, { ...d, rowAtPageStart: false });
    expect(actual).not.toBeNull();
    expect(actual).toEqual(
      layoutRowFragment(
        s.rows[0]!,
        s.columnWidthsPt,
        2.3456789,
        top,
        false,
        0,
        deps(),
        s.cellSpacingPt
      )
    );
    expect(p.take(s.rows[0]!, 2.3456789, top, d)).toBeNull();
  });
}

test('changed geometry, inputs, and page admission invalidate a probe', () => {
  const s = fixture();
  const p = createRowProbeReuse(s.columnWidthsPt, s.cellSpacingPt);
  const d = deps();
  for (const change of [
    { defaultTabStopPt: 80 },
    { rowAtPageStart: true },
    { producer: 'other' },
    { pageExclusionZones: () => [{}] },
  ]) {
    p.measure(s.rows[0]!, 0, 0, d);
    expect(p.take(s.rows[0]!, 0, 0, { ...d, ...change } as TableFlowDeps)).toBeNull();
  }
  p.measure(s.rows[0]!, 0, 0, d);
  expect(p.take(s.rows[0]!, 0, 0.001, d)).toBeNull();
  p.measure(s.rows[0]!, 0, 0, d);
  expect(p.take(s.rows[0]!, 1, 0, d)).toBeNull();
});

for (const xml of [
  row('header', { header: true }),
  row('nested', { first: table([row('inside')]) }),
  row('field', {
    first: '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>',
  }),
]) {
  test('complex row keeps the regular placement path', () => {
    const s = fixture(xml);
    const p = createRowProbeReuse(s.columnWidthsPt, s.cellSpacingPt);
    const d = deps();
    p.measure(s.rows[0]!, 0, 0, d);
    expect(p.take(s.rows[0]!, 0, 0, d)).toBeNull();
  });
}

test('semantic merge continuations and vertical text cannot reuse probes', () => {
  const s = fixture();
  for (const change of [{ vMergeContinue: true }, { textDirection: 'btLr' as const }]) {
    const r = { ...s.rows[0]!, cells: s.rows[0]!.cells.map((c) => ({ ...c, ...change })) };
    const p = createRowProbeReuse(s.columnWidthsPt, s.cellSpacingPt);
    const d = deps();
    p.measure(r, 0, 0, d);
    expect(p.take(r, 0, 0, d)).toBeNull();
  }
});
