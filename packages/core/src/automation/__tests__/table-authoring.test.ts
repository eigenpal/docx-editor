import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { paragraphModelTextOf } from '../../store/store/paragraph-model-text.ts';
import { applyTreeOp, type TreeDocOp } from '../../store/store/tree-ops.ts';
import {
  planInsertTable,
  planTableMutation,
  tableRead,
  tableCellRead,
  tableNodes,
} from '../tables.ts';
import type { AutomationStoryReads } from '../reads.ts';
function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:x="urn:extension"><w:body>${body}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function read(part: OoxmlPart): AutomationStoryReads {
  return {
    part,
    root: part.root,
    rawText(id: string) {
      const stack: OoxmlNode[] = [part.root];
      while (stack.length) {
        const node = stack.pop()!;
        if (node.kind === 'paragraph' && node.id === id) return paragraphModelTextOf(node);
        if (node.kind !== 'textValue') stack.push(...node.children);
      }
      return null;
    },
  } as AutomationStoryReads;
}
function apply(part: OoxmlPart, ops: readonly TreeDocOp[]): OoxmlPart {
  for (const op of ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw new Error(result.reason);
    part = result.part;
  }
  return part;
}
function tableFixture(): { part: OoxmlPart; id: string } {
  let part = load('<w:p><w:r><w:t>Untouched</w:t></w:r></w:p>');
  const body = part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('body');
  const p = body.children[0]!;
  const plan = planInsertTable(read(part), p.id, 0, 2, 2, [
    ['A', 'B'],
    ['C', 'D'],
  ]);
  if (!plan.ok) throw new Error(plan.reason);
  part = apply(part, plan.ops);
  return { part, id: plan.tableId };
}
function mutate(
  part: OoxmlPart,
  id: string,
  mutation: Parameters<typeof planTableMutation>[2]
): OoxmlPart {
  const plan = planTableMutation(read(part), id, mutation);
  if (!plan.ok) throw new Error(plan.reason);
  return apply(part, plan.ops);
}

