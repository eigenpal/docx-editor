// Typing and deleting in SUGGESTING mode: the markup an edit becomes.
//
// Asserted against serialized XML rather than tree shape, because the whole point of a
// tracked edit is what another editor reads back. Word's own merge rules are pinned here too
// — extending your own insertion, and removing it rather than striking it — since those are
// the cases where a naive implementation still produces valid XML that says the wrong thing.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { TreeDocOp } from '../store/tree-op-validate.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ADA = { author: 'Ada Lovelace', date: '2026-01-02T03:04:05Z' };

function part(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!read.ok) throw new Error(`fixture did not parse: ${read.reason}`);
  return read.part;
}

/** The only paragraph in the fixture. */
function paragraphId(source: OoxmlPart): string {
  const body = source.root.children.find((child) => child.kind !== 'textValue');
  const found = body && body.kind !== 'textValue' ? body.children[0] : undefined;
  if (!found) throw new Error('no paragraph');
  return found.id;
}

function apply(source: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(source, op);
  if (!result.ok) throw new Error(`op refused: ${result.reason} ${result.detail ?? ''}`);
  return result.part;
}

/** Serialized, with the noise a diff does not care about collapsed. */
function xml(source: OoxmlPart): string {
  return serializeOoxmlPart(source).replace(/^<\?xml[^>]*\?>/, '');
}

