// A merge at every level of a deeply nested table is a `.docx` an attacker writes.
//
// Planning a merge's height PROBES its rows, and a probe re-enters nested-table layout,
// which plans the level below, which probes again. That multiplies rather than adds: with a
// per-table allowance the same shape ran 63ms at depth 6, 4.3s at depth 10 and extrapolated
// past an hour at `MAX_TABLE_NESTING` — from a document of a few kilobytes.
//
// So a row probe measures the tables inside it WITHOUT planning them, and the re-entry stops
// multiplying. This pins that: the fixture below is small enough to write by hand and deep
// enough to take minutes if a probe ever plans again.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { MAX_TABLE_NESTING } from '../semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadBody(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const RESTART = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>';
const CONTINUE = '<w:tcPr><w:vMerge/></w:tcPr>';

/** A two-column table with a merge in each column, `depth` levels of them nested. */
function nestedMerges(depth: number): string {
  const inner = depth > 0 ? nestedMerges(depth - 1) : p('leaf');
  return (
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
    `<w:tr><w:tc>${RESTART}${inner}</w:tc><w:tc>${RESTART}${p('b')}</w:tc></w:tr>` +
    `<w:tr><w:tc>${CONTINUE}${p('')}</w:tc><w:tc>${CONTINUE}${p('')}</w:tc></w:tr>` +
    `<w:tr><w:tc>${p('c')}</w:tc><w:tc>${p('d')}</w:tc></w:tr>` +
    '</w:tbl>'
  );
}

describe('a merge at every level of a nested table', () => {
  test('lays out in time a person would wait, at the nesting ceiling', () => {
    const part = loadBody(nestedMerges(MAX_TABLE_NESTING));
    const started = Bun.nanoseconds();
    // A nest this deep is taller than any page, so layout fails closed rather than
    // returning — which is the pre-existing answer and not what this test is about. The
    // claim is the TIME it takes to reach either answer.
    try {
      layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() });
    } catch {
      /* fail-closed is a fine outcome; a hang is not */
    }
    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;
    // Generous by three orders of magnitude against the fixed measurer, and still nowhere
    // near what an allowance that does not compose across nesting costs.
    expect(elapsedMs).toBeLessThan(2_000);
  });

  test('two nests in one document cost the sum of them, not the product', () => {
    // What bounds the work is that a row PROBE does not plan the tables inside it, so the
    // re-entry never multiplies. No allowance is spent, and nothing here depends on what a
    // pass walked first.
    const twice = loadBody(nestedMerges(6) + p('between') + nestedMerges(6));
    const started = Bun.nanoseconds();
    try {
      layoutSemanticDocument(twice, 0, { measurer: createFixedMeasurer() });
    } catch {
      /* as above */
    }
    expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(2_000);
  });
});
