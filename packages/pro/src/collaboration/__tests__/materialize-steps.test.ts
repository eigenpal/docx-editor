/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Pure steps of a rebuild, tested on their own: the spine rebuild of an unchanged parent, the
// content type of a part whose override a concurrent undo removed, and the text diff that
// turns a local edit into operations on shared text.

import { describe, expect, test } from 'bun:test';
import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { asLogicalId, type LogicalId } from '../document/identity.ts';
import { spineChildren, type SpineContext } from '../document/materialize-spine.ts';
import { typeUntypedParts } from '../document/materialize-rescued-parts.ts';
import { diffTokens, type Token } from '../document/paragraph-text-diff.ts';
import { elementFrom, emptyWmlElement } from '../document/node-shapes.ts';

const leaf = (id: string): OoxmlNode => emptyWmlElement(id, 'paragraph', 'p');

function spineOf(ids: readonly string[]) {
  const children = ids.map(leaf);
  const parent = elementFrom({
    id: 'body',
    kind: 'body',
    namespaceUri: '',
    localName: 'body',
    namespaceBindings: [],
    attributes: [],
    children,
  });
  const cached = new Set<OoxmlNode>(children);
  const context = (overrides: Partial<SpineContext> = {}): SpineContext => ({
    dirty: new Set<LogicalId>(),
    placed: new Set<LogicalId>(),
    isCached: (child) => cached.has(child),
    canRebuild: () => true,
    rebuild: (id) => leaf(id),
    ...overrides,
  });
  return { parent, children, context };
}

describe('spine rebuild of one child list', () => {
  test('with no dirty child it keeps the list and places every child', () => {
    const { parent, context } = spineOf(['a', 'b', 'c']);
    const placed = new Set<LogicalId>();
    const result = spineChildren(parent, context({ placed }));
    expect(result?.children).toBe(parent.children);
    expect(result?.dropped).toEqual([]);
    expect([...placed]).toEqual(['a', 'b', 'c'].map(asLogicalId));
  });

  test('a dirty child is rebuilt in place and the rest stay the same objects', () => {
    const { parent, children, context } = spineOf(['a', 'b', 'c']);
    const rebuilt = leaf('b');
    const result = spineChildren(
      parent,
      context({ dirty: new Set([asLogicalId('b')]), rebuild: () => rebuilt })
    );
    expect(result?.children).toEqual([children[0], rebuilt, children[2]]);
    expect(result?.children[0]).toBe(children[0]!);
    expect(Object.isFrozen(result?.children)).toBe(true);
  });

  test('a dirty child that builds to nothing leaves the list as dropped', () => {
    const { parent, children, context } = spineOf(['a', 'b']);
    const result = spineChildren(
      parent,
      context({ dirty: new Set([asLogicalId('a')]), rebuild: () => null })
    );
    expect(result?.children).toEqual([children[1]]);
    expect(result?.dropped).toEqual([asLogicalId('a')]);
  });

  for (const [name, overrides] of [
    ['a child placed elsewhere', { placed: new Set([asLogicalId('b')]) }],
    ['a child the cache no longer holds', { isCached: () => false }],
    [
      'a dirty child that cannot rebuild',
      { dirty: new Set([asLogicalId('a')]), canRebuild: () => false },
    ],
  ] as const) {
    test(`${name} refuses before changing anything`, () => {
      const { parent, context } = spineOf(['a', 'b']);
      const built = context(overrides);
      const placedBefore = [...built.placed];
      let rebuilds = 0;
      const result = spineChildren(parent, {
        ...built,
        rebuild: (id) => {
          rebuilds += 1;
          return leaf(id);
        },
      });
      expect(result).toBeNull();
      expect([...built.placed]).toEqual(placedBefore);
      expect(rebuilds).toBe(0);
    });
  }
});

describe('content type of a part the index does not type', () => {
  const COMMENTS = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
  const part = (name: string, contentType: string): [string, OoxmlPart] => [
    name,
    { id: name, name, contentType, root: emptyWmlElement(`${name}#root`, 'generic', 'comments') },
  ];

  test('a part with no override and no default takes its entry type', () => {
    const overrides = new Map<string, string>();
    typeUntypedParts(
      new Map([part('/word/comments.xml', COMMENTS)]),
      {
        defaults: new Map(),
        overrides,
      },
      overrides
    );
    expect(overrides.get('/word/comments.xml')).toBe(COMMENTS);
  });

  test('a default of another type gives way to the entry type', () => {
    const overrides = new Map<string, string>();
    typeUntypedParts(
      new Map([part('/word/comments.xml', COMMENTS)]),
      {
        defaults: new Map([['xml', 'application/xml']]),
        overrides,
      },
      overrides
    );
    expect(overrides.get('/word/comments.xml')).toBe(COMMENTS);
  });

  test('an override or a matching default stays as it is', () => {
    const overrides = new Map([['/word/comments.xml', 'application/xml']]);
    typeUntypedParts(
      new Map([part('/word/comments.xml', COMMENTS), part('/word/data.xml', 'application/xml')]),
      { defaults: new Map([['xml', 'application/xml']]), overrides },
      overrides
    );
    expect([...overrides]).toEqual([['/word/comments.xml', 'application/xml']]);
  });
});