describe('a tracked insertion', () => {
  test('splits the run and lands between the halves as w:ins', () => {
    const before = part('<w:p><w:r><w:t>alphaomega</w:t></w:r></w:p>');
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 5,
      text: 'BETA',
      revision: ADA,
    });
    const out = xml(after);
    expect(out).toContain('<w:t>alpha</w:t>');
    expect(out).toContain('<w:t>omega</w:t>');
    expect(out).toMatch(/<w:ins[^>]*w:author="Ada Lovelace"[^>]*>/);
    expect(out).toMatch(/<w:ins[^>]*><w:r><w:t>BETA<\/w:t><\/w:r><\/w:ins>/);
    // Order matters: the proposal has to read in the right place.
    expect(out.indexOf('alpha')).toBeLessThan(out.indexOf('BETA'));
    expect(out.indexOf('BETA')).toBeLessThan(out.indexOf('omega'));
  });

  test('keeps the run properties on both halves and on the new text', () => {
    const before = part('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>alphaomega</w:t></w:r></w:p>');
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 5,
      text: 'X',
      revision: ADA,
    });
    // Three runs now, and all three still bold: a suggestion that lost the formatting of the
    // text it sits in would be a formatting change nobody asked for.
    expect(xml(after).match(/<w:b\/>/g)?.length).toBe(3);
  });

  test('at a run boundary it needs no split at all', () => {
    const before = part('<w:p><w:r><w:t>tail</w:t></w:r></w:p>');
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 0,
      text: 'head',
      revision: ADA,
    });
    expect(xml(after)).toMatch(/<w:ins[^>]*><w:r><w:t>head<\/w:t><\/w:r><\/w:ins><w:r><w:t>tail/);
  });

  test('an empty paragraph gets the insertion and nothing else', () => {
    const before = part('<w:p/>');
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 0,
      text: 'first',
      revision: ADA,
    });
    expect(xml(after)).toMatch(/<w:p><w:ins[^>]*><w:r><w:t>first<\/w:t><\/w:r><\/w:ins><\/w:p>/);
  });

  test('an empty paragraph WITH properties keeps w:pPr first', () => {
    // §17.3.1.26 puts `w:pPr` first, and the paragraph invariant enforces it — so an
    // insertion placed before it took the whole transaction down. Every keystroke in an
    // empty paragraph that carries properties was refused: the list item Enter has just
    // opened, a styled blank line, an indented one. Suggesting mode looked dead from the
    // moment the caret landed in a new paragraph.
    const before = part(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>'
    );
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 0,
      text: 'first',
      revision: ADA,
    });
    const out = xml(after);
    expect(out.indexOf('<w:pPr>')).toBeLessThan(out.indexOf('<w:ins'));
    expect(out).toMatch(/<\/w:pPr><w:ins[^>]*><w:r><w:t>first<\/w:t><\/w:r><\/w:ins><\/w:p>/);
  });

  test('and so does the head of a paragraph that HAS runs', () => {
    // Offset 0 is the properties' offset too, so this is the same refusal without an empty
    // paragraph anywhere near it: Home and type, in any indented, aligned or numbered
    // paragraph.
    const before = part(
      '<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t>tail</w:t></w:r></w:p>'
    );
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 0,
      text: 'head',
      revision: ADA,
    });
    expect(xml(after)).toMatch(
      /<\/w:pPr><w:ins[^>]*><w:r><w:t>head<\/w:t><\/w:r><\/w:ins><w:r><w:t>tail/
    );
  });

  test('typing inside your OWN insertion extends it instead of nesting a second', () => {
    const before = part(
      `<w:p><w:ins w:id="1" w:author="Ada Lovelace"><w:r><w:t>abcd</w:t></w:r></w:ins></w:p>`
    );
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 2,
      text: 'XY',
      revision: ADA,
    });
    const out = xml(after);
    // One `w:ins`, not two. A nested pair would claim two people proposed these words.
    expect(out.match(/<w:ins\b/g)?.length).toBe(1);
    expect(out).toContain('ab');
    expect(out).toContain('XY');
    expect(out).toContain('cd');
  });

  test('typing on at the END of your own insertion extends it, one continuous proposal', () => {
    const before = part(
      `<w:p><w:ins w:id="1" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        `<w:r><w:t>ab</w:t></w:r></w:ins><w:r><w:t>rest</w:t></w:r></w:p>`
    );
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 2,
      text: 'c',
      revision: ADA,
    });
    const out = xml(after);
    // Without this, every keystroke opened a new revision and a typed word arrived in the
    // review pane as a column of one-letter cards.
    expect(out.match(/<w:ins\b/g)?.length).toBe(1);
    expect(out).toContain('abc');
    expect(out).toContain('<w:t>rest</w:t>');
  });

  test("another author's insertion nests, because it is a second proposal", () => {
    const before = part(
      `<w:p><w:ins w:id="1" w:author="Alan Turing"><w:r><w:t>abcd</w:t></w:r></w:ins></w:p>`
    );
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 2,
      text: 'XY',
      revision: ADA,
    });
    const out = xml(after);
    expect(out.match(/<w:ins\b/g)?.length).toBe(2);
    expect(out).toMatch(/w:author="Ada Lovelace"/);
    expect(out).toMatch(/w:author="Alan Turing"/);
  });
});

describe('a replacement', () => {
  test('the halves share one revision identity and read in Word order', () => {
    // Typing over a selection: the delete lands first, then the insert, in one transaction.
    let current = part('<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>');
    const id = paragraphId(current);
    current = apply(current, {
      op: 'deleteText',
      paragraphId: id,
      start: 0,
      end: 5,
      revision: ADA,
    });
    current = apply(current, {
      op: 'insertText',
      paragraphId: id,
      offset: 0,
      text: 'omega',
      // The same instant, because it is the same edit — the surface stamps one timestamp per
      // transaction. A month apart would NOT join, and must not: see the next test.
      revision: ADA,
    });
    const out = xml(current);
    // Struck text first, then what takes its place — Word's arrangement, and the order that
    // reads as a sentence. Before it, the replacement would read "omega alpha".
    expect(out).toMatch(
      /<w:del[^>]*><w:r><w:delText>alpha<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>omega<\/w:t><\/w:r><\/w:ins>/
    );
    // ONE identity across both halves: the insert adopted the deletion's id AND its date,
    // which is what makes accept/reject resolve the pair together.
    const ids = [...out.matchAll(/<w:(?:ins|del)[^>]*w:id="(\d+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(1);
    const dates = [...out.matchAll(/<w:(?:ins|del)[^>]*w:date="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(dates).size).toBe(1);
  });

  test("an OLD deletion by the same author is not absorbed into today's edit", () => {
    const before = part(
      `<w:p><w:del w:id="5" w:author="Ada Lovelace" w:date="2020-01-01T00:00:00Z">` +
        `<w:r><w:delText>old</w:delText></w:r></w:del><w:r><w:t>new</w:t></w:r></w:p>`
    );
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 3,
      end: 6,
      revision: ADA,
    });
    const out = xml(after);
    // Two decisions. Joining them would backdate today's edit into a revision from 2020 and
    // make rejecting one reject the other.
    expect(out.match(/<w:del\b/g)?.length).toBe(2);
    expect(out).toContain('w:date="2020-01-01T00:00:00Z"');
    expect(out).toContain(`w:date="${ADA.date}"`);
  });
});

describe('a tracked paragraph mark', () => {
  test('a split proposes the FIRST paragraph mark, per §17.13.5', () => {
    const before = part('<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>');
    const id = paragraphId(before);
    const split = apply(before, { op: 'splitParagraph', paragraphId: id, offset: 5 });
    const after = apply(split, {
      op: 'setParagraphMarkRevision',
      paragraphId: id,
      kind: 'ins',
      revision: ADA,
    });
    const out = xml(after);
    // The mark rides `w:pPr/w:rPr`, first among its siblings, on the paragraph BEFORE the
    // break — that mark is the one the split introduced.
    expect(out).toMatch(
      /<w:p><w:pPr><w:rPr><w:ins[^>]*w:author="Ada Lovelace"[^>]*\/><\/w:rPr><\/w:pPr><w:r><w:t>alpha<\/w:t>/
    );
    // No run, no text: the pilcrow is what changed.
    expect(out).not.toContain('<w:delText>');
  });

  test('a proposed merge keeps BOTH paragraphs and marks the first', () => {
    const before = part(
      '<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>second</w:t></w:r></w:p>'
    );
    const after = apply(before, {
      op: 'setParagraphMarkRevision',
      paragraphId: paragraphId(before),
      kind: 'del',
      revision: ADA,
    });
    const out = xml(after);
    expect(out.match(/<w:p[ >]/g)?.length).toBe(2);
    expect(out).toMatch(/<w:pPr><w:rPr><w:del[^>]*\/><\/w:rPr><\/w:pPr>/);
  });

  test('an existing pPr survives, with w:rPr in its schema position', () => {
    const before = part(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>text</w:t></w:r></w:p>'
    );
    const after = apply(before, {
      op: 'setParagraphMarkRevision',
      paragraphId: paragraphId(before),
      kind: 'ins',
      revision: ADA,
    });
    // `CT_PPr` puts `w:rPr` AFTER the base properties — only `w:sectPr` and `w:pPrChange`
    // may follow it — so the alignment stays in front.
    expect(xml(after)).toMatch(
      /<w:pPr><w:jc w:val="center"\/><w:rPr><w:ins[^>]*\/><\/w:rPr><\/w:pPr>/
    );
  });

  test('marking the same paragraph twice is one decision, not two', () => {
    const before = part('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
    const id = paragraphId(before);
    const once = apply(before, {
      op: 'setParagraphMarkRevision',
      paragraphId: id,
      kind: 'ins',
      revision: ADA,
    });
    const twice = apply(once, {
      op: 'setParagraphMarkRevision',
      paragraphId: id,
      kind: 'ins',
      revision: ADA,
    });
    expect(xml(twice).match(/<w:ins\b/g)?.length).toBe(1);
  });
});

describe('a tracked deletion', () => {
  test('keeps the words and re-labels them as w:delText inside w:del', () => {
    const before = part('<w:p><w:r><w:t>keep GONE keep</w:t></w:r></w:p>');
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 5,
      end: 9,
      revision: ADA,
    });
    const out = xml(after);
    expect(out).toMatch(/<w:del[^>]*w:author="Ada Lovelace"/);
    expect(out).toContain('<w:delText>GONE</w:delText>');
    // The struck words are still in the file — that is the difference from a real delete.
    expect(out).toContain('keep ');
    expect(out).toContain(' keep');
    expect(out).not.toContain('<w:t>GONE</w:t>');
  });

  test('a whole run is struck without leaving an empty one behind', () => {
    const before = part('<w:p><w:r><w:t>gone</w:t></w:r><w:r><w:t>stays</w:t></w:r></w:p>');
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 0,
      end: 4,
      revision: ADA,
    });
    const out = xml(after);
    expect(out).toContain('<w:delText>gone</w:delText>');
    expect(out).toContain('<w:t>stays</w:t>');
    expect(out).not.toMatch(/<w:r><\/w:r>/);
  });

  test('deleting your OWN pending insertion removes it rather than striking it', () => {
    const before = part(
      `<w:p><w:r><w:t>keep</w:t></w:r>` +
        `<w:ins w:id="1" w:author="Ada Lovelace"><w:r><w:t>mine</w:t></w:r></w:ins></w:p>`
    );
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 4,
      end: 8,
      revision: ADA,
    });
    const out = xml(after);
    // Nothing to propose: the words were never anyone else's to see.
    expect(out).not.toContain('mine');
    expect(out).not.toContain('<w:del');
    expect(out).toContain('<w:t>keep</w:t>');
    // The emptied wrapper goes with its content.
    expect(out).not.toContain('<w:ins');
  });

  test("another author's insertion is struck, not removed", () => {
    const before = part(
      `<w:p><w:ins w:id="1" w:author="Alan Turing"><w:r><w:t>theirs</w:t></w:r></w:ins></w:p>`
    );
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 0,
      end: 6,
      revision: ADA,
    });
    const out = xml(after);
    // `w:del` inside `w:ins` is exactly how OOXML records "they added it, I want it gone".
    expect(out).toMatch(/<w:ins[^>]*><w:del[^>]*>/);
    expect(out).toContain('<w:delText>theirs</w:delText>');
  });

  test('deleting already-deleted text changes nothing', () => {
    const source = `<w:p><w:del w:id="1" w:author="Alan Turing"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>`;
    const before = part(source);
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 0,
      end: 4,
      revision: ADA,
    });
    // One `w:del`, not two: striking a strike says the same thing twice and would make
    // accepting it a two-step affair.
    expect(xml(after).match(/<w:del\b/g)?.length).toBe(1);
  });

  test('consecutive deletions join one revision, not one per keystroke', () => {
    // Backspace through a word: three ops, each striking the character before the last.
    let current = part('<w:p><w:r><w:t>keep word</w:t></w:r></w:p>');
    const id = paragraphId(current);
    for (const [from, to] of [
      [8, 9],
      [7, 8],
      [6, 7],
    ] as const) {
      current = apply(current, {
        op: 'deleteText',
        paragraphId: id,
        start: from,
        end: to,
        revision: ADA,
      });
    }
    const out = xml(current);
    // ONE decision, one Accept. A `w:del` per keystroke turned a deleted word into a column
    // of one-letter cards in the review pane.
    expect(out.match(/<w:del\b/g)?.length).toBe(1);
    const deletion = out.match(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/)?.[1] ?? '';
    expect(deletion.match(/<w:r\b/g)?.length).toBe(1);
    expect(out).toContain('ord');
    expect(out).toContain('keep w');
  });

  test('consecutive deletions merge copied runs only when their formatting agrees', () => {
    let current = part(
      '<w:p><w:r><w:rPr><w:b/><w:color w:val="123456"/></w:rPr><w:t>word</w:t></w:r></w:p>'
    );
    const id = paragraphId(current);
    for (const [from, to] of [
      [3, 4],
      [2, 3],
      [1, 2],
    ] as const) {
      current = apply(current, {
        op: 'deleteText',
        paragraphId: id,
        start: from,
        end: to,
        revision: ADA,
      });
    }
    const deletion = xml(current).match(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/)?.[1] ?? '';
    expect(deletion.match(/<w:r\b/g)?.length).toBe(1);
    expect(deletion).toContain('<w:b');
    expect(deletion).toContain('w:val="123456"');
    expect(deletion).toContain('<w:delText>ord</w:delText>');

    let mixed = part(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>a</w:t></w:r>' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t>b</w:t></w:r></w:p>'
    );
    const mixedId = paragraphId(mixed);
    for (const [from, to] of [
      [1, 2],
      [0, 1],
    ] as const) {
      mixed = apply(mixed, {
        op: 'deleteText',
        paragraphId: mixedId,
        start: from,
        end: to,
        revision: ADA,
      });
    }
    const mixedDeletion = xml(mixed).match(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/)?.[1] ?? '';
    expect(mixedDeletion.match(/<w:r\b/g)?.length).toBe(2);
  });

  test('a deletion by ANOTHER author beside yours stays its own decision', () => {
    const before = part(
      `<w:p><w:del w:id="1" w:author="Alan Turing"><w:r><w:delText>his</w:delText></w:r></w:del>` +
        `<w:r><w:t>mine</w:t></w:r></w:p>`
    );
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 3,
      end: 7,
      revision: ADA,
    });
    const out = xml(after);
    expect(out.match(/<w:del\b/g)?.length).toBe(2);
    expect(out).toMatch(/w:author="Alan Turing"/);
    expect(out).toMatch(/w:author="Ada Lovelace"/);
  });

  test('a bookmark id is a DIFFERENT id space and never counted', () => {
    // `w:id` on a bookmark is attacker-controlled and unbounded (`ST_DecimalNumber` is
    // xsd:integer). Counting it produced `w:id="1e+22"` — not an integer, and a file Word
    // calls unreadable.
    const before = part(
      `<w:p><w:bookmarkStart w:id="10000000000000000000000" w:name="b"/>` +
        `<w:r><w:t>text</w:t></w:r><w:bookmarkEnd w:id="10000000000000000000000"/></w:p>`
    );
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 2,
      text: 'X',
      revision: ADA,
    });
    const id = xml(after).match(/<w:ins[^>]*w:id="([^"]+)"/)?.[1];
    expect(id).toMatch(/^\d{1,10}$/);
  });

  test('a STRUCTURAL revision id is counted too, so a new edit cannot collide with it', () => {
    // `w:cellIns` and friends read as `generic`, so matching on the typed kind missed them.
    // Colliding with one made the user's own insertion share an address with a revision the
    // engine refuses — and the card lost its Accept and Reject buttons.
    const before = part(
      `<w:tbl><w:tr><w:trPr><w:ins w:id="0" w:author="Ada Lovelace"/></w:trPr>` +
        `<w:tc><w:tcPr><w:cellIns w:id="1" w:author="Ada Lovelace"/></w:tcPr>` +
        `<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
        `<w:p><w:r><w:t>body</w:t></w:r></w:p>`
    );
    const paragraphs: string[] = [];
    const walk = (node: { id: string; kind: string; children?: readonly unknown[] }): void => {
      if (node.kind === 'paragraph') paragraphs.push(node.id);
      for (const child of (node.children ?? []) as (typeof node)[]) walk(child);
    };
    walk(before.root as never);
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphs[paragraphs.length - 1]!,
      offset: 0,
      text: 'X',
      revision: ADA,
    });
    const id = xml(after).match(/<w:ins[^>]*w:id="(\d+)"[^>]*>\s*<w:r>/)?.[1];
    expect(id).not.toBe('0');
    expect(id).not.toBe('1');
  });

  test('a revision id is taken past the highest in use, never reused', () => {
    const before = part(
      `<w:p><w:ins w:id="7" w:author="Alan Turing"><w:r><w:t>ab</w:t></w:r></w:ins>` +
        `<w:r><w:t>cd</w:t></w:r></w:p>`
    );
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 3,
      text: 'X',
      revision: ADA,
    });
    const ids = [...xml(after).matchAll(/<w:ins[^>]*w:id="(\d+)"/g)].map((match) => match[1]);
    expect(ids).toContain('7');
    expect(ids.some((id) => Number(id) > 7)).toBe(true);
  });
});

