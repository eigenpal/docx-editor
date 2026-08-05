// An inline control's lock, and the ops that address its characters by offset.
//
// A BLOCK CONTROL IS AN ANCESTOR OF WHAT IT PROTECTS; AN INLINE ONE IS A DESCENDANT. A lock
// resolved by walking a paragraph's ancestors therefore answers "unlocked" for every inline
// control in the document — the paragraph is outside the control, so nothing about the paragraph
// is locked — while the characters the op names sit inside it. The offsets are the only place the
// two meet, so the lock has to be resolved against the RANGE an op addresses and not only against
// the node it names.

import { describe, expect, test } from 'bun:test';
import {
  contentControlTextOf,
  contentControlsIn,
  paragraphOffsetIndex,
  readOoxmlPart,
  storyParagraphs,
  bodyStoryRoot,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlParagraphNode,
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

function firstParagraph(part: OoxmlPart): OoxmlParagraphNode {
  const body = bodyStoryRoot(part);
  const found = body ? storyParagraphs(body)[0] : undefined;
  if (!found || found.kind !== 'paragraph') throw new Error('no paragraph');
  return found;
}

function refusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  const result = applyTreeOp(part, op);
  return result.ok ? null : result.reason;
}

function applied(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.part;
}

/** The characters the one control encloses — where an edge insertion actually went. */
function controlTextOf(part: OoxmlPart): string {
  const control = contentControlsIn(part.root)[0];
  if (!control) throw new Error('no control');
  return contentControlTextOf(control.node);
}

function textOf(part: OoxmlPart): string {
  const collect = (node: OoxmlNode): string => {
    if (node.kind === 'textValue') return node.value;
    return node.children.map(collect).join('');
  };
  return collect(part.root);
}

/** `before` + a locked inline control holding `held` + `after`, all in one paragraph. */
function inlineLocked(lock: string, before = 'a', held = 'LOCKED', after = 'z'): OoxmlPart {
  return parseDoc(
    `<w:p><w:r><w:t>${before}</w:t></w:r>` +
      `<w:sdt><w:sdtPr><w:tag w:val="field"/><w:lock w:val="${lock}"/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>${held}</w:t></w:r></w:sdtContent></w:sdt>` +
      `<w:r><w:t>${after}</w:t></w:r></w:p>`
  );
}

/** Where the one inline control's characters are, in the paragraph's own offsets. */
function controlSpan(part: OoxmlPart): { readonly start: number; readonly end: number } {
  const control = contentControlsIn(part.root)[0];
  if (!control) throw new Error('no control');
  const span = paragraphOffsetIndex(firstParagraph(part)).spanOf(control.node);
  if (!span) throw new Error('the control has no span');
  return span;
}

describe('an inline control refuses the ops that address its characters', () => {
  test('an insertion inside the control is refused', () => {
    const part = inlineLocked('sdtContentLocked');
    const paragraph = firstParagraph(part);
    expect(
      refusal(part, { op: 'insertText', paragraphId: paragraph.id, offset: 3, text: 'x' })
    ).toBe('locked');
  });

  test('a deletion inside the control is refused', () => {
    const part = inlineLocked('sdtContentLocked');
    const paragraph = firstParagraph(part);
    expect(refusal(part, { op: 'deleteText', paragraphId: paragraph.id, start: 2, end: 4 })).toBe(
      'locked'
    );
  });

  test('formatting the characters inside the control is refused', () => {
    const part = inlineLocked('sdtContentLocked');
    const paragraph = firstParagraph(part);
    expect(
      refusal(part, {
        op: 'setRunProperties',
        paragraphId: paragraph.id,
        start: 1,
        end: 7,
        properties: [{ localName: 'b', namespaceUri: W, attributes: [] }],
      })
    ).toBe('locked');
  });

  test('contentLocked refuses the same three, because it is the content half', () => {
    const paragraph = (part: OoxmlPart) => firstParagraph(part).id;
    const insert = inlineLocked('contentLocked');
    const remove = inlineLocked('contentLocked');
    const format = inlineLocked('contentLocked');
    expect(
      refusal(insert, { op: 'insertText', paragraphId: paragraph(insert), offset: 3, text: 'x' })
    ).toBe('locked');
    expect(
      refusal(remove, { op: 'deleteText', paragraphId: paragraph(remove), start: 2, end: 4 })
    ).toBe('locked');
    expect(
      refusal(format, {
        op: 'setRunProperties',
        paragraphId: paragraph(format),
        start: 2,
        end: 4,
        properties: [{ localName: 'i', namespaceUri: W, attributes: [] }],
      })
    ).toBe('locked');
  });

  // `sdtLocked` protects the control, not its characters — the same asymmetry the block case
  // already pins. An inline control must not be stricter than a block one about the same lock.
  test('sdtLocked leaves the characters inside it editable', () => {
    const part = inlineLocked('sdtLocked');
    const paragraph = firstParagraph(part);
    expect(
      refusal(part, { op: 'insertText', paragraphId: paragraph.id, offset: 3, text: 'x' })
    ).toBeNull();
  });

  test('an explicitly unlocked inline control is editable', () => {
    const part = inlineLocked('unlocked');
    const paragraph = firstParagraph(part);
    expect(
      refusal(part, { op: 'insertText', paragraphId: paragraph.id, offset: 3, text: 'x' })
    ).toBeNull();
  });
});

