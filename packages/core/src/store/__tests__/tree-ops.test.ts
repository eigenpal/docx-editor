// Paragraph semantic operations over the canonical tree (tasks 5.1, 5.2) and the
// rejection guarantees (task 5.3): an invalid or stale op leaves the tree, revision and
// derived indexes completely unchanged.

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  applyTreeOp,
  paragraphTextOf,
  validateTreeOp,
  type TreeDocOp,
} from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:a="${A}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
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

const SIMPLE = '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>';
const FORMATTED =
  '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t> plain</w:t></w:r></w:p>';
const WITH_UNKNOWN =
  '<w:p><w:r><w:t>before </w:t></w:r>' +
  '<w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r>' +
  '<w:r><w:t>after</w:t></w:r></w:p>';

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.part;
}

describe('text operations over UTF-16 offsets (task 5.1)', () => {
  test('insertText places characters at the offset', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'insertText', paragraphId: id!, offset: 5, text: ' there' });
    expect(paragraphTextOf(next, id!)).toBe('Hello there world');
  });

  test('insertText at the start and at the end', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    expect(
      paragraphTextOf(
        apply(part, { op: 'insertText', paragraphId: id!, offset: 0, text: '>' }),
        id!
      )
    ).toBe('>Hello world');
    expect(
      paragraphTextOf(
        apply(part, { op: 'insertText', paragraphId: id!, offset: 11, text: '!' }),
        id!
      )
    ).toBe('Hello world!');
  });

  test('deleteText removes exactly the range', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'deleteText', paragraphId: id!, start: 5, end: 11 });
    expect(paragraphTextOf(next, id!)).toBe('Hello');
  });

  test('deleteText spanning a run boundary removes from both runs', () => {
    const part = load(FORMATTED);
    const [id] = paragraphIds(part);
    // "Bold plain" — remove "ld pl".
    const next = apply(part, { op: 'deleteText', paragraphId: id!, start: 2, end: 7 });
    expect(paragraphTextOf(next, id!)).toBe('Boain');
  });

  test('authored whitespace is preserved verbatim', () => {
    const part = load('<w:p><w:r><w:t xml:space="preserve">  spaced  </w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    expect(paragraphTextOf(part, id!)).toBe('  spaced  ');
    const next = apply(part, { op: 'insertText', paragraphId: id!, offset: 2, text: 'X' });
    expect(paragraphTextOf(next, id!)).toBe('  Xspaced  ');
  });

  test('tab and hard break are addressable content, one offset each', () => {
    const part = load('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    expect(paragraphTextOf(part, id!)).toBe('a\tb\nc');
    const next = apply(part, { op: 'deleteText', paragraphId: id!, start: 1, end: 2 });
    expect(paragraphTextOf(next, id!)).toBe('ab\nc');
  });

  test('insertTab and insertHardBreak add content at an offset', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const tabbed = apply(part, { op: 'insertTab', paragraphId: id!, offset: 5 });
    expect(paragraphTextOf(tabbed, id!)).toBe('Hello\t world');
    const broken = apply(tabbed, { op: 'insertHardBreak', paragraphId: id!, offset: 6 });
    expect(paragraphTextOf(broken, id!)).toBe('Hello\t\n world');
    expect(serializeOoxmlPart(broken)).toContain('<w:br/>');
  });

  test('insertPageBreak writes w:br w:type="page" and survives save/reopen', () => {
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const withBreak = apply(part, { op: 'insertPageBreak', paragraphId: id!, offset: 1 });
    expect(paragraphTextOf(withBreak, id!)).toBe('a\fb');
    const saved = serializeOoxmlPart(withBreak);
    expect(saved).toContain('<w:br w:type="page"/>');
    const reopened = load(saved);
    const [reopenedId] = paragraphIds(reopened);
    expect(paragraphTextOf(reopened, reopenedId!)).toBe('a\fb');
  });

  test('an edit next to unknown content leaves the unknown node untouched', () => {
    const part = load(WITH_UNKNOWN);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'insertText', paragraphId: id!, offset: 0, text: 'X' });
    expect(paragraphTextOf(next, id!)).toBe('Xbefore after');
    const out = serializeOoxmlPart(next);
    expect(out).toContain('urn:clip');
    expect(out).toContain('drawing');
  });

  test('insertText at boundaries emits xml:space preserve on save/reopen', () => {
    const part = load('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const leading = apply(part, { op: 'insertText', paragraphId: id!, offset: 0, text: ' ' });
    const both = apply(leading, { op: 'insertText', paragraphId: id!, offset: 6, text: ' ' });
    expect(paragraphTextOf(both, id!)).toBe(' Hello ');
    const saved = serializeOoxmlPart(both);
    expect(saved).toContain('<w:t xml:space="preserve"> </w:t>');
    expect(saved).toContain('<w:t>Hello</w:t>');
    const reopened = load(saved);
    const [reopenedId] = paragraphIds(reopened);
    expect(paragraphTextOf(reopened, reopenedId!)).toBe(' Hello ');
  });

  test('replace across run boundaries keeps trailing space on save/reopen', () => {
    const part = load(FORMATTED);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'insertText', paragraphId: id!, offset: 4, text: 'X' });
    expect(paragraphTextOf(next, id!)).toBe('BoldX plain');
    const saved = serializeOoxmlPart(next);
    expect(saved).toContain('<w:t xml:space="preserve"> plain</w:t>');
    const reopened = load(saved);
    expect(paragraphTextOf(reopened, paragraphIds(reopened)[0]!)).toBe('BoldX plain');
  });

  test('split preserves boundary whitespace through save/reopen', () => {
    const part = load('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const split = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 5 });
    const ids = paragraphIds(split);
    expect(paragraphTextOf(split, ids[1]!)).toBe(' world');
    const saved = serializeOoxmlPart(split);
    expect(saved).toContain('<w:t xml:space="preserve"> world</w:t>');
    const reopened = load(saved);
    const reopenedIds = paragraphIds(reopened);
    expect(paragraphTextOf(reopened, reopenedIds[1]!)).toBe(' world');
  });

  test('whitespace-only insertText survives save/reopen', () => {
    const part = load('<w:p><w:r><w:t>Helloworld</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'insertText', paragraphId: id!, offset: 5, text: '  ' });
    expect(paragraphTextOf(next, id!)).toBe('Hello  world');
    const saved = serializeOoxmlPart(next);
    expect(saved).toContain('<w:t xml:space="preserve">  </w:t>');
    const reopened = load(saved);
    expect(paragraphTextOf(reopened, paragraphIds(reopened)[0]!)).toBe('Hello  world');
  });
});

