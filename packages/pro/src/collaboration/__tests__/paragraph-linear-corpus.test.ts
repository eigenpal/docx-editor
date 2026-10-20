/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Every paragraph of the corpus survives the trip through one inline sequence unchanged.
// This is the fidelity gate of `paragraph-text-collaboration`, task 1.3: the shared paragraph
// text can only replace run records if converting to it and back loses nothing.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import * as Y from 'yjs';
import { linearizeParagraph, materializeParagraph } from '../document/paragraph-linear.ts';
import { decodeItems, encodeItems, uniqueInlineIds } from '../document/paragraph-text.ts';
import { DEFAULT_DOCUMENT_LIMITS } from '../document/limits.ts';

/** A paragraph through one shared text and back. */
function throughSharedText(paragraph: OoxmlElement): OoxmlElement {
  const linear = linearizeParagraph(paragraph);
  const embeds = new Map<string, OoxmlNode>();
  for (const item of linear.items) if (item.kind === 'embed') embeds.set(item.node.id, item.node);
  const doc = new Y.Doc();
  const text = doc.getText('inline');
  let at = 0;
  for (const op of encodeItems(linear.items, paragraph.id, DEFAULT_DOCUMENT_LIMITS)) {
    if (typeof op.insert === 'string') {
      text.insert(at, op.insert, { ...op.attributes });
      at += op.insert.length;
    } else {
      text.insertEmbed(at, op.insert, { ...op.attributes });
      at += 1;
    }
  }
  const items = decodeItems(
    text.toDelta(),
    (id) => embeds.get(id) ?? null,
    DEFAULT_DOCUMENT_LIMITS,
    paragraph.id
  );
  return uniqueInlineIds(
    materializeParagraph({ shell: linear.shell, items }),
    new Set(embeds.keys())
  );
}

const ROOT = path.resolve(import.meta.dir, '../../../../..');
const CORPUS = [
  ...readdirSync(path.join(ROOT, 'e2e/fixtures'))
    .filter((name) => name.endsWith('.docx'))
    .map((name) => path.join(ROOT, 'e2e/fixtures', name)),
  path.join(ROOT, 'examples/vite/public/sample.docx'),
];

function paragraphsOf(node: OoxmlNode, out: OoxmlElement[]): OoxmlElement[] {
  if (node.kind === 'textValue') return out;
  if (node.kind === 'paragraph') out.push(node as OoxmlElement);
  for (const child of node.children) paragraphsOf(child, out);
  return out;
}

/** Where two trees first differ, ignoring node IDs, or null when they are the same. */
function difference(a: OoxmlNode, b: OoxmlNode, at = ''): string | null {
  if (a.kind !== b.kind) return `${at}: kind ${a.kind} vs ${b.kind}`;
  if (a.kind === 'textValue' || b.kind === 'textValue') {
    return (a as { value: string }).value === (b as { value: string }).value
      ? null
      : `${at}: text ${JSON.stringify((a as { value: string }).value)} vs ${JSON.stringify((b as { value: string }).value)}`;
  }
  const here = `${at}/${a.localName}`;
  if (a.namespaceUri !== b.namespaceUri || a.localName !== b.localName || a.prefix !== b.prefix) {
    return `${here}: name ${b.localName}`;
  }
  if (JSON.stringify(a.attributes) !== JSON.stringify(b.attributes)) return `${here}: attributes`;
  if (JSON.stringify(a.namespaceBindings) !== JSON.stringify(b.namespaceBindings)) {
    return `${here}: bindings`;
  }
  if (a.children.length !== b.children.length) {
    return `${here}: ${a.children.length} vs ${b.children.length} children (${b.children
      .map((c) => (c.kind === 'textValue' ? '#' : c.localName))
      .join(',')})`;
  }
  for (let index = 0; index < a.children.length; index += 1) {
    const found = difference(a.children[index]!, b.children[index]!, `${here}[${index}]`);
    if (found) return found;
  }
  return null;
}

function replaced(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return node;
  if (node.kind === 'paragraph')
    return materializeParagraph(linearizeParagraph(node as OoxmlElement));
  return { ...node, children: node.children.map(replaced) } as OoxmlNode;
}

describe('paragraph inline sequence round trip', () => {
  test('every corpus paragraph comes back with the same canonical fingerprint', () => {
    const failures: string[] = [];
    let paragraphs = 0;
    for (const file of CORPUS) {
      const read = readOoxmlPackage(new Uint8Array(readFileSync(file)));
      if (!read.ok) continue;
      for (const [name, part] of read.package.parts) {
        for (const paragraph of paragraphsOf(part.root, [])) {
          paragraphs += 1;
          const back = materializeParagraph(linearizeParagraph(paragraph));
          const found = difference(paragraph, back);
          if (found) failures.push(`${path.basename(file)} ${name} ${found}`);
        }
        const rebuilt = { ...part, root: replaced(part.root) } as typeof part;
        if (canonicalOoxmlFingerprint(rebuilt) !== canonicalOoxmlFingerprint(part)) {
          failures.push(`${path.basename(file)} ${name}: part fingerprint`);
        }
      }
    }
    expect(paragraphs).toBeGreaterThan(1000);
    expect(failures.slice(0, 20)).toEqual([]);
  }, 120_000);

  test('every corpus paragraph survives one shared text unchanged', () => {
    const failures: string[] = [];
    let paragraphs = 0;
    for (const file of CORPUS) {
      const read = readOoxmlPackage(new Uint8Array(readFileSync(file)));
      if (!read.ok) continue;
      for (const [name, part] of read.package.parts) {
        for (const paragraph of paragraphsOf(part.root, [])) {
          paragraphs += 1;
          const found = difference(paragraph, throughSharedText(paragraph));
          if (found) failures.push(`${path.basename(file)} ${name} ${found}`);
        }
      }
    }
    expect(paragraphs).toBeGreaterThan(1000);
    expect(failures.slice(0, 20)).toEqual([]);
  }, 120_000);

  test('a renamed run renames the text values under it', () => {
    const paragraph = {
      id: 'p',
      kind: 'paragraph',
      namespaceUri: 'w',
      localName: 'p',
      namespaceBindings: [],
      attributes: [],
      children: [
        {
          id: 'run',
          kind: 'run',
          namespaceUri: 'w',
          localName: 'r',
          namespaceBindings: [],
          attributes: [],
          children: [
            {
              id: 'run~t',
              kind: 'text',
              namespaceUri: 'w',
              localName: 't',
              namespaceBindings: [],
              attributes: [],
              children: [{ id: 'run~t/value', kind: 'textValue', value: 'x' }],
            },
          ],
        },
      ],
    } as unknown as OoxmlElement;
    const renamed = uniqueInlineIds(paragraph, new Set(), (id) => (id === 'run' ? 'run~7' : id));
    const ids: string[] = [];
    const walk = (node: OoxmlNode): void => {
      ids.push(node.id);
      if (node.kind !== 'textValue') node.children.forEach(walk);
    };
    walk(renamed);
    expect(ids).toEqual(['p', 'run~7', 'run~7~t', 'run~7~t/value']);
  });
});