// Offsets come from `paragraphOffsetIndex`, which is `segmentsOf`'s own walk. Before that,
// this module carried a private length function that disagreed with the authority about three
// things at once, and every one of them is a paragraph shape Word writes routinely.
describe('the offset model is the shared one', () => {
  /** "ab" + a footnote reference + "cd": five model units, not four. */
  const WITH_NOTE =
    `<w:p><w:r><w:t>ab</w:t></w:r>` +
    `<w:r><w:footnoteReference w:id="1"/></w:r>` +
    `<w:r><w:t>cd</w:t></w:r></w:p>`;

  test('a note reference measures ONE unit, so an insert past it lands where asked', () => {
    const before = part(WITH_NOTE);
    // Offset 4 is between "c" and "d". Counting the reference as nothing put it between
    // "b" and "c" instead — one character early for every reference in the paragraph.
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 4,
      text: 'X',
      revision: ADA,
    });
    const text = xml(after)
      .match(/<w:t[^>]*>([^<]*)<\/w:t>/g)!
      .map((node) => node.replace(/<[^>]+>/g, ''))
      .join('');
    expect(text).toBe('abcXd');
  });

  test('an insert at the TRUE paragraph end is accepted, not refused as out of range', () => {
    const before = part(WITH_NOTE);
    // Length 5: "ab" + the reference + "cd". The private walker said 4, so this offset was
    // past the end it believed in and the op was refused with `offset-out-of-range`.
    const result = applyTreeOp(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 5,
      text: 'X',
      revision: ADA,
    });
    expect(result.ok).toBe(true);
  });

  test('a delete strikes exactly the selected units, leaving the reference alone', () => {
    const before = part(WITH_NOTE);
    // [0, 2) is "ab" and nothing else.
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 0,
      end: 2,
      revision: ADA,
    });
    const serialized = xml(after);
    expect(serialized).toContain('<w:delText>ab</w:delText>');
    // The reference is outside the range, so it is neither struck nor moved.
    expect(serialized).toContain('<w:footnoteReference w:id="1"/>');
    const struck = serialized.match(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/)![1]!;
    expect(struck).not.toContain('footnoteReference');
  });

  test("a field's instruction text measures nothing, so text after it addresses correctly", () => {
    const before = part(
      `<w:p><w:r><w:t>ab</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>7</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>cd</w:t></w:r></w:p>`
    );
    // "ab" + the field as one atom + "cd" = five units. Counting " PAGE " and the cached
    // result as visible characters made this offset land inside the field's own markup.
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 5,
      text: 'X',
      revision: ADA,
    });
    const serialized = xml(after);
    expect(serialized).toMatch(/<w:t>cd<\/w:t>[\s\S]*<w:ins[^>]*>[\s\S]*<w:t>X<\/w:t>/);
    // The instruction is untouched: it was never text to address into.
    expect(serialized).toContain('<w:instrText xml:space="preserve"> PAGE </w:instrText>');
  });

  test('a tracked insert inside a HYPERLINK splits the link run, not the paragraph', () => {
    const before = part(
      `<w:p><w:hyperlink r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>`
    );
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 2,
      text: 'X',
      revision: ADA,
    });
    // Inside the link element, because that is where offset 2 is.
    expect(xml(after)).toMatch(
      /<w:hyperlink[^>]*>[\s\S]*<w:ins[^>]*>[\s\S]*X[\s\S]*<\/w:hyperlink>/
    );
  });
});

