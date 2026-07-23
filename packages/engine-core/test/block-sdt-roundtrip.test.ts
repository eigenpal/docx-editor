// Structural block-level SDT (content control) slice: a w:sdt is imported as a
// first-class SdtRecord (NOT flattened into paragraphs), its w:sdtPr header
// (id/tag/alias/lock/control-type) survives, its nested content stays addressable, and
// an unedited document re-emits byte-identically through verbatim preservation. Verified
// against real fixtures. Editing inside an SDT fails closed (deferred increment).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { parseDocx, writeDocx } from '../src/package/opc.ts';
import type { PackageModel, Story, SdtRecord } from '../src/model/index.ts';

const FIX = `${import.meta.dir}/../../../e2e/fixtures`;

function parse(name: string): PackageModel {
  const r = parseDocx(readFileSync(`${FIX}/${name}`));
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`parse failed: ${r.reason} ${r.detail ?? ''}`);
  return r.model;
}
function bodyBlocks(model: PackageModel) {
  const body = [...model.stories.values()].find((s: Story) => s.kind === 'body')!;
  return body.blocks;
}
function docXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

describe('block SDT structural import (no flattening)', () => {
  test('block-sdt-showcase: SDTs are SdtRecords with parsed props, not flat paragraphs', () => {
    const model = parse('block-sdt-showcase.docx');
    const blocks = bodyBlocks(model);
    const sdts = blocks.filter((b): b is SdtRecord => b.kind === 'sdt');

    // The fixture has 9 w:sdt; two are nested repeatingSectionItems inside a
    // repeatingSection, so the body has fewer TOP-LEVEL SDT blocks but every one is
    // structural (none flattened away).
    expect(sdts.length).toBeGreaterThanOrEqual(6);
    expect(model.preservation).toBeDefined();

    // Semantic header survived: tag/alias/control-type are read off w:sdtPr.
    const byTag = new Map(sdts.filter((s) => s.props.tag).map((s) => [s.props.tag!, s]));
    expect(byTag.get('intro')?.props.controlType).toBe('richText');
    expect(byTag.get('agree')?.props.controlType).toBe('checkbox');
    expect(byTag.get('status')?.props.controlType).toBe('dropDownList');
    expect(byTag.get('effective')?.props.controlType).toBe('date');
    expect(byTag.get('rows')?.props.controlType).toBe('repeatingSection');
    expect(byTag.get('intro')?.props.alias).toBe('Intro');
    // The locked dropdown keeps its lock state.
    expect(byTag.get('lockedchoice')?.props.lock).toBe('sdtContentLocked');
    // The XML-bound checkbox records its data binding.
    expect(byTag.get('boundcheck')?.props.dataBinding).toBe(true);
    // docId comes off w:id.
    expect(byTag.get('intro')?.props.docId).toBe(101);

    // Nested content is addressable, not discarded: the repeatingSection holds items.
    const rows = byTag.get('rows')!;
    const nestedSdts = rows.blocks.filter((b) => b.kind === 'sdt');
    expect(nestedSdts.length).toBeGreaterThanOrEqual(2); // two repeatingSectionItems
  });

  test('block-sdt-showcase: unedited round-trip is byte-identical (verbatim preservation)', () => {
    const bytes = readFileSync(`${FIX}/block-sdt-showcase.docx`);
    const before = docXml(bytes);
    const out = writeDocx(parse('block-sdt-showcase.docx'));
    const after = docXml(out);
    expect(after).toBe(before);
    // Every w:sdtPr present before is present after (nothing dropped on save).
    expect((after.match(/<w:sdtPr/g) ?? []).length).toBe((before.match(/<w:sdtPr/g) ?? []).length);
  });

  test('reopen preserves structure (parse -> save -> parse yields the same SDT shape)', () => {
    const first = parse('block-sdt-showcase.docx');
    const saved = writeDocx(first);
    const r2 = parseDocx(saved);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const a = bodyBlocks(first).map((b) => b.kind).join(',');
    const b = bodyBlocks(r2.model).map((x) => x.kind).join(',');
    expect(b).toBe(a);
  });
});