describe('split and join (task 5.1)', () => {
  test('split divides a paragraph and keeps its properties on both halves', () => {
    const part = load(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Hello world</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id!, offset: 5 });
    if (!result.ok) throw new Error(result.reason);
    const ids = paragraphIds(result.part);
    expect(ids).toHaveLength(2);
    expect(paragraphTextOf(result.part, ids[0]!)).toBe('Hello');
    expect(paragraphTextOf(result.part, ids[1]!)).toBe(' world');
    expect(result.effect.split).toEqual({ from: id!, tail: ids[1]! });
    expect(result.effect.impact).toBe('flow-structural');
    // Alignment survives on both halves, as Word does.
    expect(serializeOoxmlPart(result.part).match(/w:jc/g)).toHaveLength(2);
  });

  test('split inside a formatted run keeps the formatting on both halves', () => {
    const part = load('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>BoldText</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 4 });
    const ids = paragraphIds(next);
    expect(paragraphTextOf(next, ids[0]!)).toBe('Bold');
    expect(paragraphTextOf(next, ids[1]!)).toBe('Text');
    expect(serializeOoxmlPart(next).match(/<w:b\/>/g)).toHaveLength(2);
  });

  test('split at the end produces an empty tail that accepts text', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const split = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 11 });
    const ids = paragraphIds(split);
    expect(paragraphTextOf(split, ids[1]!)).toBe('');
    // The regression the browser checkpoint found, at the model layer: a freshly created
    // paragraph must accept the very next keystroke.
    const typed = apply(split, { op: 'insertText', paragraphId: ids[1]!, offset: 0, text: 'new' });
    expect(paragraphTextOf(typed, ids[1]!)).toBe('new');
  });

  test('join merges adjacent paragraphs and reports the removed one', () => {
    const part = load(
      '<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>second</w:t></w:r></w:p>'
    );
    const [a, b] = paragraphIds(part);
    const result = applyTreeOp(part, { op: 'joinParagraphs', firstId: a!, secondId: b! });
    if (!result.ok) throw new Error(result.reason);
    expect(paragraphIds(result.part)).toEqual([a!]);
    expect(paragraphTextOf(result.part, a!)).toBe('firstsecond');
    expect(result.effect.join).toEqual({ kept: a!, removed: b! });
    expect(result.effect.deleted).toEqual([b!]);
  });

  test('join refuses non-adjacent paragraphs', () => {
    const part = load(
      '<w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p><w:p><w:r><w:t>c</w:t></w:r></w:p>'
    );
    const ids = paragraphIds(part);
    const result = applyTreeOp(part, { op: 'joinParagraphs', firstId: ids[0]!, secondId: ids[2]! });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-adjacent-siblings');
  });
});

