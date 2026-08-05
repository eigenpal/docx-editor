// Forms protection is the OTHER half of "the document says no".
//
// A control's own `w:lock` protects the control. `w:documentProtection w:edit="forms"` inverts
// the question for the whole document: nothing is editable EXCEPT what sits inside a control,
// so the same op that a lock refuses inside is refused outside. The two are resolved in one
// place because a caller only ever sees one refusal.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../index.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import type { TreeDocOp, TreeOpRejection } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(body: string, settingsInner: string): OoxmlPackage {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdSet" Type="${R}/settings" Target="settings.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settingsInner}</w:settings>`),
  });
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

/** Paragraph ids in document order, flattening the control wrapper. */
function paragraphIds(pkg: OoxmlPackage): string[] {
  const ids: string[] = [];
  const walk = (node: { kind: string; children: readonly never[]; id: string }): void => {
    if (node.kind === 'paragraph') {
      ids.push(node.id);
      return;
    }
    for (const child of node.children) walk(child);
  };
  const main = pkg.parts.get(pkg.mainDocumentPart)!;
  walk(main.root as never);
  return ids;
}

const BODY =
  `<w:sdt><w:sdtPr><w:tag w:val="field"/></w:sdtPr><w:sdtContent>` +
  `<w:p><w:r><w:t>inside</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
  `<w:p><w:r><w:t>outside</w:t></w:r></w:p>` +
  `<w:sectPr/>`;

const FORMS = '<w:documentProtection w:edit="forms" w:enforcement="1"/>';

function refusal(pkg: OoxmlPackage, op: TreeDocOp): TreeOpRejection | null {
  const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
  const result = store.transact((ctx) => {
    ctx.apply(op);
  });
  return result.ok ? null : result.reason;
}

describe('forms protection inverts what is editable', () => {
  test('content outside every control is refused', () => {
    const pkg = build(BODY, FORMS);
    const outside = paragraphIds(pkg)[1]!;
    expect(refusal(pkg, { op: 'insertText', paragraphId: outside, offset: 0, text: 'x' })).toBe(
      'locked'
    );
  });

  test('content inside an unlocked control is still editable', () => {
    const pkg = build(BODY, FORMS);
    const inside = paragraphIds(pkg)[0]!;
    expect(
      refusal(pkg, { op: 'insertText', paragraphId: inside, offset: 0, text: 'x' })
    ).toBeNull();
  });

  test('the control itself cannot be removed while forms protection holds', () => {
    const pkg = build(BODY, FORMS);
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const control = findControlId(main.root as never);
    expect(
      refusal(pkg, { op: 'removeContentControl', controlId: control, keepContent: true })
    ).toBe('locked');
  });

  test('enforcement="0" is a stored preference, not a protection', () => {
    const pkg = build(BODY, '<w:documentProtection w:edit="forms" w:enforcement="0"/>');
    const outside = paragraphIds(pkg)[1]!;
    expect(
      refusal(pkg, { op: 'insertText', paragraphId: outside, offset: 0, text: 'x' })
    ).toBeNull();
  });

  test('a protection mode that is not forms leaves the document editable', () => {
    const pkg = build(BODY, '<w:documentProtection w:edit="comments" w:enforcement="1"/>');
    const outside = paragraphIds(pkg)[1]!;
    expect(
      refusal(pkg, { op: 'insertText', paragraphId: outside, offset: 0, text: 'x' })
    ).toBeNull();
  });

  test('a section that turns form protection off is editable outside controls', () => {
    const pkg = build(
      `<w:p><w:r><w:t>outside</w:t></w:r></w:p>` +
        `<w:sectPr><w:formProt w:val="false"/></w:sectPr>`,
      FORMS
    );
    const outside = paragraphIds(pkg)[0]!;
    expect(
      refusal(pkg, { op: 'insertText', paragraphId: outside, offset: 0, text: 'x' })
    ).toBeNull();
  });
});

function findControlId(node: { kind: string; id: string; children: readonly never[] }): string {
  if (node.kind === 'contentControl') return node.id;
  for (const child of node.children) {
    const found = findControlId(child);
    if (found) return found;
  }
  return '';
}
