// `setSectionMark`: the op behind Word's Layout > Breaks, at the tree level.
//
// `w:type` states how a section starts relative to the previous one (ECMA-376 §17.6.22),
// so the break a caller asks for is written on the section that FOLLOWS the mark, never on
// the clone the mark mints. These pin that down, and the markup it produces.

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.part;
}

const SIMPLE = '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>';

describe('setSectionMark writes the break on the section that STARTS at the mark', () => {
  const TWO_PARAGRAPHS =
    '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:cols w:num="1"/></w:sectPr>';

  test('continuous lands on the governing section, never on the minted clone', () => {
    // `w:type` says how a section starts relative to the previous one (§17.6.22). The
    // minted mark ENDS the first half, which starts exactly where it always did, so the
    // break the caller asked for belongs to the half that follows it.
    const part = load(TWO_PARAGRAPHS);
    const [first] = paragraphIds(part);
    const next = apply(part, {
      op: 'setSectionMark',
      paragraphId: first!,
      breakType: 'continuous',
    });
    const serialized = serializeOoxmlPart(next);
    expect(serialized.match(/<w:type w:val="continuous"\/>/g)).toHaveLength(1);
    // The one `w:type` is in the BODY-level section, after the last paragraph.
    expect(serialized.indexOf('<w:type')).toBeGreaterThan(serialized.lastIndexOf('</w:p>'));
    // …and it sits before `w:pgSz`, where CT_SectPr's sequence puts it.
    expect(serialized.indexOf('<w:type')).toBeLessThan(serialized.lastIndexOf('<w:pgSz'));
  });

  test('nextPage REMOVES an inherited type, so the break really starts a page', () => {
    // The clone carries the governing `w:type` with it. Without the removal the section
    // after a next-page break stayed continuous and both halves shared one sheet.
    const part = load(
      TWO_PARAGRAPHS.replace('<w:sectPr>', '<w:sectPr><w:type w:val="continuous"/>')
    );
    const [first] = paragraphIds(part);
    const next = apply(part, { op: 'setSectionMark', paragraphId: first!, breakType: 'nextPage' });
    const serialized = serializeOoxmlPart(next);
    // Exactly one survives: the clone's, which still describes where the FIRST half starts.
    expect(serialized.match(/<w:type w:val="continuous"\/>/g)).toHaveLength(1);
    expect(serialized.indexOf('<w:type')).toBeLessThan(serialized.indexOf('</w:p>'));
  });

  test('an omitted breakType leaves the following section exactly as it was', () => {
    const part = load(TWO_PARAGRAPHS.replace('<w:sectPr>', '<w:sectPr><w:type w:val="oddPage"/>'));
    const [first] = paragraphIds(part);
    const next = apply(part, { op: 'setSectionMark', paragraphId: first! });
    expect(serializeOoxmlPart(next).match(/<w:type w:val="oddPage"\/>/g)).toHaveLength(2);
  });

  test('a document with no sectPr gets a body-level one to carry the break', () => {
    // Otherwise "continuous" commits and changes nothing the user can see: there is no
    // following section to say how it starts.
    const part = load(SIMPLE);
    const [first] = paragraphIds(part);
    const next = apply(part, {
      op: 'setSectionMark',
      paragraphId: first!,
      breakType: 'continuous',
    });
    const serialized = serializeOoxmlPart(next);
    expect(serialized.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(serialized.match(/<w:type w:val="continuous"\/>/g)).toHaveLength(1);
    expect(serialized.indexOf('<w:type')).toBeGreaterThan(serialized.lastIndexOf('</w:p>'));
  });

  test('an unknown break type is refused before any tree work', () => {
    const part = load(TWO_PARAGRAPHS);
    const [first] = paragraphIds(part);
    const fingerprint = canonicalOoxmlFingerprint(part);
    const result = applyTreeOp(part, {
      op: 'setSectionMark',
      paragraphId: first!,
      breakType: 'sideways' as 'continuous',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-property-value');
    expect(canonicalOoxmlFingerprint(part)).toBe(fingerprint);
  });
});
