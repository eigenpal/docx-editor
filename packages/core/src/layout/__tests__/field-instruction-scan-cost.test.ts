// The field-code scan runs over every story block list on a full layout pass, and on each
// keystroke inside multi-paragraph field codes. It stays linear in paragraphs and markers:
// each field marks its range once, and a field nested past `MAX_FIELD_NESTING` is skipped.
// A linear scan takes about four times as long for four times the paragraphs; a scan that
// walks each field's range would take about sixteen times as long.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { scanFieldInstructionParagraphs } from '../field-instruction-paragraphs.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const begin =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>IF "</w:instrText></w:r>';
const end =
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';

function blocksOf(paragraphs: readonly string[]): OoxmlElement[] {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${paragraphs.map((p) => `<w:p>${p}</w:p>`).join('')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const body = result.part.root.children.find((child) => child.kind !== 'textValue')!;
  return (body as OoxmlElement).children as OoxmlElement[];
}

/** The fastest of several runs, in milliseconds, so one slow run does not decide. */
function fastest(run: () => unknown): number {
  let best = Infinity;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

/** `count` fields, each nested in the one before, every character in its own paragraph. */
const nested = (count: number) =>
  blocksOf([
    ...Array.from({ length: count }, () => begin),
    ...Array.from({ length: count }, () => end),
  ]);

describe('the field-code scan cost', () => {
  test('deep nesting keeps the fields within the cap and stays linear', () => {
    const small = nested(1000);
    const large = nested(4000);
    // The four outer fields stay; the outermost one spans every paragraph between its ends.
    const result = scanFieldInstructionParagraphs(large);
    expect(result.inside.size).toBe(2 * 4000 - 2);
    expect(result.joins).toHaveLength(4);
    const ratio =
      fastest(() => scanFieldInstructionParagraphs(large)) /
      Math.max(
        fastest(() => scanFieldInstructionParagraphs(small)),
        0.01
      );
    expect(ratio).toBeLessThan(10);
  });

  test('fields that each span the whole story mark it once', () => {
    const story = (count: number) =>
      blocksOf([
        begin + begin + begin,
        ...Array.from({ length: count }, () => '<w:r><w:instrText>x</w:instrText></w:r>'),
        end + end + end,
      ]);
    const small = story(5000);
    const large = story(20_000);
    const result = scanFieldInstructionParagraphs(large);
    expect(result.inside.size).toBe(20_000);
    expect(result.spanned.size).toBe(20_000);
    const ratio =
      fastest(() => scanFieldInstructionParagraphs(large)) /
      Math.max(
        fastest(() => scanFieldInstructionParagraphs(small)),
        0.01
      );
    expect(ratio).toBeLessThan(10);
  });
});
