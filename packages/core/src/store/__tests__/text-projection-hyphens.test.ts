// Hyphen elements in read text (issue #1071).
//
// `w:noBreakHyphen` reads as U+001E and `w:softHyphen` as U+001F, at their model offsets.
// Model text is unchanged. Search matches a typed hyphen against a non-breaking hyphen and
// ignores an optional hyphen.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { projectVisibleParagraphText } from '../store/text-projection.ts';
import { projectParagraphText } from '../../automation/text-projection.ts';

const W = WML_NAMESPACE_URI;
const NBH = '\u001e';
const SHY = '\u001f';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(part: OoxmlPart): OoxmlParagraphNode {
  const find = (node: OoxmlNode): OoxmlParagraphNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'paragraph') return node as OoxmlParagraphNode;
    for (const child of node.children) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  return find(part.root)!;
}

function project(body: string) {
  const part = load(body);
  const paragraph = firstParagraph(part);
  const raw = paragraphTextOf(part, paragraph.id) ?? '';
  return { part, paragraph, raw, projected: projectVisibleParagraphText(paragraph, raw) };
}

const ISSUE =
  '<w:p><w:r><w:t xml:space="preserve">the then</w:t><w:noBreakHyphen/>' +
  '<w:t>applicable rate</w:t><w:softHyphen/><w:t>s</w:t></w:r></w:p>';

describe('hyphen elements in read text', () => {
  test('read text shows both hyphens; model text is unchanged', () => {
    const { raw, projected } = project(ISSUE);
    expect(raw).toBe('the thenapplicable rates');
    expect(projected.text).toBe(`the then${NBH}applicable rate${SHY}s`);
  });

  test('a range spanning a hyphen reads it; a range ending at it does not', () => {
    const { projected } = project(ISSUE);
    expect(projected.sliceRaw(4, 8)).toBe('then');
    expect(projected.sliceRaw(8, 18)).toBe('applicable');
    expect(projected.sliceRaw(4, 18)).toBe(`then${NBH}applicable`);
    expect(projected.sliceRaw(0, 24)).toBe(projected.text);
  });

  test('search matches a typed hyphen and ignores an optional hyphen', () => {
    const { projected } = project(ISSUE);
    const one = (query: string) => projected.findOccurrences(query, 10).matches;
    expect(one('then-applicable')).toMatchObject([
      { start: 4, length: 15, rawStart: 4, rawEnd: 18 },
    ]);
    expect(one(`then${NBH}applicable`)).toHaveLength(1);
    expect(one('thenapplicable')).toHaveLength(0);
    expect(one('rates')).toMatchObject([{ start: 20, length: 6, rawStart: 19, rawEnd: 24 }]);
    expect(one(`rate${SHY}s`)).toHaveLength(1);
    expect(one(SHY)).toHaveLength(0);
  });

  test('whole-word search treats a non-breaking hyphen as a word boundary', () => {
    const { projected } = project(ISSUE);
    expect(projected.findOccurrences('then', 10, { wholeWord: true }).matches).toHaveLength(1);
  });

  test('a hyphen in a pending insertion is absent from the original view', () => {
    const body =
      '<w:p><w:r><w:t>co</w:t></w:r><w:ins w:id="1" w:author="A"><w:r><w:noBreakHyphen/>' +
      '<w:t>signer</w:t></w:r></w:ins></w:p>';
    const part = load(body);
    const paragraph = firstParagraph(part);
    const raw = paragraphTextOf(part, paragraph.id) ?? '';
    expect(projectParagraphText(paragraph, raw, 'allMarkup').text).toBe(`co${NBH}signer`);
    expect(projectParagraphText(paragraph, raw, 'original').text).toBe('co');
    expect(projectParagraphText(paragraph, raw, 'model').text).toBe('cosigner');
  });

  test('a hyphen in a field result reads inside the result and maps to its run', () => {
    const body =
      '<w:p><w:fldSimple w:instr=" REF ref "><w:r><w:t>1</w:t><w:noBreakHyphen/>' +
      '<w:t>A</w:t></w:r></w:fldSimple><w:r><w:t> end</w:t></w:r></w:p>';
    const { projected } = project(body);
    expect(projected.text).toBe(`1${NBH}A end`);
    expect(projected.resultRunAddressAt(2)?.offset).toBe(1);
    expect(projected.resultRunAddressAt(0)?.offset).toBe(0);
  });

  test('a paragraph with no hyphen keeps the identity projection', () => {
    const { raw, projected } = project('<w:p><w:r><w:t>plain</w:t></w:r></w:p>');
    expect(projected.text).toBe(raw);
  });
});
