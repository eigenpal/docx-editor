// The section-break lane's pure parts, tested directly.
//
// `partDeclaresContentControlLocks` is the gate's fast-path exit: when it says false, a range
// skips both lock questions and never orders the selection — which is what keeps `can` from
// flushing pending input. A false POSITIVE costs that; a false NEGATIVE would skip a real
// refusal. Neither shows up in an end-to-end assertion about the answer, so it is pinned here.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { partDeclaresContentControlLocks } from '../surface-section-breaks.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const P = '<w:p><w:r><w:t>text</w:t></w:r></w:p>';
const sdt = (properties: string) =>
  `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>${P}</w:sdtContent></w:sdt>`;

describe('partDeclaresContentControlLocks', () => {
  test.each([
    ['a plain document', P],
    // Word writes this inside `v:shapetype` for every legacy picture. Matching `lock` on its
    // local name alone made one stray shape say true for the whole document.
    [
      'a VML o:lock',
      `${P}<w:p><w:r><w:pict><v:shapetype id="_x0000_t75">` +
        '<o:lock v:ext="edit" aspectratio="t"/></v:shapetype></w:pict></w:r></w:p>',
    ],
    // `sdtLocked` refuses REMOVAL of the wrapper and leaves the content editable, so it is
    // not a refusal a break can hit.
    ['an sdtLocked shell', sdt('<w:lock w:val="sdtLocked"/>')],
    ['an explicitly unlocked control', sdt('<w:lock w:val="unlocked"/>')],
    ['a control with no lock at all', sdt('<w:alias w:val="Field"/>')],
  ])('is false for %s', (_label, body) => {
    expect(partDeclaresContentControlLocks(load(body))).toBe(false);
  });

  test.each([
    ['contentLocked', sdt('<w:lock w:val="contentLocked"/>')],
    ['sdtContentLocked', sdt('<w:lock w:val="sdtContentLocked"/>')],
    ['a data binding', sdt('<w:dataBinding w:xpath="/root/a" w:storeItemID="{1}"/>')],
    [
      'a lock nested deep in the body',
      `${P}<w:tbl><w:tr><w:tc>${sdt('<w:lock w:val="contentLocked"/>')}</w:tc></w:tr></w:tbl>`,
    ],
  ])('is true for %s', (_label, body) => {
    expect(partDeclaresContentControlLocks(load(body))).toBe(true);
  });
});
