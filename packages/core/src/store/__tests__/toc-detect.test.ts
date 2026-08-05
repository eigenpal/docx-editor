import { describe, expect, test } from 'bun:test';
import { detectBodyTocs } from '../package/toc-detect.ts';
import { readOoxmlPart, type OoxmlPart } from '../package/index.ts';
import { applyTreeOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const TOC =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-2" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
  '<w:p><w:r><w:t>Old entry</w:t></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

describe('detectBodyTocs memoization', () => {
  test('reuses the cached result for the same part identity', () => {
    const part = load(TOC);
    const first = detectBodyTocs(part);
    const second = detectBodyTocs(part);
    expect(second).toBe(first);
  });

  test('recomputes for a structurally shared but new part identity', () => {
    const left = detectBodyTocs(load(TOC));
    const right = detectBodyTocs(load(TOC));
    expect(right).toEqual(left);
    expect(right).not.toBe(left);
  });

  test('matches uncached answers for real TOC and no-TOC fixtures', () => {
    const tocPart = load(TOC);
    const noTocPart = load('<w:p><w:r><w:t>Plain body</w:t></w:r></w:p>');

    const tocFirst = detectBodyTocs(tocPart);
    const tocSecond = detectBodyTocs(tocPart);
    expect(tocSecond).toEqual(tocFirst);
    expect(tocSecond).toBe(tocFirst);
    expect(tocFirst).toHaveLength(1);
    expect(tocFirst[0]!.instruction.raw).toContain('TOC');

    const noTocFirst = detectBodyTocs(noTocPart);
    const noTocSecond = detectBodyTocs(noTocPart);
    expect(noTocSecond).toEqual(noTocFirst);
    expect(noTocSecond).toBe(noTocFirst);
    expect(noTocFirst).toEqual([]);
  });

  test('recomputes after an edit replaces the part identity', () => {
    const part = load(TOC);
    const before = detectBodyTocs(part);
    const toc = before[0]!;
    const edited = applyTreeOp(part, {
      op: 'replaceTocResult',
      tocId: toc.id,
      entries: [
        {
          level: 0,
          text: 'Updated entry',
          headingParagraphId: 'heading-1',
          bookmarkName: '_Toc1',
          pageNumberText: '1',
        },
      ],
      bookmarksToCreate: [],
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const after = detectBodyTocs(edited.part);
    expect(after).not.toBe(before);
    expect(after).toHaveLength(1);
    expect(detectBodyTocs(edited.part)).toBe(after);
  });
});
