// A lock is enforced by the STORE, not by the widget.
//
// The proof that matters is a refusal from a path that never touches a surface: every keyboard
// gesture, every toolbar command and every automation call funnels into the same ops, so a lock
// checked in validation is a lock every caller meets. A lock checked in a React component is a
// lock a script walks straight past.

import { describe, expect, test } from 'bun:test';
import {
  bodyStoryRoot,
  contentControlsIn,
  readOoxmlPart,
  resolveContentControlLock,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { TreeDocOp, TreeOpRejection } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphs(part: OoxmlPart): readonly OoxmlNode[] {
  const body = bodyStoryRoot(part);
  return body ? storyParagraphs(body) : [];
}

function refusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  const result = applyTreeOp(part, op);
  return result.ok ? null : result.reason;
}

function locked(lock: string, inner = `<w:p><w:r><w:t>text</w:t></w:r></w:p>`): OoxmlPart {
  return parseDoc(
    `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="${lock}"/></w:sdtPr>` +
      `<w:sdtContent>${inner}</w:sdtContent></w:sdt>` +
      `<w:p><w:r><w:t>outside</w:t></w:r></w:p>`
  );
}

describe('ST_Lock is resolved for every value the schema declares', () => {
  test('contentLocked and sdtContentLocked refuse an edit inside the control', () => {
    for (const lock of ['contentLocked', 'sdtContentLocked']) {
      const part = locked(lock);
      const inside = paragraphs(part)[0]!;
      expect(
        refusal(part, { op: 'insertText', paragraphId: inside.id, offset: 0, text: 'x' })
      ).toBe('locked');
      expect(refusal(part, { op: 'deleteText', paragraphId: inside.id, start: 0, end: 1 })).toBe(
        'locked'
      );
      expect(
        refusal(part, {
          op: 'setRunProperties',
          paragraphId: inside.id,
          start: 0,
          end: 1,
          properties: [{ localName: 'b' }],
        })
      ).toBe('locked');
    }
  });

  test('sdtLocked leaves the content editable and refuses removal', () => {
    const part = locked('sdtLocked');
    const inside = paragraphs(part)[0]!;
    expect(refusal(part, { op: 'insertText', paragraphId: inside.id, offset: 0, text: 'x' })).toBe(
      null
    );
    expect(
      refusal(part, {
        op: 'removeContentControl',
        controlId: contentControlsIn(part.root)[0]!.node.id,
        keepContent: true,
      })
    ).toBe('locked');
  });

  test('contentLocked leaves the control removable', () => {
    const part = locked('contentLocked');
    expect(
      refusal(part, {
        op: 'removeContentControl',
        controlId: contentControlsIn(part.root)[0]!.node.id,
        keepContent: true,
      })
    ).toBe(null);
  });

  test('an explicit unlocked control is editable', () => {
    const part = locked('unlocked');
    const inside = paragraphs(part)[0]!;
    expect(refusal(part, { op: 'insertText', paragraphId: inside.id, offset: 0, text: 'x' })).toBe(
      null
    );
  });

  test('content outside the control is untouched by its lock', () => {
    const part = locked('sdtContentLocked');
    const outside = paragraphs(part)[1]!;
    expect(refusal(part, { op: 'insertText', paragraphId: outside.id, offset: 0, text: 'x' })).toBe(
      null
    );
  });
});

describe('nesting resolves conservatively', () => {
  test('an unlocked control inside a locked one is still locked', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:lock w:val="unlocked"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>inner</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt>`
    );
    const inside = paragraphs(part)[0]!;
    expect(refusal(part, { op: 'insertText', paragraphId: inside.id, offset: 0, text: 'x' })).toBe(
      'locked'
    );
  });

  test('the two halves of the lock combine rather than override', () => {
    expect(resolveContentControlLock(['sdtLocked', 'contentLocked'])).toBe('sdtContentLocked');
    expect(resolveContentControlLock(['unlocked', 'sdtLocked'])).toBe('sdtLocked');
    expect(resolveContentControlLock([])).toBe('unlocked');
  });

  test('removing an unlocked control whose ancestor forbids removal is refused', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:lock w:val="sdtLocked"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>inner</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt>`
    );
    const inner = contentControlsIn(part.root)[1]!.node.id;
    expect(refusal(part, { op: 'removeContentControl', controlId: inner, keepContent: true })).toBe(
      'locked'
    );
  });
});

describe('a refusal is atomic', () => {
  test('a block delete that would take a locked control with it is refused whole', () => {
    const part = parseDoc(
      `<w:tbl><w:tr><w:tc>` +
        `<w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>inside</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `</w:tc></w:tr></w:tbl>`
    );
    const inside = paragraphs(part)[0]!;
    const before = JSON.stringify(part.root);
    expect(refusal(part, { op: 'deleteBlock', blockId: inside.id })).toBe('locked');
    expect(JSON.stringify(part.root)).toBe(before);
  });

  test('a value write on a locked control is refused and changes nothing', () => {
    const part = locked('sdtContentLocked');
    const control = contentControlsIn(part.root)[0]!.node.id;
    const before = JSON.stringify(part.root);
    expect(
      refusal(part, {
        op: 'setContentControlValue',
        controlId: control,
        value: { kind: 'text', text: 'x' },
      })
    ).toBe('locked');
    expect(JSON.stringify(part.root)).toBe(before);
  });

  test('a locked control refuses a metadata write as well as a value one', () => {
    const part = locked('sdtContentLocked');
    const control = contentControlsIn(part.root)[0]!.node.id;
    expect(refusal(part, { op: 'setContentControlProperties', controlId: control, tag: 't' })).toBe(
      'locked'
    );
  });
});
