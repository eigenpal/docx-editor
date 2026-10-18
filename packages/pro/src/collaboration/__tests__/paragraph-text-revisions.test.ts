/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Each tracked revision around a character is a shared-text attribute of its own. These tests
// pin the encoding: what `w` keeps, how a reader places each revision in the wrapper chain,
// which revisions a character typed inside another one belongs to, what a write changes, and
// that a peer's malformed revision values cost only the revision, never the character.
import { describe, expect, test } from 'bun:test';
import { readOoxmlPackage, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { linearizeParagraph, type LinearAttributes } from '../document/paragraph-linear.ts';
import { decodeAttributes, encodeAttributes } from '../document/paragraph-text.ts';
import {
  rebaseRevisions,
  revisionTrail,
  REVISION_PREFIX,
  SUPERSEDED_KEY,
} from '../document/paragraph-text-revisions.ts';
import { DEFAULT_DOCUMENT_LIMITS } from '../document/limits.ts';
import { tokensOfText } from '../document/paragraph-text-diff.ts';
import * as Y from 'yjs';
import { zipDocument } from './document-peer-support';

const LIMITS = DEFAULT_DOCUMENT_LIMITS;
const INS = (id: number, author: string) =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="2026-09-01T00:00:00Z">`;
const DEL = (id: number, author: string) =>
  `<w:del w:id="${id}" w:author="${author}" w:date="2026-09-01T00:00:00Z">`;

function paragraphsOf(node: OoxmlNode, out: OoxmlElement[] = []): OoxmlElement[] {
  if (node.kind === 'textValue') return out;
  if (node.kind === 'paragraph') out.push(node as OoxmlElement);
  for (const child of node.children) paragraphsOf(child, out);
  return out;
}

/** The first paragraph of a body, and the attributes of each of its items. */
function itemsOf(body: string): { readonly id: string; readonly items: LinearAttributes[] } {
  const loaded = readOoxmlPackage(zipDocument(body));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const paragraph = paragraphsOf(part.root)[0]!;
  return {
    id: paragraph.id,
    items: linearizeParagraph(paragraph).items.map((item) => item.attributes),
  };
}

/** Each wrapper around an item, outer first: its local name, author, and kind. */
const chainOf = (attributes: LinearAttributes): string[] =>
  attributes.wrap.map((wrapper) => {
    const author = wrapper.attributes.find((attribute) => attribute.localName === 'author');
    return author ? `${wrapper.localName}:${author.value}` : wrapper.localName;
  });

describe('the shared encoding of revisions', () => {
  test('keeps each revision apart from `w`, and reads the wrapper chain back in order', () => {
    const bodies = [
      `<w:p><w:hyperlink w:anchor="a">${INS(1, 'A')}${DEL(2, 'B')}<w:r><w:delText>x</w:delText></w:r></w:del></w:ins></w:hyperlink></w:p>`,
      `<w:p>${INS(1, 'A')}<w:hyperlink w:anchor="a">${DEL(2, 'B')}<w:r><w:delText>x</w:delText></w:r></w:del></w:hyperlink></w:ins></w:p>`,
      `<w:p>${INS(1, 'A')}${DEL(2, 'B')}<w:hyperlink w:anchor="a"><w:r><w:delText>x</w:delText></w:r></w:hyperlink></w:del></w:ins></w:p>`,
    ];
    const chains = [
      ['hyperlink', 'ins:A', 'del:B'],
      ['ins:A', 'hyperlink', 'del:B'],
      ['ins:A', 'del:B', 'hyperlink'],
    ];
    bodies.forEach((body, at) => {
      const { id, items } = itemsOf(body);
      const encoded = encodeAttributes(items[0]!, id, LIMITS);
      const revisionKeys = Object.keys(encoded).filter((key) => key.startsWith(REVISION_PREFIX));
      expect(revisionKeys).toHaveLength(2);
      // Only the link stays in the wrapper list.
      expect(JSON.parse(encoded.w!)).toHaveLength(1);
      expect(chainOf(decodeAttributes(encoded, LIMITS, id))).toEqual(chains[at]!);
    });
  });

  test("a peer's strike lands inside a link another peer added at the same time", () => {
    // One peer wraps the text in a link; the other, who never saw the link, strikes it. The
    // merged character holds the link's `w` and the strike's attribute, and the strike goes
    // inside the link: a revision holds run content only, never a link.
    const LINK = '<w:hyperlink w:anchor="a">';
    for (const [linked, struck, chain] of [
      [
        `<w:p>${LINK}${INS(1, 'A')}<w:r><w:t>x</w:t></w:r></w:ins></w:hyperlink></w:p>`,
        // A leading wrapper keeps the strike's IDs apart from the link's, as two peers' are.
        `<w:p><w:smartTag w:element="z">${INS(1, 'A')}${DEL(2, 'B')}<w:r><w:delText>x</w:delText></w:r></w:del></w:ins></w:smartTag></w:p>`,
        ['hyperlink', 'ins:A', 'del:B'],
      ],
      [
        `<w:p>${LINK}<w:r><w:t>x</w:t></w:r></w:hyperlink></w:p>`,
        `<w:p><w:smartTag w:element="z">${DEL(2, 'B')}<w:r><w:delText>x</w:delText></w:r></w:del></w:smartTag></w:p>`,
        ['hyperlink', 'del:B'],
      ],
    ] as const) {
      const link = itemsOf(linked);
      const strike = itemsOf(struck);
      const fromLink = encodeAttributes(link.items[0]!, link.id, LIMITS);
      const fromStrike = encodeAttributes(strike.items[0]!, link.id, LIMITS);
      const merged = { ...fromStrike, ...fromLink };
      for (const key of Object.keys(fromStrike).filter((k) => k.startsWith(REVISION_PREFIX))) {
        merged[key] = fromStrike[key]!;
      }
      expect(chainOf(decodeAttributes(merged, LIMITS, link.id))).toEqual([...chain]);
    }
  });

  test('two strikes written at once read in key order, and a write over them keeps both', () => {
    const { id, items } = itemsOf(
      `<w:p>${DEL(1, 'A')}${DEL(2, 'B')}<w:r><w:delText>x</w:delText></w:r></w:del></w:del></w:p>`
    );
    const nested = encodeAttributes(items[0]!, id, LIMITS);
    // Two peers each strike the same words: both deletions are outermost, with one order.
    const tied: Record<string, string> = { ...nested };
    for (const key of Object.keys(tied).filter((name) => name.startsWith(REVISION_PREFIX))) {
      const data = JSON.parse(tied[key]!) as Record<string, unknown>;
      tied[key] = JSON.stringify({ ...data, d: 1, o: undefined });
    }
    const read = decodeAttributes(tied, LIMITS, id);
    const keys = Object.keys(tied)
      .filter((name) => name.startsWith(REVISION_PREFIX))
      .sort();
    // The key that sorts first is the outer one.
    expect(chainOf(read)).toEqual(['del:A', 'del:B']);
    // The tree writes back what it reads, and the write changes no revision attribute.
    const written = rebaseRevisions(tied, encodeAttributes(read, id, LIMITS), false, LIMITS, id);
    for (const key of keys) expect(written[key]).toBe(tied[key]!);
  });

  test('a link whose list of revisions inside it does not read holds none', () => {
    const { id, items } = itemsOf(
      `<w:p><w:hyperlink w:anchor="a">${INS(1, 'A')}<w:r><w:t>x</w:t></w:r></w:ins></w:hyperlink></w:p>`
    );
    const encoded = encodeAttributes(items[0]!, id, LIMITS);
    const [link] = JSON.parse(encoded.w!) as Record<string, unknown>[];
    for (const inside of ['x', [1, {}], ['__proto__']]) {
      const w = JSON.stringify([{ ...link, r: inside }]);
      // Named by no list it can read, the revision goes inside the link, where it is valid.
      expect(chainOf(decodeAttributes({ ...encoded, w }, LIMITS, id))).toEqual([
        'hyperlink',
        'ins:A',
      ]);
    }
  });

  test('reads a revision whose outside wrapper is gone as the outermost one', () => {
    const { id, items } = itemsOf(
      `<w:p><w:hyperlink w:anchor="a">${INS(1, 'A')}<w:r><w:t>x</w:t></w:r></w:ins></w:hyperlink></w:p>`
    );
    const { w: _link, ...withoutLink } = encodeAttributes(items[0]!, id, LIMITS);
    expect(chainOf(decodeAttributes(withoutLink, LIMITS, id))).toEqual(['ins:A']);
  });

  test('gives two pieces of one revision the same trail, whatever their wrapper IDs', () => {
    const { id, items } = itemsOf(
      `<w:p>${INS(7, 'A')}<w:r><w:t>ab</w:t></w:r></w:ins><w:r><w:t>c</w:t></w:r>${INS(7, 'A')}<w:r><w:t>d</w:t></w:r></w:ins></w:p>`
    );
    const first = encodeAttributes(items[0]!, id, LIMITS);
    const second = encodeAttributes(items[3]!, id, LIMITS);
    const plain = encodeAttributes(items[2]!, id, LIMITS);
    expect(Object.keys(first)).not.toEqual(Object.keys(second));
    expect(revisionTrail(first, LIMITS, id)).toBe(revisionTrail(second, LIMITS, id));
    expect(revisionTrail(plain, LIMITS, id)).not.toBe(revisionTrail(first, LIMITS, id));
  });
});

describe('a write over the revision attributes a character has', () => {
  const { id, items } = itemsOf(
    `<w:p>${INS(7, 'Counterparty')}<w:r><w:t>a</w:t></w:r></w:ins>` +
      `${INS(9, 'Reviewer')}<w:r><w:t>b</w:t></w:r></w:ins>` +
      `${INS(7, 'Counterparty')}${DEL(8, 'Reviewer')}<w:r><w:delText>c</w:delText></w:r></w:del></w:ins>` +
      `<w:r><w:t>d</w:t></w:r></w:p>`
  );
  const [theirs, mine, struckTheirs, plain] = items.map((item) =>
    encodeAttributes(item, id, LIMITS)
  ) as [
    Record<string, string>,
    Record<string, string>,
    Record<string, string>,
    Record<string, string>,
  ];
  const revisionKeysOf = (attributes: Readonly<Record<string, string>>) =>
    Object.keys(attributes).filter((key) => key.startsWith(REVISION_PREFIX));

  test('typed inside their insertion, keeps their attribute and names it as superseded', () => {
    const written = rebaseRevisions(theirs, mine, true, LIMITS, id);
    const [theirKey] = revisionKeysOf(theirs);
    // Their attribute goes in unchanged, so the insert writes no marker for it.
    expect(written[theirKey!]).toBe(theirs[theirKey!]!);
    expect(JSON.parse(written[SUPERSEDED_KEY]!)).toEqual([theirKey!.slice(REVISION_PREFIX.length)]);
    expect(chainOf(decodeAttributes(written, LIMITS, id))).toEqual(['ins:Reviewer']);
    // The next keystroke takes the same attributes from its left, and writes nothing new.
    expect(rebaseRevisions(written, mine, true, LIMITS, id)).toEqual(written);
  });

  test('typed into plain text, takes the attributes the editor encodes', () => {
    expect(rebaseRevisions(plain, mine, true, LIMITS, id)).toBe(mine);
  });

  test('accepting their insertion removes only their attribute', () => {
    const written = rebaseRevisions(theirs, plain, false, LIMITS, id);
    expect(revisionKeysOf(written)).toEqual([]);
    expect(written[SUPERSEDED_KEY]).toBeUndefined();
  });

  test('striking their inserted text keeps their attribute and adds one inside it', () => {
    const written = rebaseRevisions(theirs, struckTheirs, false, LIMITS, id);
    const [theirKey] = revisionKeysOf(theirs);
    expect(written[theirKey!]).toBe(theirs[theirKey!]!);
    expect(revisionKeysOf(written)).toHaveLength(2);
    expect(chainOf(decodeAttributes(written, LIMITS, id))).toEqual([
      'ins:Counterparty',
      'del:Reviewer',
    ]);
  });

  test('a piece of their insertion under another wrapper ID keeps its attributes', () => {
    // The editor gives the half of a split insertion a new wrapper ID.
    const [theirKey] = revisionKeysOf(theirs);
    const { [theirKey!]: value, ...rest } = theirs;
    const data = JSON.parse(value!) as { e: { i: string } };
    const renamed = {
      ...rest,
      [`${REVISION_PREFIX}other`]: JSON.stringify({ ...data, e: { ...data.e, i: 'other' } }),
    };
    expect(rebaseRevisions(theirs, renamed, false, LIMITS, id)).toEqual(theirs);
  });

  test('accepting their insertion leaves the attribute of a deletion nested in it unchanged', () => {
    const [theirKey, deletionKey] = revisionKeysOf(struckTheirs).sort(
      (left, right) => JSON.parse(struckTheirs[left]!).d - JSON.parse(struckTheirs[right]!).d
    );
    const { [theirKey!]: _theirs, ...onlyDeletion } = struckTheirs;
    // The tree no longer names their insertion outside the deletion.
    const data = JSON.parse(onlyDeletion[deletionKey!]!) as Record<string, unknown>;
    const wanted = { ...onlyDeletion, [deletionKey!]: JSON.stringify({ ...data, d: 1, o: [] }) };
    const written = rebaseRevisions(struckTheirs, wanted, false, LIMITS, id);
    expect(written[theirKey!]).toBeUndefined();
    // A concurrent decision on the deletion sets this attribute; the accept must not.
    expect(written[deletionKey!]).toBe(struckTheirs[deletionKey!]!);
    expect(chainOf(decodeAttributes(written, LIMITS, id))).toEqual(['del:Reviewer']);
  });

  test('text two authors extend in turn belongs only to the newest turn, however many turns', () => {
    const [mineKey] = revisionKeysOf(mine);
    const { [mineKey!]: mineValue, ...rest } = mine;
    const template = JSON.parse(mineValue!) as { e: Record<string, unknown> };
    // Each turn is another revision: its own wrapper ID and its own w:id.
    const turn = (index: number): Record<string, string> => ({
      ...rest,
      [`${REVISION_PREFIX}turn${index}`]: JSON.stringify({
        ...template,
        e: {
          ...template.e,
          i: `turn${index}`,
          a: [
            ['id', String(1000 + index)],
            ['author', index % 2 ? 'Reviewer' : 'Counterparty'],
          ],
        },
      }),
    });
    let left: Readonly<Record<string, string>> = theirs;
    for (let index = 0; index < 600; index += 1) {
      left = rebaseRevisions(left, turn(index), true, LIMITS, id);
      const chain = chainOf(decodeAttributes(left, LIMITS, id));
      expect(chain).toEqual([index % 2 ? 'ins:Reviewer' : 'ins:Counterparty']);
    }
    expect((JSON.parse(left[SUPERSEDED_KEY]!) as unknown[]).length).toBeLessThanOrEqual(512);
  });

  test('a superseded list longer than the cap keeps its first entries', () => {
    const typed = rebaseRevisions(theirs, mine, true, LIMITS, id);
    const [theirKey] = revisionKeysOf(theirs);
    const long = JSON.stringify([
      theirKey!.slice(REVISION_PREFIX.length),
      ...Array.from({ length: 100 }, (_, at) => `gone${at}`),
    ]);
    expect(chainOf(decodeAttributes({ ...typed, [SUPERSEDED_KEY]: long }, LIMITS, id))).toEqual([
      'ins:Reviewer',
    ]);
  });

  test('a link added around their insertion keeps their attribute as stored', () => {
    // Leading runs keep the stored insertion's ID apart from the link's: both paragraphs
    // number their children from the same paragraph ID.
    const linked = itemsOf(
      `<w:p><w:r><w:t>y</w:t></w:r><w:r><w:t>z</w:t></w:r><w:hyperlink w:anchor="a">${INS(7, 'Counterparty')}<w:r><w:t>a</w:t></w:r></w:ins></w:hyperlink></w:p>`
    );
    const have = encodeAttributes(
      itemsOf(
        `<w:p><w:r><w:t>z</w:t></w:r>${INS(7, 'Counterparty')}<w:r><w:t>a</w:t></w:r></w:ins></w:p>`
      ).items[1]!,
      linked.id,
      LIMITS
    );
    const wanted = encodeAttributes(linked.items[2]!, linked.id, LIMITS);
    const written = rebaseRevisions(have, wanted, false, LIMITS, linked.id);
    // A concurrent accept of their insertion sets this attribute; the link write must not.
    const [theirKey] = revisionKeysOf(have);
    expect(written[theirKey!]).toBe(have[theirKey!]!);
    // Every wrapper stays; only the insertion's nesting among them can differ from the tree.
    expect(new Set(chainOf(decodeAttributes(written, LIMITS, linked.id)))).toEqual(
      new Set(['hyperlink', 'ins:Counterparty'])
    );
  });

  test('typed text never writes their kept attribute again, even where a link starts', () => {
    // Their insertion continues into a link; the typed character lands inside the link.
    const linked = itemsOf(
      `<w:p><w:r><w:t>y</w:t></w:r><w:r><w:t>z</w:t></w:r><w:hyperlink w:anchor="a">${INS(7, 'Counterparty')}<w:r><w:t>a</w:t></w:r></w:ins></w:hyperlink></w:p>`
    );
    const left = encodeAttributes(
      itemsOf(
        `<w:p><w:r><w:t>z</w:t></w:r>${INS(7, 'Counterparty')}<w:r><w:t>a</w:t></w:r></w:ins></w:p>`
      ).items[1]!,
      linked.id,
      LIMITS
    );
    const written = rebaseRevisions(
      left,
      encodeAttributes(linked.items[2]!, linked.id, LIMITS),
      true,
      LIMITS,
      linked.id
    );
    const [theirKey] = revisionKeysOf(left);
    expect(written[theirKey!]).toBe(left[theirKey!]!);
  });

  test('an empty element keeps its content key when it holds a revision it does not belong to', () => {
    const empty = itemsOf(
      `<w:p>${INS(7, 'Counterparty')}<w:r><w:t>a</w:t></w:r></w:ins><w:r/></w:p>`
    );
    const theirLetter = encodeAttributes(empty.items[0]!, empty.id, LIMITS);
    const anchor = encodeAttributes(empty.items[1]!, empty.id, LIMITS);
    const stored = rebaseRevisions(theirLetter, anchor, true, LIMITS, empty.id);
    expect(stored).not.toEqual(anchor);
    const keyOf = (attributes: Readonly<Record<string, string>>) => {
      const text = new Y.Doc().getText('inline');
      text.insertEmbed(0, { a: 1 }, { ...attributes });
      return tokensOfText(text, undefined, { limits: LIMITS, paragraphId: empty.id })[0]!.key;
    };
    expect(keyOf(stored)).toBe(keyOf(anchor));
  });

  test('a superseded revision stays out after the revision that superseded it is accepted', () => {
    const typed = rebaseRevisions(theirs, mine, true, LIMITS, id);
    const accepted = rebaseRevisions(typed, plain, false, LIMITS, id);
    expect(decodeAttributes(accepted, LIMITS, id).wrap).toEqual([]);
  });
});

describe('revision values a peer wrote', () => {
  const { id, items } = itemsOf(`<w:p>${INS(1, 'A')}<w:r><w:t>x</w:t></w:r></w:ins></w:p>`);
  const encoded = encodeAttributes(items[0]!, id, LIMITS);
  const [key] = Object.keys(encoded).filter((name) => name.startsWith(REVISION_PREFIX));
  const value = JSON.parse(encoded[key!]!) as Record<string, unknown>;

  const hostile: Record<string, Record<string, string>> = {
    'a value that is not JSON': { [key!]: '{' },
    'an order that is not a whole number': { [key!]: JSON.stringify({ ...value, d: 1.5 }) },
    'a missing order': { [key!]: JSON.stringify({ ...value, d: undefined }) },
    'an element that is not a revision': {
      [key!]: JSON.stringify({ ...value, e: { ...(value.e as object), l: 'hyperlink' } }),
    },
    'a prototype key as the wrapper ID': {
      [key!]: JSON.stringify({ ...value, e: { ...(value.e as object), i: '__proto__' } }),
    },
  };

  for (const [name, change] of Object.entries(hostile))
    test(`ignores ${name}, and keeps the character's run and text`, () => {
      const { [key!]: _revision, ...rest } = encoded;
      const read = decodeAttributes({ ...rest, ...change }, LIMITS, id);
      expect(read.wrap).toEqual([]);
      expect(read.run).not.toBeNull();
      expect(read.text).not.toBeNull();
    });

  test('a trail reads no more revisions than a reader does', () => {
    const many: Record<string, string> = {};
    for (let at = 0; at < 200; at += 1) many[`${REVISION_PREFIX}x${at}`] = encoded[key!]!;
    expect(JSON.parse(revisionTrail(many, LIMITS, id))).toHaveLength(24);
    expect(revisionTrail({ [key!]: 'x'.repeat(1 << 17) }, LIMITS, id)).toBe('[]');
  });

  test('keys that do not read never push out a revision that does', () => {
    const junk: Record<string, string> = {};
    // More junk keys than a character holds superseded revisions, all sorting first.
    for (let at = 0; at < 600; at += 1) junk[`${REVISION_PREFIX}!!!${at}`] = '{';
    expect(chainOf(decodeAttributes({ ...encoded, ...junk }, LIMITS, id))).toEqual(['ins:A']);
  });

  test('a decision keeps a superseded list a peer wrote in another form', () => {
    const unsorted = JSON.stringify(['zz', 'aa', 'zz']);
    const written = rebaseRevisions(
      { ...encoded, [SUPERSEDED_KEY]: unsorted },
      { ...encoded },
      false,
      LIMITS,
      id
    );
    expect(written[SUPERSEDED_KEY]).toBe(unsorted);
  });

  test('a superseded list that does not parse supersedes nothing', () => {
    for (const superseded of ['{', '"x"', JSON.stringify([1, {}])]) {
      const read = decodeAttributes({ ...encoded, [SUPERSEDED_KEY]: superseded }, LIMITS, id);
      expect(chainOf(read)).toEqual(['ins:A']);
    }
  });
});
