/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import { describe, expect, spyOn, test } from 'bun:test';
import type {
  CanonicalPrimitiveEffect,
  CanonicalPrimitiveJournal,
} from '@docx-editor.dev/core/collaboration/replication';
import { DEFAULT_DOCUMENT_LIMITS, type DocumentLimits } from '../document/limits.ts';
import { JournalProjection, projectEffect } from '../document/journal-projection.ts';
import { projectJournalToShared } from '../document/projected-journal.ts';
import type { NodeShape } from '../document/registry-node-reads.ts';
import { DocumentRegistry } from '../document/registry.ts';
import { applyPrimitiveJournal } from '../document/journal.ts';
import { projectedTextTarget } from '../document/projected-text-target.ts';

function fixture(limits: Partial<DocumentLimits> = {}) {
  const hidden = new Set(['hidden']);
  const nodes = new Map<string, NodeShape>([
    ['p', { isText: false, textLength: 0, children: ['a', 'hidden', 'b', 'c'] }],
    ['q', { isText: false, textLength: 0, children: ['d'] }],
    ['text', { isText: true, textLength: 3, children: [] }],
    ...['a', 'hidden', 'b', 'c', 'd'].map((id): [string, NodeShape] => [
      id,
      { isText: false, textLength: 0, children: [] },
    ]),
  ]);
  // The projection consumes these read-only registry methods. Fresh shapes are essential:
  // a refused composed journal must never mutate the backing records while validating.
  const registry = {
    limits: { ...DEFAULT_DOCUMENT_LIMITS, ...limits },
    replacementLoserRuns: () => hidden,
    nodeCount: () => nodes.size,
    splitTextRange: () => null,
    kindOf: (id: string) => (nodes.get(id)?.isText ? 'textValue' : 'element'),
    hasNode: (id: string) => nodes.has(id),
    nodeShape: (id: string) => {
      const node = nodes.get(id);
      return node ? { ...node, children: [...node.children] } : null;
    },
    parentOf: (id: string) =>
      [...nodes].find(([, node]) => node.children.includes(id))?.[0] ?? null,
  } as unknown as DocumentRegistry;
  return { registry, nodes };
}

function splice(
  parentLogicalId: string,
  start: number,
  deleteCount: number,
  childLogicalIds: readonly string[] = []
): CanonicalPrimitiveEffect {
  return { kind: 'spliceChildren', parentLogicalId, start, deleteCount, childLogicalIds };
}

function projected(registry: DocumentRegistry, effects: readonly CanonicalPrimitiveEffect[]) {
  const result = projectJournalToShared(registry, { effects });
  if (!result.ok) throw new Error(result.code);
  const scratch = new JournalProjection(registry);
  for (const effect of result.journal.effects) projectEffect(scratch, effect);
  return { effects: result.journal.effects, scratch };
}

describe('visible journal coordinates after concurrent splits', () => {
  test('deletes separated visible ranges without touching the hidden branch, then composes later edits', () => {
    const { registry, nodes } = fixture();
    const before = JSON.stringify([...nodes]);
    const { effects, scratch } = projected(registry, [splice('p', 0, 2, ['d']), splice('p', 1, 1)]);
    expect(effects).toEqual([splice('p', 2, 1), splice('p', 0, 1, ['d']), splice('p', 2, 1)]);
    expect(scratch.node('p')?.children).toEqual(['d', 'hidden']);
    expect(JSON.stringify([...nodes])).toBe(before);
  });

  test('same-parent and cross-parent moves use positions after unlinking the source', () => {
    const { registry } = fixture();
    const { scratch } = projected(registry, [
      { kind: 'moveNode', logicalId: 'a', destinationParentLogicalId: 'p', destinationIndex: 2 },
      { kind: 'moveNode', logicalId: 'd', destinationParentLogicalId: 'p', destinationIndex: 1 },
      { kind: 'moveNode', logicalId: 'c', destinationParentLogicalId: 'q', destinationIndex: 0 },
      splice('p', 1, 1),
    ]);
    expect(scratch.node('p')?.children).toEqual(['hidden', 'b', 'a']);
    expect(scratch.node('q')?.children).toEqual(['c']);
  });

  test('new text nodes and edits to their lengths compose within one journal', () => {
    const { registry } = fixture({ maxTextLength: 4 });
    const { scratch } = projected(registry, [
      { kind: 'putNode', descriptor: { kind: 'textValue', logicalId: 'new-text' } },
      { kind: 'spliceText', logicalId: 'new-text', utf16Start: 0, deleteCount: 0, insert: 'abcd' },
      { kind: 'spliceText', logicalId: 'new-text', utf16Start: 1, deleteCount: 3, insert: 'X' },
      splice('a', 0, 0, ['new-text']),
    ]);
    expect(scratch.node('new-text')?.textLength).toBe(2);
    expect(scratch.node('a')?.children).toEqual(['new-text']);
  });
});

