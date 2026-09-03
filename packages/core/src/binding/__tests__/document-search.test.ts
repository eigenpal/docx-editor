// Document text search over the tree session (`collectTextMatches`, facade `findMatches`).
//
// What these pin down: matches are found in body-story paragraphs in document order and
// addressed in `paragraphTextOf`'s offset vocabulary (so `selectMatch` can hand one
// straight to `setSelection`); matching is non-overlapping, case-insensitive by default,
// and whole-word when asked; run addressing follows the same walk as the offsets,
// including runs inside a hyperlink; file-derived strings are bounded at the derivation
// boundary; and the pathological inputs (empty query, over-long query, one-character query
// against a long document) are refused or capped rather than allowed to allocate.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { openTreeSession, type TreeDocxSession } from '../tree-session.ts';
import { collectTextMatches, SEARCH_MATCH_LIMIT, SEARCH_QUERY_MAX } from '../document-search.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R_NS}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function open(bytes: Uint8Array): TreeDocxSession {
  const result = openTreeSession(bytes);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.session;
}

const para = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

function search(body: string, query: string, options?: Parameters<typeof collectTextMatches>[2]) {
  return collectTextMatches(open(docx(body)).part(), query, options);
}

describe('collectTextMatches', () => {
  test('finds occurrences in document order, addressed by paragraph offset', () => {
    const { matches, truncated } = search(
      para(run('Exhibit A is attached.')) + para(run('See Exhibit B.')),
      'Exhibit'
    );

    expect(truncated).toBe(false);
    expect(matches.map((match) => [match.paragraphIndex, match.start, match.length])).toEqual([
      [0, 0, 7],
      [1, 4, 7],
    ]);
    expect(matches.map((match) => match.text)).toEqual(['Exhibit', 'Exhibit']);
    // Distinct paragraphs, so distinct block ids — the address `scrollToBlock` accepts.
    expect(matches[0]!.blockId).not.toBe(matches[1]!.blockId);
  });

  test('is case-insensitive by default and case-sensitive on request', () => {
    const body = para(run('Exhibit and exhibit and EXHIBIT.'));

    expect(search(body, 'exhibit').matches).toHaveLength(3);
    expect(search(body, 'exhibit', { matchCase: true }).matches.map((m) => m.start)).toEqual([12]);
  });

  test('counts non-overlapping occurrences, the way a find dialog does', () => {
    // `aa` in `aaaa` is two matches, not three: the scan resumes past each occurrence.
    expect(search(para(run('aaaa')), 'aa').matches.map((m) => m.start)).toEqual([0, 2]);
  });

  test('wholeWord rejects a match glued to a letter, digit or underscore on either side', () => {
    const body = para(run('cat cats concat cat_ 9cat cat.'));
    const starts = search(body, 'cat', { wholeWord: true }).matches.map((m) => m.start);

    // 'cat' at 0, and 'cat' at 26 (before the period). Everything else is glued.
    expect(starts).toEqual([0, 26]);
  });

  test('carries bounded surrounding context on both sides of the match', () => {
    const { matches } = search(
      para(run('the Walter SaaS Services as described in this Exhibit A ("Support Services").')),
      'Exhibit'
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]!.contextBefore.endsWith('described in this ')).toBe(true);
    expect(matches[0]!.contextAfter.startsWith(' A ("Support')).toBe(true);
  });

  test('addresses the run a match starts in, counting runs inside a hyperlink', () => {
    const body = para(
      run('Go to '),
      `<w:hyperlink r:id="rId9">${run('Example')}${run('.com')}</w:hyperlink>`,
      run(' now.')
    );
    // Paragraph text is "Go to Example.com now." — 'com' starts at 14, inside the SECOND
    // run of the link, which is run index 2 overall (run 0 is "Go to ").
    const { matches } = search(body, 'com');

    expect(matches).toHaveLength(1);
    expect(matches[0]!.start).toBe(14);
    expect(matches[0]!.runIndex).toBe(2);
    expect(matches[0]!.runOffset).toBe(1);
  });

  test('finds and addresses runs inside each inline run wrapper', () => {
    const body = para(
      run('start '),
      `<w:smartTag>${run('smart')}</w:smartTag>`,
      `<w:customXml>${run('custom')}</w:customXml>`,
      `<w:dir>${run('direction')}</w:dir>`,
      `<w:bdo>${run('override')}</w:bdo>`
    );
    const expected = [
      ['smart', 1],
      ['custom', 2],
      ['direction', 3],
      ['override', 4],
    ] as const;

    for (const [query, runIndex] of expected) {
      const matches = search(body, query).matches;
      expect(matches).toHaveLength(1);
      expect(matches[0]!.runIndex).toBe(runIndex);
      expect(matches[0]!.runOffset).toBe(0);
    }
  });

  test('counts a tab as one character, so offsets match the tree ops', () => {
    const body = para(`<w:r><w:tab/><w:t>Exhibit</w:t></w:r>`);
    const { matches } = search(body, 'Exhibit');

    expect(matches[0]!.start).toBe(1);
    expect(matches[0]!.runOffset).toBe(1);
  });

  test('does not descend into table cells, matching the contract paragraph ordinal', () => {
    const body =
      para(run('Body Exhibit.')) +
      `<w:tbl><w:tr><w:tc>${para(run('Cell Exhibit.'))}</w:tc></w:tr></w:tbl>`;
    const { matches } = search(body, 'Exhibit');

    expect(matches).toHaveLength(1);
    expect(matches[0]!.paragraphIndex).toBe(0);
  });

  test('flattens control characters out of every string it returns', () => {
    // A hard break is one character in the offset vocabulary and must not reach a panel
    // row as a control character.
    const body = para(`<w:r><w:t>Exhibit</w:t><w:br/><w:t>A</w:t></w:r>`);
    const { matches } = search(body, 'Exhibit');

    expect(matches[0]!.contextAfter).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
  });

  test('refuses an empty or over-long query rather than matching everything', () => {
    const body = para(run('Exhibit A'));

    expect(search(body, '').matches).toEqual([]);
    expect(search(body, 'x'.repeat(SEARCH_QUERY_MAX + 1)).matches).toEqual([]);
    expect(search(body, 'x'.repeat(SEARCH_QUERY_MAX)).matches).toEqual([]);
  });

  test('caps the result set and reports that it stopped early', () => {
    // One paragraph of 3000 'a' characters: uncapped this would allocate a match each.
    const { matches, truncated } = search(para(run('a'.repeat(SEARCH_MATCH_LIMIT + 1000))), 'a');

    expect(matches).toHaveLength(SEARCH_MATCH_LIMIT);
    expect(truncated).toBe(true);
  });

  test('honours a caller limit below the cap but never above it', () => {
    const body = para(run('a'.repeat(50)));

    expect(search(body, 'a', { limit: 10 }).matches).toHaveLength(10);
    expect(search(body, 'a', { limit: 10 }).truncated).toBe(true);
    expect(search(body, 'a', { limit: SEARCH_MATCH_LIMIT * 10 }).matches).toHaveLength(50);
  });

  test('treats a regex-shaped query as literal text', () => {
    // A query is host input; if it were compiled as a pattern this would match everything
    // (and `(a+)+$` against a long run would be the backtracking hazard).
    const body = para(run('a literal .* stays literal'));

    expect(search(body, '.*').matches.map((m) => m.start)).toEqual([10]);
    expect(search(para(run('a'.repeat(64))), '(a+)+$').matches).toEqual([]);
  });

  test('keeps offsets aligned when case folding would otherwise expand the text', () => {
    // U+0130 lowercases to TWO code units. Folding must not slide the offsets after it,
    // or the match is reported where the editor would select the wrong text.
    const body = para(run('İstanbul Exhibit'));
    const { matches } = search(body, 'exhibit');

    expect(matches).toHaveLength(1);
    expect(matches[0]!.start).toBe(9);
  });
});
