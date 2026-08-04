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
    expect(out).toContain('ord');
    expect(out).toContain('keep w');
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
