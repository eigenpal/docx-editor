// Hyphen elements in paragraph text (issue #1071).
//
// `w:noBreakHyphen` is one character, U+001E, and `w:softHyphen` is U+001F, at their own
// model offsets. Search matches a typed hyphen against a non-breaking hyphen and ignores an
// optional hyphen.

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

describe('hyphen elements in paragraph text', () => {
  test('each hyphen is one character of model text', () => {
    const { raw, projected } = project(ISSUE);
    expect(raw).toBe(`the then${NBH}applicable rate${SHY}s`);
    expect(projected.text).toBe(raw);
  });

  test('search matches a typed hyphen and ignores an optional hyphen', () => {
    const { projected } = project(ISSUE);
    const found = (query: string) => projected.findOccurrences(query, 10).matches;
    expect(found('then-applicable')).toMatchObject([
      { start: 4, length: 15, rawStart: 4, rawEnd: 19 },
    ]);
    expect(found(`then${NBH}applicable`)).toHaveLength(1);
    expect(found('thenapplicable')).toHaveLength(0);
    expect(found('-')).toMatchObject([{ start: 8, length: 1, rawStart: 8, rawEnd: 9 }]);
    expect(found('rates')).toMatchObject([{ start: 20, length: 6, rawStart: 20, rawEnd: 26 }]);
    expect(found(`rate${SHY}s`)).toHaveLength(1);
    expect(found(SHY)).toHaveLength(0);
  });

  test('whole-word search joins a word across an optional hyphen', () => {
    const { projected } = project(ISSUE);
    const whole = (query: string) =>
      projected.findOccurrences(query, 10, { wholeWord: true }).matches;
    expect(whole('then')).toHaveLength(1);
    expect(whole('rate')).toHaveLength(0);
    expect(whole('rates')).toHaveLength(1);
  });

  test('a hyphen in a pending insertion is absent from the original view', () => {
    const body =
      '<w:p><w:r><w:t>co</w:t></w:r><w:ins w:id="1" w:author="A"><w:r><w:noBreakHyphen/>' +
      '<w:t>signer</w:t></w:r></w:ins></w:p>';
    const part = load(body);
    const paragraph = firstParagraph(part);
    const raw = paragraphTextOf(part, paragraph.id) ?? '';
    expect(raw).toBe(`co${NBH}signer`);
    expect(projectParagraphText(paragraph, raw, 'allMarkup').text).toBe(`co${NBH}signer`);
    expect(projectParagraphText(paragraph, raw, 'original').text).toBe('co');
  });

  test('a hyphen in a field result reads inside the result', () => {
    const body =
      '<w:p><w:fldSimple w:instr=" REF ref "><w:r><w:t>1</w:t><w:noBreakHyphen/>' +
      '<w:t>A</w:t></w:r></w:fldSimple><w:r><w:t> end</w:t></w:r></w:p>';
    const { projected } = project(body);
    expect(projected.text).toBe(`1${NBH}A end`);
    expect(projected.resultRunAddressAt(2)?.offset).toBe(2);
  });

  test('a hyphen in a text box is not the anchoring paragraph text', () => {
    const body =
      '<w:p><w:r><w:t>Cover</w:t></w:r><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"/></w:drawing></w:r></w:p>';
    const { raw } = project(body);
    expect(raw.startsWith('Cover')).toBe(true);
    expect(raw).not.toContain(NBH);
  });
});