describe('the boundary is where the refusal starts and stops', () => {
  test('an edit entirely before the control is allowed', () => {
    const part = inlineLocked('sdtContentLocked', 'abc');
    const paragraph = firstParagraph(part);
    // 'abc' occupies [0,3); the control starts at 3.
    expect(
      refusal(part, { op: 'deleteText', paragraphId: paragraph.id, start: 0, end: 3 })
    ).toBeNull();
  });

  test('an edit entirely after the control is allowed', () => {
    const part = inlineLocked('sdtContentLocked', 'a', 'LOCKED', 'xyz');
    const paragraph = firstParagraph(part);
    const span = controlSpan(part);
    expect(
      refusal(part, {
        op: 'deleteText',
        paragraphId: paragraph.id,
        start: span.end,
        end: span.end + 3,
      })
    ).toBeNull();
  });

  test('a deletion crossing into the control is refused whole, not clipped', () => {
    const part = inlineLocked('sdtContentLocked', 'abc');
    const paragraph = firstParagraph(part);
    const before = textOf(part);
    // Starts in ordinary text and ends inside the control.
    expect(refusal(part, { op: 'deleteText', paragraphId: paragraph.id, start: 1, end: 5 })).toBe(
      'locked'
    );
    expect(textOf(part)).toBe(before);
  });

  test('a deletion crossing out of the control is refused too', () => {
    const part = inlineLocked('sdtContentLocked', 'abc', 'LOCKED', 'xyz');
    const paragraph = firstParagraph(part);
    const span = controlSpan(part);
    expect(
      refusal(part, {
        op: 'deleteText',
        paragraphId: paragraph.id,
        start: span.end - 2,
        end: span.end + 2,
      })
    ).toBe('locked');
  });

  test('a deletion spanning the whole control from outside on both sides is refused', () => {
    const part = inlineLocked('sdtContentLocked', 'abc', 'LOCKED', 'xyz');
    const paragraph = firstParagraph(part);
    expect(refusal(part, { op: 'deleteText', paragraphId: paragraph.id, start: 0, end: 12 })).toBe(
      'locked'
    );
  });

  // THE TWO EDGES ARE NOT THE SAME PLACE. The applier owns a boundary offset by the run that
  // STARTS there, so content inserted at the leading edge lands in the control's first run and
  // content inserted at the trailing edge lands in whatever follows the control. Validation has
  // to say the same thing, or a locked field can be typed into from the front — the refusal
  // would be looking at a rule the write does not follow.
  describe('the leading edge belongs to the control and the trailing edge does not', () => {
    test('unlocked: text typed at the leading edge lands inside', () => {
      const part = inlineLocked('unlocked', 'abc', 'MID', 'xyz');
      const span = controlSpan(part);
      const written = applied(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: span.start,
        text: '#',
      });
      expect(controlTextOf(written)).toBe('#MID');
    });

    test('unlocked: text typed at the trailing edge lands outside', () => {
      const part = inlineLocked('unlocked', 'abc', 'MID', 'xyz');
      const span = controlSpan(part);
      const written = applied(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: span.end,
        text: '#',
      });
      expect(controlTextOf(written)).toBe('MID');
      expect(textOf(written)).toContain('MID#xyz');
    });

    test('locked: the leading edge is refused, because that is where the text would go', () => {
      const part = inlineLocked('sdtContentLocked', 'abc');
      const span = controlSpan(part);
      expect(
        refusal(part, {
          op: 'insertText',
          paragraphId: firstParagraph(part).id,
          offset: span.start,
          text: '#',
        })
      ).toBe('locked');
    });

    test('locked: the trailing edge is allowed, and the control is unchanged', () => {
      const part = inlineLocked('sdtContentLocked', 'abc', 'MID', 'xyz');
      const span = controlSpan(part);
      const written = applied(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: span.end,
        text: '#',
      });
      expect(controlTextOf(written)).toBe('MID');
    });

    // Every op that writes content at an offset lands in the same place, so every one of them
    // meets the same edge rule.
    test('a tab, a line break and a page break are refused at the leading edge too', () => {
      const span = controlSpan(inlineLocked('sdtContentLocked', 'abc'));
      for (const build of [
        (paragraphId: string): TreeDocOp => ({ op: 'insertTab', paragraphId, offset: span.start }),
        (paragraphId: string): TreeDocOp => ({
          op: 'insertHardBreak',
          paragraphId,
          offset: span.start,
        }),
        (paragraphId: string): TreeDocOp => ({
          op: 'insertPageBreak',
          paragraphId,
          offset: span.start,
        }),
      ]) {
        const part = inlineLocked('sdtContentLocked', 'abc');
        expect(refusal(part, build(firstParagraph(part).id))).toBe('locked');
      }
    });

    // The other side of the rule: an op that writes NOTHING into the control at that offset must
    // not be refused for standing next to it. A comment marker and a paragraph split both leave
    // the control's content exactly as it was, at either edge.
    test('a comment marker and a split at the leading edge are allowed', () => {
      const marked = inlineLocked('sdtContentLocked', 'abc');
      const split = inlineLocked('sdtContentLocked', 'abc');
      const span = controlSpan(marked);
      expect(
        refusal(marked, {
          op: 'insertCommentMarker',
          paragraphId: firstParagraph(marked).id,
          offset: span.start,
          commentId: '1',
          marker: 'start',
        })
      ).toBeNull();
      expect(
        refusal(split, {
          op: 'splitParagraph',
          paragraphId: firstParagraph(split).id,
          offset: span.start,
        })
      ).toBeNull();
    });

    test('a nested control’s leading edge is the outer control’s too', () => {
      const part = parseDoc(
        `<w:p><w:r><w:t>a</w:t></w:r>` +
          `<w:sdt><w:sdtPr><w:tag w:val="outer"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
          `<w:sdtContent><w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr>` +
          `<w:sdtContent><w:r><w:t>deep</w:t></w:r></w:sdtContent></w:sdt></w:sdtContent></w:sdt>` +
          `<w:r><w:t>z</w:t></w:r></w:p>`
      );
      // Both controls start at offset 1, so the leading edge is inside both of them.
      expect(
        refusal(part, {
          op: 'insertText',
          paragraphId: firstParagraph(part).id,
          offset: 1,
          text: '#',
        })
      ).toBe('locked');
    });
  });

  // An empty range was already refused as a range before any lock was consulted, and it stays
  // that way: the lock must not be the thing that answers, or the reason a caller reads for a
  // malformed op would depend on whether some control happened to be nearby.
  test('a zero-width deletion is refused as a range, not as a lock', () => {
    const part = inlineLocked('sdtContentLocked', 'abc');
    const span = controlSpan(part);
    expect(
      refusal(part, {
        op: 'deleteText',
        paragraphId: firstParagraph(part).id,
        start: span.start,
        end: span.start,
      })
    ).toBe('invalid-range');
  });
});

describe('nesting and siblings resolve the same way inline as they do for blocks', () => {
  test('an unlocked inline control inside a locked one is still locked', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>a</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="outer"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:sdt><w:sdtPr><w:tag w:val="inner"/><w:lock w:val="unlocked"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>deep</w:t></w:r></w:sdtContent></w:sdt></w:sdtContent></w:sdt>` +
        `<w:r><w:t>z</w:t></w:r></w:p>`
    );
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 3,
        text: 'x',
      })
    ).toBe('locked');
  });

  test('one locked control does not lock its unlocked sibling', () => {
    const part = parseDoc(
      `<w:p>` +
        `<w:sdt><w:sdtPr><w:tag w:val="one"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>AAA</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:sdt><w:sdtPr><w:tag w:val="two"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>BBB</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:p>`
    );
    const paragraph = firstParagraph(part).id;
    // 'AAA' is [0,3) inside the locked one; 'BBB' is [3,6) inside the unlocked one.
    expect(refusal(part, { op: 'insertText', paragraphId: paragraph, offset: 1, text: 'x' })).toBe(
      'locked'
    );
    expect(
      refusal(part, { op: 'insertText', paragraphId: paragraph, offset: 4, text: 'x' })
    ).toBeNull();
  });

  test('a block control holding a paragraph that holds a locked inline control', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="block"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>a</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inline"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>LOCKED</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:p></w:sdtContent></w:sdt>`
    );
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 3,
        text: 'x',
      })
    ).toBe('locked');
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 0,
        text: 'x',
      })
    ).toBeNull();
  });
});

describe('the paragraph an inline control sits in is still structural', () => {
  test('splitting the paragraph inside a locked control is refused', () => {
    const part = inlineLocked('sdtContentLocked', 'abc');
    expect(
      refusal(part, { op: 'splitParagraph', paragraphId: firstParagraph(part).id, offset: 5 })
    ).toBe('locked');
  });

  test('deleting the paragraph that holds a locked inline control is refused', () => {
    const part = inlineLocked('sdtContentLocked');
    expect(refusal(part, { op: 'deleteBlock', blockId: firstParagraph(part).id })).toBe('locked');
  });

  test('joining two paragraphs is refused when either holds locked content', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>first</w:t></w:r></w:p>` +
        `<w:p><w:sdt><w:sdtPr><w:tag w:val="f"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>LOCKED</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const body = bodyStoryRoot(part);
    const found = body ? storyParagraphs(body) : [];
    expect(
      refusal(part, {
        op: 'joinParagraphs',
        firstId: found[0]!.id,
        secondId: found[1]!.id,
      })
    ).toBe('locked');
  });
});
