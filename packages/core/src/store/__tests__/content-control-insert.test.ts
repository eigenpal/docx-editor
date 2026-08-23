// Authoring a NEW content control: over a range, and at a caret.
//
// The caret shape is Word's own Developer-tab gesture, and it is the one a host reaches for
// when it inserts a template field where the user is looking. It authors an EMPTY control
// showing its type's prompt rather than wrapping characters the caller never named, so the
// first thing typed into it replaces the prompt whole.

import { describe, expect, test } from 'bun:test';
import {
  bodyStoryRoot,
  contentControlPropertiesOf,
  contentControlTextOf,
  contentControlsIn,
  readOoxmlPart,
  serializeOoxmlPart,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { isShowingPlaceholder } from '../store/tree-op-nodes.ts';
import type { TreeDocOp, TreeOpRejection } from '../store/tree-op-types.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${bodyInner}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphs(part: OoxmlPart): readonly OoxmlNode[] {
  const body = bodyStoryRoot(part);
  return body ? storyParagraphs(body) : [];
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.part;
}

function refusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  const result = applyTreeOp(part, op);
  return result.ok ? null : result.reason;
}

function insertedControl(part: OoxmlPart, tag: string): OoxmlNode {
  const found = contentControlsIn(part.root).find(
    (entry) => contentControlPropertiesOf(entry.node).tag === tag
  );
  if (!found) throw new Error(`no control tagged '${tag}'`);
  return found.node;
}

describe('insertContentControl at a caret', () => {
  const SENTENCE = parseDoc(`<w:p><w:r><w:t>Between and BUYER LTD</w:t></w:r></w:p>`);

  function insertAt(offset: number, type: 'plainText' | 'date' | 'dropDownList' = 'plainText') {
    return apply(SENTENCE, {
      op: 'insertContentControl',
      paragraphId: paragraphs(SENTENCE)[0]!.id,
      start: offset,
      end: offset,
      type,
      tag: 'party',
      alias: 'Party',
    });
  }

  test('authors an empty control holding its type prompt', () => {
    const next = insertAt(8);
    const control = insertedControl(next, 'party');
    expect(contentControlTextOf(control)).toBe('Click here to enter text.');
    expect(isShowingPlaceholder(control)).toBe(true);
    expect(contentControlPropertiesOf(control).alias).toBe('Party');
  });

  test('the prompt is the type own, so a date reads as a date field', () => {
    expect(contentControlTextOf(insertedControl(insertAt(8, 'date'), 'party'))).toBe(
      'Click here to enter a date.'
    );
    expect(contentControlTextOf(insertedControl(insertAt(8, 'dropDownList'), 'party'))).toBe(
      'Choose an item.'
    );
  });

  test('lands at the caret, between the characters that were there', () => {
    const next = insertAt(8);
    // The paragraph reads the prompt WHERE the caret was, and nothing else moved.
    expect(paragraphTextOf(next, paragraphs(next)[0]!.id)).toBe(
      'Between Click here to enter text.and BUYER LTD'
    );
  });

  test('inserts at either edge of the paragraph', () => {
    expect(paragraphTextOf(insertAt(0), paragraphs(SENTENCE)[0]!.id)).toBe(
      'Click here to enter text.Between and BUYER LTD'
    );
    const end = 'Between and BUYER LTD'.length;
    expect(paragraphTextOf(insertAt(end), paragraphs(SENTENCE)[0]!.id)).toBe(
      'Between and BUYER LTDClick here to enter text.'
    );
  });

  test('the prompt inherits the formatting at the caret', () => {
    const part = parseDoc(
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>` +
        `<w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r></w:p>`
    );
    // The run on the LEFT wins, the way typing inherits.
    const next = apply(part, {
      op: 'insertContentControl',
      paragraphId: paragraphs(part)[0]!.id,
      start: 4,
      end: 4,
      type: 'plainText',
      tag: 'field',
    });
    const xml = serializeOoxmlPart(next);
    const control = xml.slice(xml.indexOf('<w:sdt>'), xml.indexOf('</w:sdt>'));
    expect(control).toContain('<w:b/>');
    expect(control).not.toContain('<w:i/>');
  });

  test('typing into it replaces the prompt whole', () => {
    const inserted = insertAt(8);
    const paragraphId = paragraphs(inserted)[0]!.id;
    const typed = apply(inserted, { op: 'insertText', paragraphId, offset: 8, text: 'ACME' });
    const control = insertedControl(typed, 'party');
    expect(contentControlTextOf(control)).toBe('ACME');
    expect(isShowingPlaceholder(control)).toBe(false);
    expect(paragraphTextOf(typed, paragraphId)).toBe('Between ACMEand BUYER LTD');
  });

  test('writes the properties in schema order, so Word opens the file', () => {
    const xml = serializeOoxmlPart(insertAt(8));
    expect(xml.indexOf('w:alias')).toBeLessThan(xml.indexOf('w:tag'));
    expect(xml.indexOf('w:tag')).toBeLessThan(xml.indexOf('w:id'));
    expect(xml.indexOf('w:id')).toBeLessThan(xml.indexOf('w:showingPlcHdr'));
    expect(xml.indexOf('w:showingPlcHdr')).toBeLessThan(xml.indexOf('<w:text/>'));
  });

  test('a caret inside a content-locked control is refused', () => {
    const locked = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>fixed</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    expect(
      refusal(locked, {
        op: 'insertContentControl',
        paragraphId: paragraphs(locked)[0]!.id,
        start: 2,
        end: 2,
        type: 'plainText',
      })
    ).toBe('locked');
  });

  test('an inverted or out-of-range span is still refused', () => {
    const paragraphId = paragraphs(SENTENCE)[0]!.id;
    for (const span of [
      { start: 5, end: 2 },
      { start: -1, end: -1 },
      { start: 999, end: 999 },
    ]) {
      expect(
        refusal(SENTENCE, { op: 'insertContentControl', paragraphId, ...span, type: 'plainText' })
      ).toBe('invalid-range');
    }
  });
});
