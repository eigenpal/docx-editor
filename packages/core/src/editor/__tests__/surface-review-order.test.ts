// The review order index survives edits that keep every paragraph, and only those.
//
// A list toggle writes its definition to the numbering part before its own commit, so the
// package revision moves twice. The index must still carry across it, because no paragraph
// moved. A header write beside it, or a split, must rebuild the index. The oracle is a fresh
// index over the same session.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { openTreeSession } from '../../binding/index.ts';
import { createReviewOrderIndex } from '../surface-review-order.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function docx(): Uint8Array {
  const type = (name: string) =>
    `application/vnd.openxmlformats-officedocument.wordprocessingml.${name}+xml`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${type('document.main')}"/>` +
        `<Override PartName="/word/header1.xml" ContentType="${type('header')}"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="${type('numbering')}"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdN" Type="${R}/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('Header')}</w:hdr>`),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
        '<w:numFmt w:val="bullet"/><w:lvlText w:val="-"/></w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${p('One')}${p('Two')}${p('Three')}` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr></w:body></w:document>'
    ),
  });
}

function setup() {
  const opened = openTreeSession(docx());
  if (!opened.ok) throw new Error(opened.reason);
  const session = opened.session;
  const order = createReviewOrderIndex(session);
  session.subscribe((change) => order.retain(change));
  const fresh = () => createReviewOrderIndex(session).index();
  return { session, order, fresh };
}

type Session = ReturnType<typeof setup>['session'];

function toggleList(session: Session, index: number): void {
  const numId = session.ensureListDefinition('bullet');
  const edit = session.applyTreeOps([
    { op: 'setListNumbering', paragraphId: session.paragraphIds()[index]!, numId },
  ]);
  expect(edit.committed).toBe(true);
}

describe('review order index across list edits', () => {
  test('a list toggle keeps the index it already built', () => {
    const { session, order, fresh } = setup();
    const before = order.index();
    toggleList(session, 1);
    expect(order.index()).toBe(before);
    expect(order.index()).toEqual(fresh());
  });

  test('a header split beside a list toggle rebuilds the index', () => {
    const { session, order, fresh } = setup();
    const before = order.index();
    const scope = { kind: 'headerFooter', rId: 'rIdH' } as const;
    session.applyTreeOps(
      [{ op: 'splitParagraph', paragraphId: session.paragraphIdsIn(scope)[0]!, offset: 2 }],
      undefined,
      undefined,
      scope
    );
    toggleList(session, 1);
    const after = order.index();
    expect(after).not.toBe(before);
    expect(after).toEqual(fresh());
  });

  test('a split rebuilds the index', () => {
    const { session, order, fresh } = setup();
    const before = order.index();
    session.applyTreeOps([
      { op: 'splitParagraph', paragraphId: session.paragraphIds()[0]!, offset: 1 },
    ]);
    const after = order.index();
    expect(after).not.toBe(before);
    expect(after).toEqual(fresh());
  });
});