describe('projection refuses before allocating or changing shared state', () => {
  test('oversized child insertion reaches the limit refusal before spreading the array', () => {
    const { registry, nodes } = fixture();
    const before = JSON.stringify([...nodes]);
    // This exceeds V8's function argument limit. Replaying before validation throws in the
    // browser even though Bun permits the spread; the limit must be checked first everywhere.
    expect(
      projectJournalToShared(registry, {
        effects: [splice('p', 0, 0, Array<string>(200_000).fill('a'))],
      })
    ).toEqual({ ok: false, code: 'too-many-children' });
    expect(JSON.stringify([...nodes])).toBe(before);
  });

  test('hidden children still count against the shared child limit', () => {
    const { registry } = fixture({ maxChildren: 4 });
    expect(projectJournalToShared(registry, { effects: [splice('p', 3, 0, ['d'])] })).toEqual({
      ok: false,
      code: 'too-many-children',
    });
  });

  test('node and text limits return their existing typed refusals', () => {
    const nodes = fixture({ maxNodes: 8 });
    expect(
      projectJournalToShared(nodes.registry, {
        effects: [{ kind: 'putNode', descriptor: { kind: 'textValue', logicalId: 'new' } }],
      })
    ).toEqual({ ok: false, code: 'too-many-nodes' });
    const text = fixture({ maxTextLength: 4 });
    expect(
      projectJournalToShared(text.registry, {
        effects: [
          { kind: 'spliceText', logicalId: 'text', utf16Start: 3, deleteCount: 0, insert: 'xy' },
        ],
      })
    ).toEqual({ ok: false, code: 'text-too-long' });
  });

  test('an invalid later visible bound refuses the whole journal without writing earlier effects', () => {
    const { registry, nodes } = fixture();
    const before = JSON.stringify([...nodes]);
    const journal: CanonicalPrimitiveJournal = {
      effects: [splice('p', 0, 1), splice('p', 2, 1)],
    };
    expect(projectJournalToShared(registry, journal)).toMatchObject({
      ok: false,
      code: 'invalid-bound',
    });
    expect(JSON.stringify([...nodes])).toBe(before);
  });

  test('unknown children are refused before scratch insertion', () => {
    const { registry } = fixture();
    expect(projectJournalToShared(registry, { effects: [splice('p', 0, 0, ['missing'])] })).toEqual(
      {
        ok: false,
        code: 'unknown-logical-id',
        detail: 'missing',
      }
    );
  });
});

function sourceFixture() {
  const doc = new Y.Doc();
  const registry = new DocumentRegistry(doc);
  registry.putText('source', 'abcdefghij');
  registry.putText('left', 'abcde');
  registry.putText('right', 'fghij');
  registry.registerSplitText('left', 'source', 0, 5);
  registry.registerSplitText('right', 'source', 5, 10);
  return { doc, registry };
}
function textSplice(
  logicalId: string,
  utf16Start: number,
  deleteCount: number,
  insert: string
): CanonicalPrimitiveEffect {
  return { kind: 'spliceText', logicalId, utf16Start, deleteCount, insert };
}

