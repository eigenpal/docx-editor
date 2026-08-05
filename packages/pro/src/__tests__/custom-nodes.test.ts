/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Custom nodes: the tag codec and the recognition pass, pinned against the REAL
// Word round-trip evidence (e2e/fixtures/sdt-custom-tag-*.docx — the same file
// before and after Word for the web edited and re-saved it, 2026-08-05).
// Recognition must answer identically on both, which is the whole point of
// anchoring on run-level SDTs with `w:tag`.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readOoxmlPackage, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  decodeCustomNodeTag,
  encodeCustomNodeTag,
  defineCustomNode,
  recognizeCustomNodes,
  customNodesModule,
} from '../index.ts';

function fixturePart(name: string): OoxmlPart {
  const bytes = new Uint8Array(
    readFileSync(resolve(import.meta.dir, `../../../../e2e/fixtures/${name}`))
  );
  const pkg = readOoxmlPackage(bytes);
  if (!pkg.ok) throw new Error(pkg.reason);
  const main = pkg.package.parts.get(pkg.package.mainDocumentPart);
  if (!main) throw new Error('no main part');
  return main;
}

const DEFINITIONS = [
  defineCustomNode({ name: 'citation', tagPrefix: 'docx' }),
  defineCustomNode({ name: 'mention', tagPrefix: 'docx' }),
  defineCustomNode({ name: 'chip', tagPrefix: 'docx' }),
];

describe('the tag codec', () => {
  test('round-trips identity and attrs', () => {
    const encoded = encodeCustomNodeTag('acme', 'citation', {
      sourceId: 'src_9f3',
      locator: 'p.42',
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.tag.length).toBeLessThanOrEqual(64);
    const decoded = decodeCustomNodeTag(encoded.tag);
    expect(decoded).toEqual({
      prefix: 'acme',
      name: 'citation',
      attrs: { sourceId: 'src_9f3', locator: 'p.42' },
    });
  });

  test("refuses Word's 64-character cap instead of truncating an identity", () => {
    const encoded = encodeCustomNodeTag('acme', 'citation', { payload: 'x'.repeat(64) });
    expect(encoded).toMatchObject({ ok: false, reason: 'tag-overflow' });
  });

  test('a crafted __proto__ attr name is refused, never assigned', () => {
    const before = ({} as { polluted?: unknown }).polluted;
    expect(decodeCustomNodeTag('a:b?__proto__=%7B%22polluted%22%3A1%7D')).toBeNull();
    expect(decodeCustomNodeTag('a:b?constructor=x')).toBeNull();
    expect(({} as { polluted?: unknown }).polluted).toBe(before);
  });

  test('non-custom tags decode to null', () => {
    expect(decodeCustomNodeTag('OrdinaryWordTag')).toBeNull();
    expect(decodeCustomNodeTag(':nameless?x=1')).toBeNull();
  });
});

describe('recognition over the Word round-trip fixtures', () => {
  test('the pre-Word original recognizes all three anchors', () => {
    const found = recognizeCustomNodes(fixturePart('sdt-custom-tag-original.docx'), DEFINITIONS);
    expect(found.map((node) => node.name).sort()).toEqual(['chip', 'citation', 'mention']);
    const citation = found.find((node) => node.name === 'citation')!;
    expect(citation.attrs).toEqual({ sourceId: 'src_9f3', locator: 'p.42' });
    expect(citation.text).toBe('(Smith 2024, p. 42)');
  });

  test('recognition is IDENTICAL after Word for the web edited and re-saved the file', () => {
    const strip = (nodes: ReturnType<typeof recognizeCustomNodes>) =>
      nodes
        .map(({ name, attrs, text, tag }) => ({ name, attrs: { ...attrs }, text, tag }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const original = recognizeCustomNodes(fixturePart('sdt-custom-tag-original.docx'), DEFINITIONS);
    const roundTripped = recognizeCustomNodes(
      fixturePart('sdt-custom-tag-word-roundtrip.docx'),
      DEFINITIONS
    );
    expect(strip(roundTripped)).toEqual(strip(original));
  });

  test('an unregistered prefix stays a literal SDT', () => {
    const found = recognizeCustomNodes(fixturePart('sdt-custom-tag-original.docx'), [
      defineCustomNode({ name: 'citation', tagPrefix: 'someoneElse' }),
    ]);
    expect(found).toEqual([]);
  });

  test('fromDocx sees label drift and can veto recognition', () => {
    const seen: string[] = [];
    const found = recognizeCustomNodes(fixturePart('sdt-custom-tag-word-roundtrip.docx'), [
      defineCustomNode({
        name: 'citation',
        tagPrefix: 'docx',
        fromDocx: ({ attrs, text }) => {
          seen.push(text);
          return attrs['sourceId'] ? { ...attrs, label: text } : null;
        },
      }),
      defineCustomNode({
        name: 'mention',
        tagPrefix: 'docx',
        fromDocx: () => null, // veto: stays literal
      }),
    ]);
    expect(found.map((node) => node.name)).toEqual(['citation']);
    expect(seen).toEqual(['(Smith 2024, p. 42)']);
    expect(found[0]!.attrs['label']).toBe('(Smith 2024, p. 42)');
  });
});

describe('the module registration', () => {
  test('customNodesModule carries definitions into the seam shape', () => {
    const module = customNodesModule({ nodes: DEFINITIONS });
    expect(module.id).toBe('custom-nodes');
    expect(module.customNodes).toHaveLength(3);
  });
});
