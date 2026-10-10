import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTableEditingNestedFixture } from './generate-table-editing-nested-fixture.ts';
import { readTableEditingReadback } from './table-editing-assertions.ts';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'table-editing-nested.docx');

describe('table-editing-nested fixture', () => {
  test('generator bytes match checked-in DOCX', async () => {
    expect(new Uint8Array(readFileSync(FIXTURE))).toEqual(await createTableEditingNestedFixture());
  });

  test('contains isolated outer and inner nested targets', () => {
    const readback = readTableEditingReadback(new Uint8Array(readFileSync(FIXTURE)));
    expect(readback.outer?.cellTexts.some((text) => text.includes('OUTER-TR'))).toBe(true);
    expect(readback.inner?.cellTexts.some((text) => text.includes('INNER-NW'))).toBe(true);
    expect(readback.outer?.tableId).not.toBe(readback.inner?.tableId);
    expect(readback.tables.some((table) => table.cellTexts.some((text) => text.includes('MERGED-ONLY')))).toBe(
      true
    );
  });
});