describe('projected source text journal coordinates', () => {
  test('validates grown visible slices with no hidden runs and keeps source ownership', () => {
    const { doc, registry } = sourceFixture();
    try {
      registry.spliceText('source', 8, 0, 'GROW');
      const result = projectJournalToShared(registry, {
        effects: [textSplice('right', 8, 0, 'X')],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.journal.effects).toEqual([textSplice('source', 13, 0, 'X')]);
      expect(projectedTextTarget(result.journal.effects[0]!)).toEqual({
        logicalId: 'right',
        utf16Start: 8,
      });
      expect(applyPrimitiveJournal(registry, result.journal).ok).toBe(true);
      expect(registry.projectedTextValue('right')).toBe('fghGROWiXj');
    } finally {
      registry.destroy();
      doc.destroy();
    }
  });

  test('sequential edits across aliased siblings follow the shifted source ranges', () => {
    const { doc, registry } = sourceFixture();
    try {
      const result = projectJournalToShared(registry, {
        effects: [
          textSplice('left', 2, 0, 'XX'),
          textSplice('right', 2, 1, 'Y'),
          textSplice('left', 1, 2, ''),
          textSplice('right', 4, 0, 'Z'),
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.journal.effects).toEqual([
        textSplice('source', 2, 0, 'XX'),
        textSplice('source', 9, 1, 'Y'),
        textSplice('source', 1, 2, ''),
        textSplice('source', 9, 0, 'Z'),
      ]);
      expect(applyPrimitiveJournal(registry, result.journal).ok).toBe(true);
      expect(registry.projectedTextValue('left')).toBe('aXcde');
      expect(registry.projectedTextValue('right')).toBe('fgYiZj');
    } finally {
      registry.destroy();
      doc.destroy();
    }
  });

  test('rejects a visible bound despite longer shared source text without writing earlier edits', () => {
    const { doc, registry } = sourceFixture();
    try {
      const before = Y.encodeStateAsUpdate(doc);
      expect(
        projectJournalToShared(registry, {
          effects: [textSplice('left', 1, 0, 'X'), textSplice('right', 6, 0, 'Y')],
        })
      ).toMatchObject({ ok: false, code: 'invalid-bound' });
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    } finally {
      registry.destroy();
      doc.destroy();
    }
  });

  test('compound right-boundary insertion retains the intended slice for later edits', () => {
    const { doc, registry } = sourceFixture();
    try {
      const result = projectJournalToShared(registry, {
        effects: [
          textSplice('right', 0, 0, 'XX'),
          textSplice('right', 1, 1, 'Y'),
          textSplice('left', 5, 0, 'L'),
          textSplice('right', 2, 0, 'Z'),
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.journal.effects).toEqual([
        textSplice('source', 5, 0, 'XX'),
        textSplice('source', 6, 1, 'Y'),
        textSplice('source', 5, 0, 'L'),
        textSplice('source', 8, 0, 'Z'),
      ]);
      expect(applyPrimitiveJournal(registry, result.journal).ok).toBe(true);
      expect(registry.projectedTextValue('left')).toBe('abcdeL');
      expect(registry.projectedTextValue('right')).toBe('XYZfghij');
    } finally {
      registry.destroy();
      doc.destroy();
    }
  });

  test('a left-end insertion after deleting the right boundary character retains left formatting', () => {
    const { doc, registry } = sourceFixture();
    try {
      registry.spliceText('right', 0, 1, '');
      registry.spliceText('left', 5, 0, 'X');
      expect(registry.projectedTextValue('left')).toBe('abcdeX');
      expect(registry.projectedTextValue('right')).toBe('ghij');
    } finally {
      registry.destroy();
      doc.destroy();
    }
  });

  test('compound range transforms match Yjs across insertions and deletion boundaries', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const initial = sourceFixture();
      const reference = sourceFixture();
      let random = seed;
      const next = (limit: number) => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random % limit;
      };
      try {
        const input: CanonicalPrimitiveEffect[] = [];
        const expected: CanonicalPrimitiveEffect[] = [];
        for (let index = 0; index < 15; index += 1) {
          const id = next(2) === 0 ? 'left' : 'right';
          const range = reference.registry.splitTextRange(id)!;
          const offset = next(range.end - range.start + 1);
          const deleted = next(Math.min(3, range.end - range.start - offset) + 1);
          const insert = next(3) === 0 ? '' : 'X'.repeat(next(3) + 1);
          input.push(textSplice(id, offset, deleted, insert));
          expected.push(textSplice('source', range.start + offset, deleted, insert));
          reference.registry.spliceText(id, offset, deleted, insert);
        }
        const result = projectJournalToShared(initial.registry, { effects: input });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.journal.effects).toEqual(expected);
      } finally {
        initial.registry.destroy();
        initial.doc.destroy();
        reference.registry.destroy();
        reference.doc.destroy();
      }
    }
  });

  test('live source boundaries project compound inserts and interior replacements without cloning', () => {
    const { doc, registry } = sourceFixture();
    const encoded = spyOn(Y, 'encodeStateAsUpdate');
    try {
      const result = projectJournalToShared(registry, {
        effects: [
          textSplice('left', 2, 1, 'XX'),
          textSplice('right', 0, 0, 'Y'),
          textSplice('right', 3, 1, 'Z'),
          textSplice('left', 3, 0, 'A'),
        ],
      });
      expect(result.ok).toBe(true);
      expect(encoded).not.toHaveBeenCalled();
      if (result.ok) expect(applyPrimitiveJournal(registry, result.journal).ok).toBe(true);
    } finally {
      encoded.mockRestore();
      registry.destroy();
      doc.destroy();
    }
  });

  test('deleting a boundary anchor uses one exact shadow for the rest of the compound journal', () => {
    const { doc, registry } = sourceFixture();
    const encoded = spyOn(Y, 'encodeStateAsUpdate');
    try {
      const result = projectJournalToShared(registry, {
        effects: [
          textSplice('right', 0, 1, ''),
          textSplice('left', 5, 0, 'X'),
          textSplice('right', 1, 0, 'Y'),
        ],
      });
      expect(result.ok).toBe(true);
      expect(encoded).toHaveBeenCalledTimes(1);
      if (result.ok) expect(applyPrimitiveJournal(registry, result.journal).ok).toBe(true);
    } finally {
      encoded.mockRestore();
      registry.destroy();
      doc.destroy();
    }
  });

  test('empty split products inherit the exact source outer endpoints', () => {
    for (const edge of ['prefix', 'suffix']) {
      const { doc, registry } = sourceFixture();
      try {
        // The left slice ends at the deleted f anchor; its leading edge is the source sentinel.
        registry.spliceText('source', 5, 1, '');
        registry.putElement({
          logicalId: 'original',
          kind: 'run',
          namespaceUri: 'urn:test',
          localName: 'r',
          attributes: [],
          bindings: [],
        });
        registry.spliceChildren('original', 0, 0, ['left']);
        registry.putElement({
          logicalId: 'p',
          kind: 'paragraph',
          namespaceUri: 'urn:test',
          localName: 'p',
          attributes: [],
          bindings: [],
        });
        registry.spliceChildren('p', 0, 0, ['original']);
        const effects: CanonicalPrimitiveEffect[] = [];
        for (const [run, id, value] of [
          ['copied-run', 'copied-text', 'abcde'],
          ['empty-run', 'empty-text', ''],
        ]) {
          effects.push(
            {
              kind: 'putNode',
              descriptor: {
                kind: 'run',
                logicalId: run!,
                qname: { namespaceUri: 'urn:test', localName: 'r' },
              },
            },
            { kind: 'putNode', descriptor: { kind: 'textValue', logicalId: id! } },
            textSplice(id!, 0, 0, value!),
            splice(run!, 0, 0, [id!])
          );
        }
        effects.push(
          splice(
            'p',
            0,
            1,
            edge === 'prefix' ? ['empty-run', 'copied-run'] : ['copied-run', 'empty-run']
          ),
          textSplice('source', 0, 0, 'X'),
          textSplice('empty-text', edge === 'prefix' ? 1 : 0, 0, '')
        );
        const result = projectJournalToShared(registry, { effects });
        if (edge === 'prefix') {
          // Both prefix endpoints inherit the start sentinel: prepending never fills it.
          expect(result).toMatchObject({ ok: false, code: 'invalid-bound', detail: 'empty-text' });
        } else {
          expect(result.ok).toBe(true);
          if (!result.ok) continue;
          expect(result.journal.effects.at(-1)).toEqual(textSplice('source', 6, 0, ''));
          expect(applyPrimitiveJournal(registry, result.journal).ok).toBe(true);
          expect(registry.projectedTextValue('empty-text')).toBe('');
          expect(registry.splitTextRange('empty-text')).toMatchObject({
            startAnchorDeleted: true,
            endAnchorDeleted: true,
          });
        }
      } finally {
        registry.destroy();
        doc.destroy();
      }
    }
  });

  test('maps text aliases minted by an earlier split in the same journal', () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    const element = (logicalId: string, kind: string, childIds: string[]) => {
      registry.putElement({
        logicalId,
        kind,
        namespaceUri: 'urn:test',
        localName: kind,
        prefix: '',
        attributes: [],
        bindings: [],
      });
      registry.spliceChildren(logicalId, 0, 0, childIds);
    };
    try {
      registry.putText('source', 'abcdefghij');
      element('original', 'run', ['source']);
      element('p', 'paragraph', ['original']);
      const effects: CanonicalPrimitiveEffect[] = [];
      for (const [run, text, value] of [
        ['new-left', 'left-text', 'abcde'],
        ['new-right', 'right-text', 'fghij'],
      ]) {
        effects.push(
          {
            kind: 'putNode',
            descriptor: {
              kind: 'run',
              logicalId: run!,
              qname: { namespaceUri: 'urn:test', localName: 'r' },
            },
          },
          { kind: 'putNode', descriptor: { kind: 'textValue', logicalId: text! } },
          textSplice(text!, 0, 0, value!),
          splice(run!, 0, 0, [text!])
        );
      }
      effects.push(
        splice('p', 0, 1, ['new-left', 'new-right']),
        textSplice('left-text', 2, 0, 'XX'),
        textSplice('right-text', 1, 0, 'Y')
      );
      const result = projectJournalToShared(registry, { effects });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.journal.effects.slice(-2)).toEqual([
        textSplice('source', 2, 0, 'XX'),
        textSplice('source', 8, 0, 'Y'),
      ]);
      expect(applyPrimitiveJournal(registry, result.journal).ok).toBe(true);
      expect(registry.projectedTextValue('left-text')).toBe('abXXcde');
      expect(registry.projectedTextValue('right-text')).toBe('fYghij');
    } finally {
      registry.destroy();
      doc.destroy();
    }
  });
});