describe('the complete D8 property boundary (task 5.1)', () => {
  test('every accepted RUN property can be authored', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    for (const localName of ACCEPTED_RUN_PROPERTIES) {
      const result = applyTreeOp(part, {
        op: 'setRunProperties',
        paragraphId: id!,
        start: 0,
        end: 5,
        properties: [{ localName, attributes: { val: 'x' } }],
      });
      expect(result.ok).toBe(true);
    }
  });

  test('every accepted PARAGRAPH property can be authored', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    for (const localName of ACCEPTED_PARAGRAPH_PROPERTIES) {
      const result = applyTreeOp(part, {
        op: 'setParagraphProperties',
        paragraphId: id!,
        properties: [{ localName, attributes: { val: 'x' } }],
      });
      expect(result.ok).toBe(true);
    }
  });

  test('setRunProperties applies to exactly the requested range', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const next = apply(part, {
      op: 'setRunProperties',
      paragraphId: id!,
      start: 0,
      end: 5,
      properties: [{ localName: 'b' }],
    });
    expect(paragraphTextOf(next, id!)).toBe('Hello world');
    const out = serializeOoxmlPart(next);
    // The bolded half carries the property; the rest does not.
    expect(out.match(/<w:b\/>/g)).toHaveLength(1);
    expect(out.indexOf('<w:b/>')).toBeLessThan(out.indexOf('Hello'));
  });

  test('setParagraphProperties replaces the container and clearing removes it', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const styled = apply(part, {
      op: 'setParagraphProperties',
      paragraphId: id!,
      properties: [{ localName: 'pStyle', attributes: { val: 'Heading1' } }],
    });
    expect(serializeOoxmlPart(styled)).toContain('w:val="Heading1"');
    const cleared = apply(styled, {
      op: 'setParagraphProperties',
      paragraphId: id!,
      properties: [],
    });
    expect(serializeOoxmlPart(cleared)).not.toContain('pPr');
  });

  test('a property outside D8 is refused rather than silently authored', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, {
      op: 'setRunProperties',
      paragraphId: id!,
      start: 0,
      end: 5,
      properties: [{ localName: 'lang', attributes: { val: 'en-US' } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-property');
  });
});

