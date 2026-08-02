// Lossless editing, as a standing guard.
//
// Two properties, asserted against REAL documents rather than synthetic ones:
//
//   REACH   the save/reopen oracle sees every paragraph in the part. This is the guard that
//           was missing when `digestPart` walked only the body's direct `w:p` children:
//           239 of 574 paragraphs on the comprehensive fixture were outside the oracle, so
//           a round trip that emptied a table cell reported zero differences. A coverage
//           number is the only thing that catches an oracle with a hole in it — the digest
//           cannot report on content it never visits.
//
//   LOSS    an ordinary edit, saved and reopened, does not drop a class of content. Counting
//           elements by local name across every part surfaces "the `w:bookmarkStart` is
//           gone" without the test having to guess in advance what might vanish.
//
// Deliberately cheap: no DOM, no layout, no surface. Each fixture is read once.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage, writeOoxmlPackage, withPart } from '../package/ooxml-package.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { semanticDigest } from '../package/ooxml-digest.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import type { TreeDocOp } from '../store/tree-op-validate.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../../e2e/fixtures/${name}`, import.meta.url)));

function open(name: string) {
  const result = readOoxmlPackage(fixture(name));
  if (!result.ok) throw new Error(`${name}: ${result.reason}`);
  const pkg = result.package;
  const part = pkg.parts.get(pkg.mainDocumentPart);
  if (!part) throw new Error(`${name}: no main part`);
  return { pkg, part };
}

/** Every node in a part, in document order. */
function* walk(node: OoxmlNode): Generator<OoxmlNode> {
  yield node;
  if (node.kind === 'textValue') return;
  for (const child of node.children ?? []) yield* walk(child);
}

const paragraphIdsOf = (part: OoxmlPart): string[] => {
  const ids: string[] = [];
  for (const node of walk(part.root)) if (node.kind === 'paragraph') ids.push(node.id);
  return ids;
};

/** Element counts by local name, across every XML part of the package. */
function elementCensus(pkg: ReturnType<typeof open>['pkg']): Map<string, number> {
  const census = new Map<string, number>();
  for (const part of pkg.parts.values()) {
    for (const node of walk(part.root)) {
      if (node.kind === 'textValue') continue;
      census.set(node.localName, (census.get(node.localName) ?? 0) + 1);
    }
  }
  return census;
}

/** Names whose count dropped, with before/after — the shape a reader can act on. */
function losses(before: Map<string, number>, after: Map<string, number>): Record<string, string> {
  const lost: Record<string, string> = {};
  for (const [name, count] of before) {
    const now = after.get(name) ?? 0;
    if (now < count) lost[name] = `${count} -> ${now}`;
  }
  return lost;
}

/** Apply ops, save, reopen. Returns the reopened package. */
function roundTrip(name: string, plan: (part: OoxmlPart) => readonly TreeDocOp[]) {
  const { pkg, part } = open(name);
  const store = new TreeDocumentStore(part);
  const ops = plan(store.part);
  store.transact((tx) => {
    for (const op of ops) tx.apply(op);
  });
  const saved = writeOoxmlPackage(withPart(pkg, store.part));
  const reopened = readOoxmlPackage(saved);
  if (!reopened.ok) throw new Error(`${name}: reopen failed: ${reopened.reason}`);
  return { before: pkg, after: reopened.package, ops };
}

// Small enough to stay quick, broad enough to cover tables, content controls and numbering.
const FIXTURES = [
  'comprehensive-word-element-test.docx',
  'block-sdt-comprehensive.docx',
  'editable-sample.docx',
] as const;

describe('the save/reopen oracle reaches every paragraph', () => {
  for (const name of FIXTURES) {
    test(`${name}: the digest covers 100% of the part's paragraphs`, () => {
      const { part } = open(name);
      const total = paragraphIdsOf(part).length;
      expect(total).toBeGreaterThan(0);
      // One digest entry per paragraph. A shortfall means the oracle is blind to whatever
      // it skipped — table cells and block content controls, historically.
      const [story] = semanticDigest([part]).stories;
      expect(story?.paragraphs.length ?? 0).toBe(total);
    });
  }
});

describe('an edit survives a save and reopen without losing a class of content', () => {
  /** The first paragraph carrying at least one child that is not a run. */
  const withAnchors = (part: OoxmlPart): string => {
    for (const node of walk(part.root)) {
      if (node.kind !== 'paragraph') continue;
      const interesting = node.children.some(
        (child) => child.kind !== 'textValue' && child.kind !== 'run'
      );
      if (interesting) return node.id;
    }
    return paragraphIdsOf(part)[0]!;
  };

  const EDITS: readonly {
    readonly what: string;
    readonly plan: (part: OoxmlPart) => readonly TreeDocOp[];
  }[] = [
    {
      what: 'typing a character',
      plan: (part) => [{ op: 'insertText', paragraphId: withAnchors(part), offset: 0, text: 'x' }],
    },
    {
      what: 'splitting a paragraph that carries anchors',
      plan: (part) => [{ op: 'splitParagraph', paragraphId: withAnchors(part), offset: 2 }],
    },
    {
      // `setParagraphProperties` REPLACES the set, so a caller must restate what it keeps —
      // this mirrors what the surface does, merging the new value over the paragraph's own
      // direct properties rather than over the flattened cascade.
      what: 'setting a paragraph property',
      plan: (part) => {
        const paragraphId = withAnchors(part);
        const own: { localName: string; attributes?: Record<string, string> }[] = [];
        for (const node of walk(part.root)) {
          if (node.id !== paragraphId || node.kind === 'textValue') continue;
          const pPr = node.children.find(
            (child) => child.kind !== 'textValue' && child.localName === 'pPr'
          );
          for (const child of pPr?.children ?? []) {
            if (child.kind === 'textValue' || child.localName === 'jc') continue;
            const attributes: Record<string, string> = {};
            for (const attribute of child.attributes ?? []) {
              attributes[attribute.localName] = attribute.value;
            }
            own.push({ localName: child.localName, attributes });
          }
        }
        return [
          {
            op: 'setParagraphProperties',
            paragraphId,
            properties: [...own, { localName: 'jc', attributes: { val: 'center' } }],
          },
        ];
      },
    },
    {
      what: 'setting run properties over a range',
      plan: (part) => [
        {
          op: 'setRunProperties',
          paragraphId: withAnchors(part),
          start: 0,
          end: 1,
          properties: [{ localName: 'b' }],
        },
      ],
    },
  ];

  for (const name of FIXTURES) {
    for (const edit of EDITS) {
      test(`${name}: ${edit.what}`, () => {
        const { before, after } = roundTrip(name, edit.plan);
        // A split legitimately ADDS a `w:p`; nothing may be lost.
        expect(losses(elementCensus(before), elementCensus(after))).toEqual({});
      });
    }
  }

  test('the guard has teeth: a dropped element is reported', () => {
    const { pkg, part } = open('comprehensive-word-element-test.docx');
    const census = elementCensus(pkg);
    // Same document minus its first paragraph — the census must notice.
    const stripped: OoxmlPart = {
      ...part,
      root: {
        ...part.root,
        children: part.root.children.map((child) =>
          child.kind === 'textValue'
            ? child
            : { ...child, children: (child.children ?? []).slice(1) }
        ),
      } as OoxmlNode,
    } as OoxmlPart;
    const lost = losses(census, elementCensus(withPart(pkg, stripped)));
    expect(Object.keys(lost).length).toBeGreaterThan(0);
  });
});