// An ATOM is one addressable unit spread over several nodes, and a tracked edit has to respect
// that grouping. These are the cases where not respecting it produces markup that is valid XML
// and a broken document: a field whose halves disagree about whether it was deleted, and typed
// words parked inside a field instruction where nothing will ever show them again.
describe('an atomic field survives a tracked edit whole', () => {
  const FIELD =
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r><w:t>7</w:t></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const WITH_FIELD = `<w:p><w:r><w:t>ab</w:t></w:r>${FIELD}<w:r><w:t>cd</w:t></w:r></w:p>`;

  /** Every field-chrome node, and whether it sits inside a `w:del` element. */
  function chromeInDeletion(serialized: string): boolean[] {
    const deletions: { from: number; to: number }[] = [];
    for (const match of serialized.matchAll(/<w:del\s[^>]*>[\s\S]*?<\/w:del>/g)) {
      deletions.push({ from: match.index, to: match.index + match[0].length });
    }
    const struck: boolean[] = [];
    for (const match of serialized.matchAll(/<w:(?:fldChar|instrText|delInstrText)\b/g)) {
      struck.push(deletions.some((span) => match.index > span.from && match.index < span.to));
    }
    return struck;
  }

  test('striking the field strikes ALL of it, not only its begin marker', () => {
    const before = part(WITH_FIELD);
    // [2, 3) is the field's one model unit and nothing else.
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 2,
      end: 3,
      revision: ADA,
    });
    const serialized = xml(after);
    // Every piece of the field is inside the deletion. A `begin` struck with its `end` left
    // standing is a field that cannot be accepted: accepting removed the begin and orphaned
    // the instruction, the separator and the end.
    expect(chromeInDeletion(serialized)).toEqual([true, true, true, true]);
    // The instruction is re-labelled the way §17.16.23 requires inside a deletion.
    expect(serialized).toContain('<w:delInstrText');
    expect(serialized).not.toContain('<w:instrText');
    // The words around it are untouched.
    expect(serialized).toContain('<w:t>ab</w:t>');
    expect(serialized).toContain('<w:t>cd</w:t>');
  });

  test('a selection running through the field takes the whole field with it', () => {
    const before = part(WITH_FIELD);
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 1,
      end: 4,
      revision: ADA,
    });
    expect(chromeInDeletion(xml(after))).toEqual([true, true, true, true]);
  });

  test('a selection that stops SHORT of the field leaves it alone', () => {
    const before = part(WITH_FIELD);
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 0,
      end: 2,
      revision: ADA,
    });
    expect(chromeInDeletion(xml(after))).toEqual([false, false, false, false]);
    expect(xml(after)).toContain('<w:instrText');
  });

  test('typing at the field’s end lands after it, not inside its instruction', () => {
    const before = part(WITH_FIELD);
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 3,
      text: 'X',
      revision: ADA,
    });
    const serialized = xml(after);
    // After the field's `end` marker. Between `begin` and the instruction — which is where
    // the first zero-width run at that offset sits — the words become part of the field's
    // own markup and no reader ever shows them again.
    // `<w:ins ` with the space: `<w:instrText` also starts with `<w:ins`.
    const insertion = serialized.indexOf('<w:ins ');
    expect(serialized.indexOf('w:fldCharType="end"')).toBeLessThan(insertion);
    expect(insertion).toBeLessThan(serialized.indexOf('<w:t>cd</w:t>'));
  });

  test('typing at the field’s start lands before it', () => {
    const before = part(WITH_FIELD);
    const after = apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset: 2,
      text: 'X',
      revision: ADA,
    });
    const serialized = xml(after);
    expect(serialized.indexOf('<w:ins ')).toBeLessThan(serialized.indexOf('w:fldCharType="begin"'));
  });

  test('a simple field is struck from INSIDE, because w:del cannot hold one', () => {
    // `CT_RunTrackChange` takes `EG_ContentRunContent`, and `w:fldSimple` is not in it —
    // so the deletion goes inside the field, which is what Word writes.
    const before = part(
      `<w:p><w:r><w:t>ab</w:t></w:r>` +
        `<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>` +
        `<w:r><w:t>cd</w:t></w:r></w:p>`
    );
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 2,
      end: 3,
      revision: ADA,
    });
    const serialized = xml(after);
    expect(serialized).toMatch(/<w:fldSimple[^>]*><w:del\b/);
    expect(serialized).toContain('<w:delText>7</w:delText>');
    // The field element itself survives: it is the thing being proposed for deletion, not
    // something to dissolve.
    expect(serialized).toContain('w:instr=" PAGE "');
  });
});