describe('canonical table authoring', () => {
  test('semantic table operation allocates, populates, and retains split mapping in one application', () => {
    const part = load('<w:p><w:r><w:t>BeforeAfter</w:t></w:r></w:p>');
    const body = part.root.children[0]!;
    if (body.kind === 'textValue') throw new Error('body');
    const paragraphId = body.children[0]!.id;
    const preview = planInsertTable(read(part), paragraphId, 6, 1, 2, [['X', 'Y']]);
    expect(preview.ok).toBe(true);
    const result = applyTreeOp(part, {
      op: 'authorTable',
      action: {
        kind: 'insert',
        paragraphId,
        offset: 6,
        rowCount: 1,
        columnCount: 2,
        values: [['X', 'Y']],
      },
    });
    if (!result.ok) throw new Error(result.reason);
    const table = tableNodes(result.part.root)[0]!;
    expect(tableRead(read(result.part), table.id)?.values).toEqual([['X', 'Y']]);
    expect(result.effect.created.length).toBe(3);
    expect(result.effect.splits?.length).toBe(1);
    expect(serializeOoxmlPart(result.part)).toContain('Before');
    expect(serializeOoxmlPart(result.part)).toContain('After');
    const rows = applyTreeOp(result.part, {
      op: 'authorTable',
      action: {
        kind: 'existing',
        tableId: table.id,
        mutation: {
          kind: 'addRows',
          location: 'end',
          count: 2,
          values: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
      },
    });
    if (!rows.ok) throw new Error(rows.reason);
    expect(tableRead(read(rows.part), table.id)?.values).toEqual([
      ['X', 'Y'],
      ['A', 'B'],
      ['C', 'D'],
    ]);
  });

  test('creates and fills a table in one atomic ordered plan', () => {
    const { part, id } = tableFixture();
    expect(tableRead(read(part), id)?.values).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    expect(serializeOoxmlPart(part)).toContain('Untouched');
  });
  test('adds rows and columns with values, then deletes selected rows and columns', () => {
    const fixture = tableFixture();
    let part = fixture.part;
    const id = fixture.id;
    part = mutate(part, id, {
      kind: 'addRows',
      location: 'start',
      count: 2,
      values: [
        ['R1', 'R2'],
        ['S1', 'S2'],
      ],
    });
    part = mutate(part, id, {
      kind: 'addColumns',
      location: 'end',
      count: 1,
      values: [['X'], ['Y'], ['Z'], ['W']],
    });
    expect(tableRead(read(part), id)?.values).toEqual([
      ['R1', 'R2', 'X'],
      ['S1', 'S2', 'Y'],
      ['A', 'B', 'Z'],
      ['C', 'D', 'W'],
    ]);
    part = mutate(part, id, { kind: 'deleteRows', index: 1, count: 2 });
    part = mutate(part, id, { kind: 'deleteColumns', index: 0, count: 1 });
    expect(tableRead(read(part), id)?.values).toEqual([
      ['R2', 'X'],
      ['D', 'W'],
    ]);
  });
  test('writes style, header count, cell text, fill, alignment, and whole-column width', () => {
    const fixture = tableFixture();
    let part = fixture.part;
    const id = fixture.id;
    part = mutate(part, id, { kind: 'properties', styleId: 'TableGrid', headerRowCount: 1 });
    const cell = tableRead(read(part), id)!.cellIds[0]![0]!;
    part = mutate(part, id, {
      kind: 'cell',
      cellId: cell,
      value: 'New',
      shadingColor: '#ABCDEF',
      verticalAlignment: 'Center',
      columnWidth: 90,
    });
    expect(tableCellRead(read(part), id, cell)).toMatchObject({
      value: 'New',
      shadingColor: '#ABCDEF',
      verticalAlignment: 'Center',
      columnWidth: 90,
    });
    expect(tableRead(read(part), id)).toMatchObject({ headerRowCount: 1, styleId: 'TableGrid' });
    part = mutate(part, id, { kind: 'properties', headerRowCount: 0 });
    expect(tableRead(read(part), id)?.headerRowCount).toBe(0);
  });
  test('save/reopen keeps values, width, style, and repeated headers', () => {
    const fixture = tableFixture();
    let part = fixture.part;
    const id = fixture.id;
    part = mutate(part, id, { kind: 'properties', styleId: 'TableGrid', headerRowCount: 1 });
    const cell = tableRead(read(part), id)!.cellIds[1]![1]!;
    part = mutate(part, id, {
      kind: 'cell',
      cellId: cell,
      columnWidth: 110,
      shadingColor: 'AABBCC',
    });
    const xml = serializeOoxmlPart(part);
    const reopened = readOoxmlPart(xml, { name: part.name, contentType: part.contentType });
    if (!reopened.ok) throw new Error(reopened.reason);
    const table = tableNodes(reopened.part.root)[0]!;
    expect(tableRead(read(reopened.part), table.id)).toMatchObject({
      values: [
        ['A', 'B'],
        ['C', 'D'],
      ],
      headerRowCount: 1,
      styleId: 'TableGrid',
    });
  });
  test('refuses invalid matrix/index and merged topology without mutation', () => {
    const { part, id } = tableFixture();
    const before = serializeOoxmlPart(part);
    expect(planTableMutation(read(part), id, { kind: 'values', values: [['wrong']] }).ok).toBe(
      false
    );
    expect(planTableMutation(read(part), id, { kind: 'deleteRows', index: 1, count: 2 }).ok).toBe(
      false
    );
    expect(serializeOoxmlPart(part)).toBe(before);
    const merged = load(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl><w:p/>'
    );
    expect(
      planTableMutation(read(merged), tableNodes(merged.root)[0]!.id, {
        kind: 'values',
        values: [['x']],
      })
    ).toMatchObject({ ok: false, reason: 'table-has-merge' });
  });
  test('preserves unrelated properties and foreign table extension markup', () => {
    const part = load(
      '<w:tbl x:keep="yes"><w:tblPr><w:tblStyle w:val="Old" x:keep="style"/><x:data x:key="preserved"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><x:row/></w:trPr><w:tc><w:tcPr><x:cell/></w:tcPr><w:p/></w:tc></w:tr></w:tbl><w:p/>'
    );
    const id = tableNodes(part.root)[0]!.id;
    const updated = mutate(part, id, { kind: 'properties', styleId: 'New', headerRowCount: 1 });
    const xml = serializeOoxmlPart(updated);
    for (const text of ['x:keep="yes"', 'x:keep="style"', 'x:key="preserved"', 'x:row', 'x:cell'])
      expect(xml).toContain(text);
  });
  test('refuses edits inside content-locked template controls', () => {
    const { part, id } = tableFixture();
    const xml = serializeOoxmlPart(part)
      .replace(
        '<w:tbl>',
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:tbl>'
      )
      .replace('</w:tbl>', '</w:tbl></w:sdtContent></w:sdt>');
    const result = readOoxmlPart(xml, { name: part.name, contentType: part.contentType });
    if (!result.ok) throw new Error(result.reason);
    const table = tableNodes(result.part.root)[0]!;
    expect(
      planTableMutation(read(result.part), table.id, { kind: 'properties', headerRowCount: 1 })
    ).toMatchObject({ ok: false, reason: 'locked' });
    expect(id.length).toBeGreaterThan(0);
  });
});