describe('other block-SDT fixtures import structurally and round-trip verbatim', () => {
  for (const name of ['block-sdt-comprehensive.docx', 'block-sdt-widgets.docx', 'block-sdt-repeating.docx']) {
    test(`${name}: has structural SDTs and re-emits byte-identically`, () => {
      const bytes = readFileSync(`${FIX}/${name}`);
      const model = parse(name);
      const sdtCount = bodyBlocks(model).filter((b) => b.kind === 'sdt').length;
      expect(sdtCount).toBeGreaterThan(0);
      expect(docXml(writeDocx(model))).toBe(docXml(bytes));
    });
  }
});

// ---- adversarial edge cases: the scanner span count MUST equal the parsed tree block
// count (opc.parseDocx cross-check), or a valid doc is wrongly rejected / a range
// mis-owns content. Each of these must import cleanly AND re-emit byte-identically.
import { zipSync, strToU8 } from 'fflate';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function synthDocx(inner: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${inner}</w:body></w:document>`),
  });
}
function roundTrips(inner: string): { model: PackageModel; identical: boolean } {
  const bytes = synthDocx(inner);
  const r = parseDocx(bytes);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
  return { model: r.model, identical: docXml(writeDocx(r.model)) === docXml(bytes) };
}

describe('block-SDT scanner/tree cross-check edge cases', () => {
  test('an SDT with NO w:sdtContent is one block with empty content and round-trips', () => {
    const { model, identical } = roundTrips('<w:sdt><w:sdtPr><w:tag w:val="empty"/></w:sdtPr></w:sdt>');
    const blocks = bodyBlocks(model);
    expect(blocks.map((b) => b.kind)).toEqual(['sdt']);
    expect((blocks[0] as SdtRecord).blocks.length).toBe(0);
    expect(identical).toBe(true);
  });

  test('an SDT nested under a transparent w:customXml wrapper counts as one block', () => {
    const { model, identical } = roundTrips(
      '<w:p><w:r><w:t>a</w:t></w:r></w:p>' +
        '<w:customXml w:element="x"><w:sdt><w:sdtPr><w:tag w:val="wrapped"/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>b</w:t></w:r></w:p></w:sdtContent></w:sdt></w:customXml>',
    );
    // customXml is transparent; the SDT inside it is the block (scanner + tree agree).
    expect(bodyBlocks(model).map((b) => b.kind)).toEqual(['paragraph', 'sdt']);
    expect(identical).toBe(true);
  });

  test('nested SDTs (an SDT inside an SDT) stay structural at both levels', () => {
    const { model, identical } = roundTrips(
      '<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>' +
        '<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>' +
        '<w:p><w:r><w:t>deep</w:t></w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>',
    );
    const blocks = bodyBlocks(model);
    expect(blocks.map((b) => b.kind)).toEqual(['sdt']);
    const outer = blocks[0] as SdtRecord;
    expect(outer.props.tag).toBe('outer');
    expect(outer.blocks.map((b) => b.kind)).toEqual(['sdt']);
    expect((outer.blocks[0] as SdtRecord).props.tag).toBe('inner');
    expect(identical).toBe(true);
  });

  test('a decoy </w:sdt> inside a comment does not corrupt span ownership', () => {
    const { model, identical } = roundTrips(
      '<w:sdt><w:sdtPr><w:tag w:val="c"/></w:sdtPr><w:sdtContent>' +
        '<!-- </w:sdt> decoy --><w:p><w:r><w:t>real</w:t></w:r></w:p></w:sdtContent></w:sdt>',
    );
    expect(bodyBlocks(model).map((b) => b.kind)).toEqual(['sdt']);
    expect(identical).toBe(true);
  });
});

describe('block-SDT security + fail-closed nets (SDT review High/Medium)', () => {
  test('a block SDT hidden in an unsupported wrapper fails closed (not silently dropped)', () => {
    // <w:foreign> is not a wrapper the structural traversal descends; on the flat path
    // nothing is preserved, so a block SDT inside it would be lost. Must reject.
    const r = parseDocx(synthDocx('<w:foreign><w:sdt><w:sdtPr><w:tag w:val="hidden"/></w:sdtPr>' +
      '<w:sdtContent><w:p><w:r><w:t>secret</w:t></w:r></w:p></w:sdtContent></w:sdt></w:foreign>'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('unsupported container');
  });

  test('a reachable SDT plus one hidden in a wrapper: still parses (bytes preserved verbatim)', () => {
    // Preservation active (reachable SDT) => whole document.xml is byte-preserved, so the
    // hidden one is NOT lost on save even though it is not structurally modeled.
    const { identical } = roundTrips(
      '<w:sdt><w:sdtPr><w:tag w:val="ok"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>a</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '<w:foreign><w:sdt><w:sdtPr><w:tag w:val="hidden"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>b</w:t></w:r></w:p></w:sdtContent></w:sdt></w:foreign>',
    );
    expect(identical).toBe(true);
  });

  test('an inline (run-content) SDT hidden in a wrapper does NOT trip the block-SDT net', () => {
    // Inline controls carry run content, not block content; they are intentionally
    // flattened, so a table-free doc with only inline SDTs stays on the flat path.
    const r = parseDocx(synthDocx('<w:p><w:r><w:t>x</w:t></w:r></w:p>' +
      '<w:ins><w:sdt><w:sdtContent><w:r><w:t>inline</w:t></w:r></w:sdtContent></w:sdt></w:ins>'));
    expect(r.ok).toBe(true);
  });

  test('an attacker-controlled w:sdtPr child name (constructor/__proto__) cannot crash parse', () => {
    for (const evil of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const r = parseDocx(synthDocx(`<w:sdt><w:sdtPr><w:tag w:val="e"/><${evil}/></w:sdtPr>` +
        '<w:sdtContent><w:p><w:r><w:t>t</w:t></w:r></w:p></w:sdtContent></w:sdt>'));
      expect(r.ok).toBe(true);
      if (r.ok) {
        const sdt = bodyBlocks(r.model).find((b): b is SdtRecord => b.kind === 'sdt')!;
        // controlType must be a real SdtControlType or undefined, never an inherited function.
        expect(sdt.props.controlType === undefined || typeof sdt.props.controlType === 'string').toBe(true);
      }
    }
  });
});

describe('block-SDT compositional-bypass net (SDT review round 2)', () => {
  test('block content wrapped in w:ins INSIDE an SDT, hidden under w:foreign, fails closed', () => {
    // The inner w:ins is not a wrapper the model descends, and the outer w:foreign hides
    // the SDT from the structural path — the deep net must still catch the block content.
    const r = parseDocx(synthDocx(
      '<w:foreign><w:sdt><w:sdtPr><w:tag w:val="deep"/></w:sdtPr><w:sdtContent>' +
        '<w:ins><w:p><w:r><w:t>secret</w:t></w:r></w:p></w:ins>' +
        '</w:sdtContent></w:sdt></w:foreign>',
    ));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('unsupported container');
  });

  test('a table wrapped in w:del inside an SDT under w:foreign also fails closed', () => {
    const r = parseDocx(synthDocx(
      '<w:foreign><w:sdt><w:sdtContent><w:del><w:tbl><w:tr><w:tc>' +
        '<w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:del>' +
        '</w:sdtContent></w:sdt></w:foreign>',
    ));
    expect(r.ok).toBe(false);
  });

  test('an inline SDT whose content is runs-in-w:ins under w:foreign still does NOT trip', () => {
    // No w:p/w:tbl anywhere in the SDT content -> inline -> stays on the flat path.
    const r = parseDocx(synthDocx(
      '<w:p><w:r><w:t>a</w:t></w:r></w:p>' +
        '<w:foreign><w:sdt><w:sdtContent><w:ins><w:r><w:t>inline</w:t></w:r></w:ins>' +
        '</w:sdtContent></w:sdt></w:foreign>',
    ));
    expect(r.ok).toBe(true);
  });
});
