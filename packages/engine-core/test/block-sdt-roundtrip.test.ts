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