describe('revision-tagged effect evidence (task 5.2)', () => {
  test('a text edit is text-local and names the paragraph it dirtied', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, { op: 'insertText', paragraphId: id!, offset: 0, text: 'x' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.effect.impact).toBe('text-local');
    expect(result.effect.dirty).toEqual([id!]);
    expect(result.effect.dependencyKeys.length).toBeGreaterThan(0);
  });

  test('a paragraph property change is paragraph-local', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, {
      op: 'setParagraphProperties',
      paragraphId: id!,
      properties: [{ localName: 'keepNext' }],
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.effect.impact).toBe('paragraph-local');
  });

  test('split and join are flow-structural', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id!, offset: 5 });
    if (!split.ok) throw new Error(split.reason);
    expect(split.effect.impact).toBe('flow-structural');
    const ids = paragraphIds(split.part);
    const join = applyTreeOp(split.part, {
      op: 'joinParagraphs',
      firstId: ids[0]!,
      secondId: ids[1]!,
    });
    if (!join.ok) throw new Error(join.reason);
    expect(join.effect.impact).toBe('flow-structural');
  });
});

describe('rejections leave everything unchanged (task 5.3)', () => {
  const part = load(SIMPLE);
  const [id] = paragraphIds(part);
  const fingerprintBefore = canonicalOoxmlFingerprint(part);

  const rejected: { name: string; op: TreeDocOp; reason: string }[] = [
    {
      name: 'an unknown paragraph',
      op: { op: 'insertText', paragraphId: 'no-such-id', offset: 0, text: 'x' },
      reason: 'unknown-paragraph',
    },
    {
      name: 'an offset past the end',
      op: { op: 'insertText', paragraphId: id!, offset: 999, text: 'x' },
      reason: 'offset-out-of-range',
    },
    {
      name: 'a negative offset',
      op: { op: 'insertText', paragraphId: id!, offset: -1, text: 'x' },
      reason: 'offset-out-of-range',
    },
    {
      name: 'a non-integer offset',
      op: { op: 'insertText', paragraphId: id!, offset: 1.5, text: 'x' },
      reason: 'offset-out-of-range',
    },
    {
      name: 'an inverted range',
      op: { op: 'deleteText', paragraphId: id!, start: 5, end: 2 },
      reason: 'invalid-range',
    },
    {
      name: 'an empty range',
      op: { op: 'deleteText', paragraphId: id!, start: 3, end: 3 },
      reason: 'invalid-range',
    },
    {
      name: 'a range past the end',
      op: { op: 'deleteText', paragraphId: id!, start: 0, end: 99 },
      reason: 'offset-out-of-range',
    },
    {
      name: 'a property outside the D8 boundary',
      op: {
        op: 'setRunProperties',
        paragraphId: id!,
        start: 0,
        end: 2,
        properties: [{ localName: 'noSuchProperty' }],
      },
      reason: 'unsupported-property',
    },
    {
      name: 'an attribute name that is not an XML name',
      op: {
        op: 'setRunProperties',
        paragraphId: id!,
        start: 0,
        end: 2,
        properties: [{ localName: 'b', attributes: { 'bad name"/><w:object': 'x' } }],
      },
      reason: 'invalid-property-value',
    },
    {
      name: 'text containing a character XML cannot represent',
      op: { op: 'insertText', paragraphId: id!, offset: 0, text: ' ' },
      reason: 'invalid-text',
    },
  ];

  for (const scenario of rejected) {
    test(`${scenario.name} is refused with a typed reason`, () => {
      const result = applyTreeOp(part, scenario.op);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(scenario.reason as never);
      // The tree is untouched — not merely equal, but the same fingerprint, and the
      // original object is still usable for the next scenario.
      expect(canonicalOoxmlFingerprint(part)).toBe(fingerprintBefore);
      expect(paragraphTextOf(part, id!)).toBe('Hello world');
    });
  }

  test('validate agrees with apply, so a caller can pre-check without side effects', () => {
    for (const scenario of rejected) {
      expect(validateTreeOp(part, scenario.op)).toBe(scenario.reason as never);
    }
  });

  test('a split inside a surrogate pair is refused', () => {
    const astral = load('<w:p><w:r><w:t>😀X</w:t></w:r></w:p>');
    const [emojiId] = paragraphIds(astral);
    const bad = applyTreeOp(astral, { op: 'splitParagraph', paragraphId: emojiId!, offset: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('splits-surrogate-pair');
    // Splitting AFTER the whole character is fine.
    const good = applyTreeOp(astral, { op: 'splitParagraph', paragraphId: emojiId!, offset: 2 });
    expect(good.ok).toBe(true);
  });

  test('a deletion boundary inside a surrogate pair is refused', () => {
    const astral = load('<w:p><w:r><w:t>😀X</w:t></w:r></w:p>');
    const [emojiId] = paragraphIds(astral);
    const result = applyTreeOp(astral, {
      op: 'deleteText',
      paragraphId: emojiId!,
      start: 1,
      end: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('splits-surrogate-pair');
  });

  test('an op targeting a non-paragraph node is refused', () => {
    const runId = (() => {
      let found: string | null = null;
      const walk = (node: OoxmlNode): void => {
        if (node.kind === 'textValue') return;
        if (node.kind === 'run' && !found) found = node.id;
        for (const child of node.children) walk(child);
      };
      walk(part.root);
      return found!;
    })();
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: runId,
      offset: 0,
      text: 'x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-a-paragraph');
  });
});

describe('splitParagraphMany equals the sequence of single splits it stands for', () => {
  // The op exists so a paste rebuilds the body once instead of once per line; its whole
  // contract is equivalence with the single splits it replaces, so that is what is tested:
  // same paragraph texts, same serialized XML shape, one op against many.
  const bodies = [
    {
      name: 'one plain run',
      body: '<w:p><w:r><w:t>alpha bravo charlie delta echo</w:t></w:r></w:p>',
    },
    {
      name: 'formatted runs',
      body: '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Bold text</w:t></w:r><w:r><w:t> and plain tail</w:t></w:r></w:p>',
    },
    {
      name: 'tabs and breaks',
      body: '<w:p><w:r><w:t>ab</w:t><w:tab/><w:t>cd</w:t><w:br/><w:t>ef</w:t></w:r></w:p>',
    },
  ];
  // Repeated offsets are legal and mean a blank line: two boundaries at one position put
  // an empty paragraph between them, which is what a paste containing "\n\n" carries.
  const offsetSets = [[1], [2, 4], [1, 2, 3], [0, 5], [3, 3], [2, 2, 2]];

  for (const { name, body } of bodies) {
    for (const offsets of offsetSets) {
      test(`${name}, offsets [${offsets.join(', ')}]`, () => {
        const part = load(body);
        const [id] = paragraphIds(part);
        const length = paragraphTextOf(part, id!)!.length;
        const usable = offsets.filter((offset) => offset <= length);
        if (usable.length === 0) return;

        const many = applyTreeOp(part, {
          op: 'splitParagraphMany',
          paragraphId: id!,
          offsets: usable,
        });
        expect(many.ok).toBe(true);
        if (!many.ok) return;

        let sequential = part;
        for (let index = usable.length - 1; index >= 0; index -= 1) {
          const step = applyTreeOp(sequential, {
            op: 'splitParagraph',
            paragraphId: id!,
            offset: usable[index]!,
          });
          expect(step.ok).toBe(true);
          if (!step.ok) return;
          sequential = step.part;
        }

        const textsOf = (candidate: OoxmlPart) =>
          paragraphIds(candidate).map((paragraphId) => paragraphTextOf(candidate, paragraphId));
        expect(textsOf(many.part)).toEqual(textsOf(sequential));
        // Ids differ between the two routes; the SERIALIZED document must not.
        expect(serializeOoxmlPart(many.part)).toBe(serializeOoxmlPart(sequential));
        // The effect reports every minted tail, so layout knows where the flow moved.
        expect(many.effect.created).toHaveLength(usable.length);
        expect(many.effect.splits).toHaveLength(usable.length);
      });
    }
  }

  test('unsorted or empty offset lists are refused before any tree work', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    for (const offsets of [[4, 2], []]) {
      const result = applyTreeOp(part, { op: 'splitParagraphMany', paragraphId: id!, offsets });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid-range');
    }
  });

  test('an out-of-range offset is refused', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, {
      op: 'splitParagraphMany',
      paragraphId: id!,
      offsets: [2, 999],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('offset-out-of-range');
  });
});
