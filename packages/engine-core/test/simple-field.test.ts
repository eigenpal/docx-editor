// Simple-field (w:fldSimple) result-text recovery (document-engine task 2.7;
// ECMA-376 Part 1 §17.16.19). Regression for the MoE-review CONFIRMED bug: a
// simple field's result runs were dropped on parse (e.g. footer "Page X of Y").

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { parseDocx, bodyStoryId, type ParagraphRecord } from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docx(bodyInner: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml':
      strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`),
  });
}

function bodyText(bytes: Uint8Array): string {
  const r = parseDocx(bytes);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.model.stories
    .get(bodyStoryId(r.model))!
    .blocks.map((b) => (b as ParagraphRecord).runs.map((run) => run.text).join(''))
    .join('|');
}

describe('w:fldSimple result runs', () => {
  test('a PAGE simple field result is recovered (not dropped)', () => {
    const p =
      '<w:p>' +
      '<w:r><w:t xml:space="preserve">Page </w:t></w:r>' +
      '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>' +
      '<w:r><w:t xml:space="preserve"> of end</w:t></w:r>' +
      '</w:p>';
    // Was "Page  of end" (the "7" lost); now the full result text is present.
    expect(bodyText(docx(p))).toBe('Page 7 of end');
  });

  test('a nested field inside a hyperlink still recovers its result', () => {
    const p =
      '<w:p><w:hyperlink><w:fldSimple w:instr=" REF x "><w:r><w:t>ref-result</w:t></w:r></w:fldSimple></w:hyperlink></w:p>';
    expect(bodyText(docx(p))).toBe('ref-result');
  });
});
