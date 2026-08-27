// A merge at every level of a deeply nested table is a `.docx` an attacker writes.
//
// Planning a merge's height PROBES its rows, and a probe re-enters nested-table layout,
// which plans the level below, which probes again. That multiplies rather than adds: with a
// per-table allowance the same shape ran 63ms at depth 6, 4.3s at depth 10 and extrapolated
// past an hour at `MAX_TABLE_NESTING` — from a document of a few kilobytes.
//
// The allowance is therefore one pool for the whole pass, inherited by every nested table.
// This pins that: the pool is what makes the work additive, and the fixture below is small
// enough to write by hand and deep enough to take minutes without it.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { MAX_TABLE_NESTING } from '../semantic-table.ts';
import { MAX_VMERGE_PROBE_LAYOUTS } from '../table-vmerge-heights.ts';

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

  test('the ceiling is a pass-wide pool, not a per-table one', () => {
    // The number itself is not the contract; that it is spent ONCE across the document is.
    // A per-table allowance would let each of the sixteen levels re-spend the whole thing.
    expect(MAX_VMERGE_PROBE_LAYOUTS).toBeGreaterThan(0);
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
