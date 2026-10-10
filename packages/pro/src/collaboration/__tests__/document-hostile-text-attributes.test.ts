/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A paragraph's shared text carries its runs, properties and wrappers as formatting
// attributes, and a peer writes them. A bad value must cost the formatting, never the
// characters or the room: the text shows as plain text, every replica shows the same, and
// decoding stays bounded.

import { describe, expect, test } from 'bun:test';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { DEFAULT_DOCUMENT_LIMITS } from '../document/limits.ts';
import { attributeSignature, decodeAttributes } from '../document/paragraph-text.ts';
import { collaborationDocx } from './support.ts';
import {
  destroyReplica,
  expectConverged,
  findText,
  joinReplica,
  loadPackage,
  packageOf,
  seedReplica,
  shownParentOf,
  syncOne,
  walk,
} from './document-support.ts';

const RUN = JSON.stringify({ i: 'r' });

function deepJson(depth: number): string {
  let value: unknown = { v: 'x' };
  for (let level = 0; level < depth; level += 1) value = { c: [value] };
  return JSON.stringify(value);
}

/** Attribute sets a peer can write, each wrong in one way. */
const HOSTILE: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'malformed JSON': { r: '{"i":', t: '[' },
  'prototype keys': {
    r: '{"i":"r","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
    ['__proto__']: '{"l":"b"}',
    'p:__proto__': '{"l":"b"}',
    'p:constructor': '{}',
  },
  'deep nesting': { r: RUN, 'p:b': deepJson(10_000) },
  'oversized value': { r: RUN, 'p:b': JSON.stringify({ l: 'b', v: 'x'.repeat(5_000_000) }) },
  'non-string values': { r: 7, rp: { o: [] }, t: ['t'], 'p:b': null },
  'many property keys': {
    r: RUN,
    ...Object.fromEntries(
      Array.from({ length: 20_000 }, (_, index) => [`p:k${index}`, JSON.stringify({ c: [{}] })])
    ),
  },
};

function paragraphText(pkg: ReturnType<typeof packageOf>, paragraphId: string): string {
  let text = '';
  for (const part of pkg.parts.values()) {
    walk(part.root, (node: OoxmlNode) => {
      if (node.id !== paragraphId || node.kind === 'textValue') return;
      walk(node, (inner) => {
        if (inner.kind === 'textValue') text += inner.value;
      });
    });
  }
  return text;
}

describe('hostile formatting attributes in shared text', () => {
  for (const [name, attributes] of Object.entries(HOSTILE)) {
    test(`${name}: decoding stays bounded and pollutes nothing`, () => {
      const decoded = decodeAttributes(attributes, DEFAULT_DOCUMENT_LIMITS, 'paragraph');
      expect(decoded.properties.length).toBeLessThanOrEqual(DEFAULT_DOCUMENT_LIMITS.maxChildren);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    test(`${name}: the characters stay and every replica shows the same`, async () => {
      const author = await seedReplica(loadPackage(collaborationDocx()));
      const receiver = joinReplica(author);
      try {
        const paragraphId = shownParentOf(
          author,
          findText(packageOf(author), 'Alpha paragraph').id,
          'paragraph'
        );
        const text = author.registry.inline.textOf(paragraphId);
        if (!text) throw new Error('paragraph has no shared text');
        author.doc.transact(() => text.format(0, 5, attributes as Record<string, string>));
        expect(() => syncOne(author, receiver)).not.toThrow();
        expect(author.materializer.rebuild().ok).toBe(true);
        for (const replica of [author, receiver]) {
          expect(paragraphText(packageOf(replica), paragraphId)).toBe('Alpha paragraph');
        }
        expectConverged(author, receiver);
        const cold = joinReplica(receiver, 3);
        try {
          expectConverged(receiver, cold);
        } finally {
          destroyReplica(cold);
        }
      } finally {
        destroyReplica(receiver);
        destroyReplica(author);
      }
    });
  }
});

describe('attribute sets a peer shapes to look like others', () => {
  // Under a joined signature, a separator inside a value made these two sets one cache entry,
  // so whichever decoded first was shown for both.
  const plain = { r: RUN, 'p:b': '{}' };
  const shaped = { 'p:b': `{}\u0001r\u0000${RUN}` };

  test('different sets give different signatures', () => {
    expect(attributeSignature(plain)).not.toBe(attributeSignature(shaped));
    expect(attributeSignature({ a: '1' })).not.toBe(
      attributeSignature({ a: 1 } as unknown as Record<string, string>)
    );
    expect(attributeSignature({ b: 'x', a: 'y' })).toBe(attributeSignature({ a: 'y', b: 'x' }));
  });

  test('a shaped set decoded first does not decide how the real set reads', () => {
    const limits = { ...DEFAULT_DOCUMENT_LIMITS };
    const shapedFirst = decodeAttributes(shaped, limits, 'paragraph');
    const real = decodeAttributes(plain, limits, 'paragraph');
    expect(shapedFirst.run).toBeNull();
    expect(real.run).not.toBeNull();
    expect(real.properties).toHaveLength(1);
  });
});
