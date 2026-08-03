// The differential that ties the display modes to accept/reject.
//
// Specifying the resolved modes as equal to accept-all and reject-all OUTPUT is what makes them
// checkable without either one mutating anything. It also checks the two implementations against
// each other: the layout projection suppresses by containment, the op rebuilds the tree, and if
// they ever disagree about what a revision means, this fails rather than shipping a "show final"
// view that differs from what accepting would actually produce.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  applyTreeOp,
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  readOoxmlPart,
  type OoxmlPart,
} from '@docx-editor.dev/core-contract/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Laid-out text per line, which is what a reader actually sees. */
function laidOut(part: OoxmlPart, mode: RevisionDisplayMode = 'all-markup'): string[] {
  return linesOf(layoutSemanticDocument(part, 1, { measurer, displayMode: mode })).map((line) =>
    line.spans.map((span) => span.text).join('')
  );
}

function resolveAll(part: OoxmlPart, action: 'accept' | 'reject'): OoxmlPart {
  const result = applyTreeOp(part, {
    op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const ins = (id: string, inner: string) =>
  `<w:ins w:id="${id}" w:author="QA" w:date="2026-03-26T11:00:00Z">${inner}</w:ins>`;
const del = (id: string, inner: string) =>
  `<w:del w:id="${id}" w:author="Dev" w:date="2026-03-26T12:00:00Z">${inner}</w:del>`;

/** Insertions, deletions, a nested pair, and enough text to wrap across several lines. */
const MIXED =
  `<w:p>${run('The quick brown fox ')}${ins('1', run('very quickly '))}` +
  `${del('2', delRun('slowly '))}${run('jumps over the lazy dog.')}</w:p>` +
  `<w:p>${del('3', ins('4', run('a second round of review ')))}${run('remains.')}</w:p>` +
  `<w:p>${ins('5', run('an entirely inserted paragraph of text goes here'))}</w:p>`;

describe('display modes equal what resolving would produce', () => {
  test('the proposed result equals the layout after accept-all', () => {
    const part = load(MIXED);
    expect(laidOut(part, 'proposed')).toEqual(laidOut(resolveAll(part, 'accept')));
  });

  test('the original equals the layout after reject-all', () => {
    const part = load(MIXED);
    expect(laidOut(part, 'original')).toEqual(laidOut(resolveAll(part, 'reject')));
  });

  test('the two resolved views differ, so the test is not passing vacuously', () => {
    const part = load(MIXED);
    expect(laidOut(part, 'proposed')).not.toEqual(laidOut(part, 'original'));
    expect(laidOut(part, 'all-markup')).not.toEqual(laidOut(part, 'proposed'));
  });

  test('viewing a mode leaves the package fingerprint-identical', () => {
    const part = load(MIXED);
    const before = canonicalOoxmlFingerprint(part);
    laidOut(part, 'proposed');
    laidOut(part, 'original');
    expect(canonicalOoxmlFingerprint(part)).toBe(before);
    // Resolving, by contrast, is supposed to change the document.
    expect(canonicalOoxmlFingerprint(resolveAll(part, 'accept'))).not.toBe(before);
  });

  test('resolving is idempotent: nothing is left to resolve afterwards', () => {
    const accepted = resolveAll(load(MIXED), 'accept');
    const again = applyTreeOp(accepted, { op: 'acceptAllRevisions' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('unknown-revision');
  });
});

describe('the differential holds on a real document', () => {
  const FIXTURE = resolvePath(
    import.meta.dir,
    '../../../../../e2e/fixtures/issue-319-sections.docx'
  );

  function bodyPart(): OoxmlPart {
    const pkg = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
    if (!pkg.ok) throw new Error(pkg.reason);
    const part = pkg.package.parts.get('/word/document.xml');
    if (!part) throw new Error('no document part');
    return part;
  }

  /** What a reader reads, ignoring where the lines happen to break. */
  const readingText = (lines: readonly string[]): string => lines.join('');

  test('proposed content equals accept-all content across 85 insertions and 106 deletions', () => {
    const part = bodyPart();
    expect(readingText(laidOut(part, 'proposed'))).toBe(
      readingText(laidOut(resolveAll(part, 'accept')))
    );
  });

  test('original content equals reject-all content on the same document', () => {
    const part = bodyPart();
    expect(readingText(laidOut(part, 'original'))).toBe(
      readingText(laidOut(resolveAll(part, 'reject')))
    );
  });

  test('KNOWN GAP: the resolved display modes do not merge paragraph marks', () => {
    // Accepting a deleted paragraph mark merges the paragraph with the next one, and the op
    // does that. The display-mode projection does not: it suppresses CONTENT by containment,
    // and a paragraph whose mark is resolved away still occupies a block. So the two agree on
    // what the document says and disagree on how many paragraphs say it.
    //
    // This asserts the gap rather than hiding it behind a content-only comparison, so the test
    // fails — and this comment comes off — when block-level projection lands.
    const part = bodyPart();
    const projected = laidOut(part, 'proposed');
    const resolved = laidOut(resolveAll(part, 'accept'));
    expect(projected).not.toEqual(resolved);
    expect(projected.length).toBeGreaterThan(resolved.length);
    // The difference is entirely empty lines left where a merged paragraph used to be.
    expect(projected.filter((line) => line !== '')).toEqual(resolved.filter((line) => line !== ''));
  });
});