describe('text diff of a paragraph', () => {
  /** Characters of `text`, each in the text element `element`. */
  const chars = (text: string, element: string): Token[] =>
    [...text].map((character) => ({
      key: `c${character}`,
      strong: `c${character}\u0000${element}`,
      insert: character,
      attributes: { t: element },
    }));
  const ops = (before: Token[], after: Token[]) => diffTokens(before, after).map((step) => step.op);

  test('an unchanged paragraph is all equal', () => {
    expect(ops(chars('abc', 't1'), chars('abc', 't1'))).toEqual(['eq', 'eq', 'eq']);
  });

  test('typing in the middle inserts between equal ends', () => {
    expect(
      ops(chars('ac', 't1'), [...chars('a', 't1'), ...chars('b', 't1'), ...chars('c', 't1')])
    ).toEqual(['eq', 'ins', 'eq']);
  });

  test('deleting a word keeps the next word that starts with the same letters', () => {
    const before = [...chars('ab ', 't1'), ...chars('ab', 't2')];
    const after = chars('ab', 't2');
    const steps = diffTokens(before, after);
    expect(steps.map((step) => step.op)).toEqual(['del', 'del', 'del', 'eq', 'eq']);
    expect(steps.filter((step) => step.op === 'eq').map((step) => step.before)).toEqual([3, 4]);
  });

  test('a run rewritten in a new text element keeps its letters', () => {
    expect(ops(chars('abc', 't1'), chars('abc', 't9'))).toEqual(['eq', 'eq', 'eq']);
  });

  test('runs merged into one text element keep every letter', () => {
    // A join merges two runs with equal formatting: the same letters, in one element now.
    // The joined paragraph's text follows, so no common end shortens the alignment.
    const before = [...chars('lore', 'x'), ...chars('lo', 'h'), ...chars('itor', 'h')];
    const after = [...chars('loreloitor', 'h'), ...chars('Total', 'z')];
    expect(ops(before, after)).toEqual([
      ...Array.from({ length: 10 }, () => 'eq' as const),
      ...Array.from({ length: 5 }, () => 'ins' as const),
    ]);
  });

  test('markers placed around kept letters change only the markers', () => {
    // A comment's range goes in around text that a new text element now holds.
    const marker = (name: string): Token => ({
      key: `e${name}`,
      strong: `e${name}`,
      insert: { n: name },
      attributes: {},
    });
    const before = chars('abcd', 't1');
    const after = [marker('start'), ...chars('ab', 't2'), marker('end'), ...chars('cd', 't3')];
    expect(ops(before, after)).toEqual(['ins', 'eq', 'eq', 'ins', 'eq', 'eq']);
  });

  test('an embed removed before reformatted letters keeps the letters', () => {
    // A field mark goes, and the letters after it land in a new text element: they are the
    // same letters, so they keep their identities for a peer who moves them meanwhile.
    const mark: Token = { key: 'emark', strong: 'emark', insert: { n: 'mark' }, attributes: {} };
    const before = [...chars('ab', 't1'), mark, ...chars('cd', 't2'), ...chars('xy', 't3')];
    const after = [...chars('ab', 't1'), ...chars('cd', 't4'), ...chars('y', 't3')];
    expect(ops(before, after)).toEqual(['eq', 'eq', 'del', 'eq', 'eq', 'del', 'eq']);
  });

  test('new text does not keep scattered letters of text it replaces', () => {
    expect(ops(chars('xyz', 't1'), chars('axb', 't2'))).not.toContain('eq');
  });

  test('a word replaced in its own text element keeps none of its letters', () => {
    // "new" and "changed" share "n" and "e". Kept, they scattered the old word through the
    // new one, and a peer deleting the old word meanwhile left "chagd".
    const steps = diffTokens(chars('old new tail', 't1'), chars('old changed tail', 't1'));
    const kept = steps.filter((step) => step.op === 'eq').map((step) => step.before);
    expect(kept).toEqual([0, 1, 2, 3, 7, 8, 9, 10, 11]);
  });

  test('typing inside a word keeps the letters around it', () => {
    expect(ops(chars('word', 't1'), chars('wo-rd', 't1'))).toEqual(['eq', 'eq', 'ins', 'eq', 'eq']);
  });
});
