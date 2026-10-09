// Tracked deletions over whole paragraphs, through the automation host.
//
// A tracked range deletion strikes the text as deleted runs and every paragraph mark it covers
// as a deleted paragraph mark. A tracked paragraph deletion is the range from the paragraph's
// start to the next paragraph's start. Accept removes what was struck; reject restores it.

import { describe, expect, test } from 'bun:test';
import { canonicalOoxmlFingerprint, readOoxmlPackage, semanticDigest } from '../../store/index.ts';
import {
  docx,
  open,
  p,
  pWithSection,
  paragraphTexts,
  paragraphsOf,
  refusal,
  reopen,
  roots,
  savedMainXml,
  sdt,
  storyText,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import type { AutomationOperation } from '../operations.ts';

const TRACK = { op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' } as const;
const FOUR = docx(p('Alpha one') + p('Bravo two') + p('Charlie three') + p('Delta four'));

function oracles(host: AutomationHost) {
  const saved = host.save();
  if (!saved.ok) throw new Error(saved.error.code);
  const opened = readOoxmlPackage(saved.bytes);
  if (!opened.ok) throw new Error(opened.reason);
  const main = opened.package.parts.get(opened.package.mainDocumentPart)!;
  return {
    fingerprint: canonicalOoxmlFingerprint(main),
    digest: JSON.stringify(semanticDigest(opened.package.parts.values())),
  };
}

function run(host: AutomationHost, operations: readonly AutomationOperation[]) {
  const response = host.execute({ operations: [TRACK, ...operations] });
  expect(response.ok).toBe(true);
  return response;
}

function decide(host: AutomationHost, body: AutomationHandle, accept: boolean) {
  const operation: AutomationOperation = accept
    ? { op: 'acceptAllRevisions', body }
    : { op: 'rejectAllRevisions', body };
  expect(host.execute({ operations: [operation] }).ok).toBe(true);
}

function deleteBetween(
  paragraphs: readonly AutomationHandle[],
  from: [number, number],
  to: [number, number]
): AutomationOperation {
  return {
    op: 'replaceSpan',
    span: {
      start: { paragraph: paragraphs[from[0]]!, offset: from[1] },
      end: { paragraph: paragraphs[to[0]]!, offset: to[1] },
    },
    text: '',
  };
}

describe('tracked range deletion across paragraphs', () => {
  test('a range inside the first and last paragraphs strikes the whole paragraphs between', () => {
    const host = open(FOUR);
    const { body } = roots(host);
    run(host, [deleteBetween(paragraphsOf(host, body), [0, 6], [3, 6])]);
    const xml = savedMainXml(host);
    expect(xml.match(/<w:pPr><w:rPr><w:del /g)).toHaveLength(3);
    expect(paragraphTexts(host, body)).toEqual([
      'Alpha one',
      'Bravo two',
      'Charlie three',
      'Delta four',
    ]);

    const accepted = reopen(host);
    decide(accepted.host, accepted.body, true);
    expect(paragraphTexts(accepted.host, accepted.body)).toEqual(['Alpha four']);
    const again = reopen(accepted.host);
    expect(oracles(again.host)).toEqual(oracles(accepted.host));

    // Reject restores every paragraph and mark. The struck runs come back as separate runs.
    decide(host, body, false);
    expect(storyText(host, body)).toBe('Alpha one\rBravo two\rCharlie three\rDelta four');
    expect(savedMainXml(host)).not.toContain('<w:pPr>');
    expect(savedMainXml(host)).not.toContain('<w:del ');
  });

  test('a range that ends at a paragraph start removes whole paragraphs and their marks', () => {
    const host = open(FOUR);
    const { body } = roots(host);
    run(host, [deleteBetween(paragraphsOf(host, body), [1, 0], [3, 0])]);
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Alpha one', 'Delta four']);
  });
});

describe('tracked paragraph deletion', () => {
  test('deletes text and mark, and deleting adjacent paragraphs shares one batch', () => {
    const host = open(FOUR);
    const { body } = roots(host);
    const paragraphs = paragraphsOf(host, body);
    run(host, [
      { op: 'deleteParagraph', paragraph: paragraphs[1]! },
      { op: 'deleteParagraph', paragraph: paragraphs[2]! },
    ]);
    expect(storyText(host, body)).toBe('Alpha one\rBravo two\rCharlie three\rDelta four');
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Alpha one', 'Delta four']);
  });

  test('a paragraph inside a block content control needs a next paragraph in the control', () => {
    const host = open(docx(sdt(p('Inside first'), p('Inside last')) + p('Outside')));
    const { body } = roots(host);
    const paragraphs = paragraphsOf(host, body);
    const last = host.execute({
      operations: [TRACK, { op: 'deleteParagraph', paragraph: paragraphs[1]! }],
    });
    expect(refusal(last)).toBe('unsupported-capability');
    run(host, [{ op: 'deleteParagraph', paragraph: paragraphs[0]! }]);
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Inside last', 'Outside']);
  });

  test('the last paragraph of the story refuses', () => {
    const host = open(FOUR);
    const { body } = roots(host);
    const before = oracles(host);
    const paragraphs = paragraphsOf(host, body);
    const response = host.execute({
      operations: [TRACK, { op: 'deleteParagraph', paragraph: paragraphs[3]! }],
    });
    expect(refusal(response)).toBe('unsupported-capability');
    expect(oracles(host)).toEqual(before);
  });
});

/** A tracked paragraph deletion of `index` refuses with `code` and changes nothing. */
function expectRefused(bytes: Uint8Array, index: number, code: string) {
  const host = open(bytes);
  const { body } = roots(host);
  const before = oracles(host);
  const response = host.execute({
    operations: [TRACK, { op: 'deleteParagraph', paragraph: paragraphsOf(host, body)[index]! }],
  });
  expect(refusal(response)).toBe(code);
  expect(oracles(host)).toEqual(before);
}

const ins = (text: string) =>
  `<w:ins w:id="9" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:t>${text}</w:t></w:r></w:ins>`;

describe('marks a tracked deletion does not strike', () => {
  test('a paragraph mark that ends a section refuses, by paragraph and by range', () => {
    const bytes = docx(p('One') + pWithSection('Two') + p('Three'));
    expectRefused(bytes, 1, 'unsupported-capability');
    const host = open(bytes);
    const { body } = roots(host);
    const response = host.execute({
      operations: [TRACK, deleteBetween(paragraphsOf(host, body), [1, 1], [2, 1])],
    });
    expect(refusal(response)).toBe('unsupported-capability');
  });

  test('a paragraph with an inline content control refuses', () => {
    const control =
      '<w:p><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>Control</w:t></w:r></w:sdtContent></w:sdt></w:p>';
    expectRefused(docx(control + p('Next')), 0, 'unsupported-capability');
  });

  test('a paragraph where a field crosses the mark refuses, and a closed field deletes', () => {
    const run = (inner: string) => `<w:r>${inner}</w:r>`;
    const begin = run('<w:fldChar w:fldCharType="begin"/>');
    const code = run('<w:instrText xml:space="preserve"> QUOTE "x" </w:instrText>');
    const separate = run('<w:fldChar w:fldCharType="separate"/>');
    const end = run('<w:fldChar w:fldCharType="end"/>');
    const crossing =
      `<w:p>${run('<w:t>Head </w:t>')}${begin}${code}${separate}${run('<w:t>x</w:t>')}</w:p>` +
      `<w:p>${run('<w:t>tail</w:t>')}${end}</w:p>` +
      p('Last');
    expectRefused(docx(crossing), 0, 'unsupported-capability');
    expectRefused(docx(crossing), 1, 'unsupported-capability');

    const closed = `<w:p>${run('<w:t>Head </w:t>')}${begin}${code}${separate}${run('<w:t>x</w:t>')}${end}</w:p>`;
    const host = open(docx(closed + p('Last')));
    const { body } = roots(host);
    run2(host, body, 0);
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Last']);
    expect(savedMainXml(host)).not.toContain('fldChar');
  });

  test('a paragraph directly before a block content control refuses', () => {
    expectRefused(docx(p('One') + sdt(p('Inside')) + p('After')), 0, 'unsupported-capability');
  });

  test('a next paragraph that starts with another author pending insertion refuses', () => {
    const next = `<w:p>${ins('New ')}<w:r><w:t>Two</w:t></w:r></w:p>`;
    expectRefused(docx(p('One') + next + p('Three')), 0, 'unsupported-revision');
  });
});

describe('position markers between paragraphs', () => {
  const marked = docx(
    p('One') +
      '<w:bookmarkStart w:id="0" w:name="mark"/>' +
      p('Two') +
      '<w:bookmarkEnd w:id="0"/>' +
      p('Three')
  );

  test('do not stop a tracked paragraph deletion, and survive accept and reject', () => {
    for (const accept of [true, false]) {
      const host = open(marked);
      const { body } = roots(host);
      run2(host, body, 0);
      run2(host, body, 1);
      decide(host, body, accept);
      expect(paragraphTexts(host, body)).toEqual(accept ? ['Three'] : ['One', 'Two', 'Three']);
      const xml = savedMainXml(host);
      expect(xml).toContain('<w:bookmarkStart w:id="0" w:name="mark"/>');
      expect(xml).toContain('<w:bookmarkEnd w:id="0"/>');
      const again = reopen(host);
      expect(paragraphTexts(again.host, again.body)).toEqual(paragraphTexts(host, body));
    }
  });

  test('do not stop a tracked range deletion across the paragraphs', () => {
    const host = open(marked);
    const { body } = roots(host);
    run(host, [deleteBetween(paragraphsOf(host, body), [0, 1], [2, 1])]);
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Ohree']);
  });
});

function run2(host: AutomationHost, body: AutomationHandle, index: number) {
  run(host, [{ op: 'deleteParagraph', paragraph: paragraphsOf(host, body)[index]! }]);
}
