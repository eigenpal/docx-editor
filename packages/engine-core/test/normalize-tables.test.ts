// Recursive normalization through tables (fidelity slice 1 hardening, ADR-S10).
// Regression: normalize() cast every block to ParagraphRecord and crashed on any
// table. It now recurses rows -> cells -> nested blocks.

import { describe, expect, test } from 'bun:test';
import { normalize } from '../src/store/index.ts';
import { createEmptyModel, bodyStoryId, type PackageModel, type Story, type TableRecord, type ParagraphRecord } from '../src/index.ts';

function withTable(table: TableRecord): PackageModel {
  const base = createEmptyModel();
  const bodyId = bodyStoryId(base);
  const body = base.stories.get(bodyId)!;
  const story: Story = { ...body, blocks: [...body.blocks, table] };
  const stories = new Map(base.stories);
  stories.set(bodyId, story);
  return { ...base, stories };
}

describe('normalize over tables', () => {
  test('a model containing a table normalizes without crashing', () => {
    const table: TableRecord = {
      kind: 'table',
      id: 't1',
      rows: [{ id: 'r1', cells: [{ id: 'c1', blocks: [{ kind: 'paragraph', id: 'cp1', runs: [{ text: 'x' }] }] }] }],
    };
    expect(() => normalize(withTable(table))).not.toThrow();
  });

  test('runs inside a nested cell paragraph are merged (recursion reaches them)', () => {
    const table: TableRecord = {
      kind: 'table',
      id: 't1',
      rows: [
        {
          id: 'r1',
          cells: [
            {
              id: 'c1',
              // Two adjacent anonymous same-prop runs must merge to one.
              blocks: [{ kind: 'paragraph', id: 'cp1', runs: [{ text: 'a' }, { text: 'b' }] }],
            },
          ],
        },
      ],
    };
    const model = normalize(withTable(table));
    const t = model.stories.get(bodyStoryId(model))!.blocks.find((b) => b.kind === 'table') as TableRecord;
    const cellPara = t.rows[0].cells[0].blocks[0] as ParagraphRecord;
    expect(cellPara.runs.map((r) => r.text)).toEqual(['ab']);
  });

  test('an unchanged table returns the same story reference (idempotent)', () => {
    const table: TableRecord = {
      kind: 'table',
      id: 't1',
      rows: [{ id: 'r1', cells: [{ id: 'c1', blocks: [{ kind: 'paragraph', id: 'cp1', runs: [{ text: 'ab' }] }] }] }],
    };
    const model = withTable(table);
    expect(normalize(model)).toBe(model); // nothing to change -> same reference
  });
});
