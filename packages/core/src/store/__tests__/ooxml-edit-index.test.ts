// The node index survives edits exactly (incremental patch differential).
//
// Edit primitives keep a per-tree node/parent index and PATCH it across a rebuild instead
// of re-walking the document. The patch is only worth having if it is indistinguishable
// from a fresh walk — a stale entry surfaces as a caret landing in a paragraph that no
// longer exists, arbitrarily far from the edit that corrupted it. So this drives long
// randomized op sequences through the real op layer and, after every single op, compares
// the index-backed reads against a hand-walk of the tree.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { collectNodeIds, findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { applyTreeOp, paragraphTextOf, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(paragraphs: readonly string[]): OoxmlPart {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
  const xml = `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`read failed: ${result.reason}`);
  return result.part;
}

/** Ground truth, computed the slow way every time: a full walk of the actual tree. */
function walk(part: OoxmlPart): { nodes: Map<string, OoxmlNode>; parents: Map<string, OoxmlNode> } {
  const nodes = new Map<string, OoxmlNode>();
  const parents = new Map<string, OoxmlNode>();
  const visit = (node: OoxmlNode, parent: OoxmlNode | null): void => {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
      if (parent) parents.set(node.id, parent);
    }
    if (node.kind === 'textValue') return;
    for (const child of node.children) visit(child, node);
  };
  visit(part.root, null);
  return { nodes, parents };
}

function expectIndexMatchesTree(part: OoxmlPart, context: string): void {
  const truth = walk(part);
  // Membership: the index must hold exactly the ids the tree holds.
  const indexed = collectNodeIds(part);
  expect([...indexed].sort()).toEqual([...truth.nodes.keys()].sort());
  // Identity and parentage: every id resolves to the very object the tree holds.
  for (const [id, node] of truth.nodes) {
    if (findNode(part, id) !== node) {
      throw new Error(`${context}: findNode(${id}) returned a stale object`);
    }
    const parent = truth.parents.get(id) ?? null;
    const viaIndex = parentNodeOf(part, id);
    if ((viaIndex ?? null) !== (parent && parent.kind !== 'textValue' ? parent : null)) {
      throw new Error(`${context}: parentNodeOf(${id}) disagrees with the tree`);
    }
  }
}

/** Deterministic PRNG, so a failure names a reproducible seed. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paragraphIdsOf(part: OoxmlPart): string[] {
  const body = (part.root.children as readonly OoxmlNode[]).find(
    (child) => child.kind !== 'textValue' && child.localName === 'body'
  );
  if (!body || body.kind === 'textValue') return [];
  return body.children.filter((child) => child.kind === 'paragraph').map((child) => child.id);
}

/** A random op that is VALID for the current tree, so the sequence keeps running. */
function randomOp(part: OoxmlPart, random: () => number): TreeDocOp | null {
  const ids = paragraphIdsOf(part);
  if (ids.length === 0) return null;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const paragraphId = pick(ids);
  const length = (paragraphTextOf(part, paragraphId) ?? '').length;
  const offset = Math.floor(random() * (length + 1));
  const roll = random();
  if (roll < 0.3) {
    return { op: 'insertText', paragraphId, offset, text: `x${Math.floor(random() * 10)}` };
  }
  if (roll < 0.45) {
    if (length === 0) return null;
    const start = Math.floor(random() * length);
    return {
      op: 'deleteText',
      paragraphId,
      start,
      end: Math.min(length, start + 1 + Math.floor(random() * 3)),
    };
  }
  if (roll < 0.6) return { op: 'splitParagraph', paragraphId, offset };
  if (roll < 0.7) {
    const index = ids.indexOf(paragraphId);
    const second = ids[index + 1];
    if (!second) return null;
    return { op: 'joinParagraphs', firstId: paragraphId, secondId: second };
  }
  if (roll < 0.8) return { op: 'insertTab', paragraphId, offset };
  if (roll < 0.85) return { op: 'insertHardBreak', paragraphId, offset };
  if (roll < 0.95) {
    if (length < 2) return null;
    return {
      op: 'setRunProperties',
      paragraphId,
      start: 0,
      end: 1 + Math.floor(random() * (length - 1)),
      properties: random() < 0.5 ? [{ localName: 'b' }] : [],
    };
  }
  return {
    op: 'setParagraphProperties',
    paragraphId,
    properties: random() < 0.5 ? [{ localName: 'jc', attributes: { val: 'center' } }] : [],
  };
}

describe('the patched node index is indistinguishable from a fresh walk', () => {
  for (const seed of [1, 42, 20260730]) {
    test(`400 random ops, seed ${seed}`, () => {
      const random = mulberry32(seed);
      let part = load(['alpha bravo charlie', 'delta echo', 'foxtrot golf hotel india', '']);
      // Prime the index through the public reads, so every later op patches rather than
      // rebuilding — the case under test.
      expectIndexMatchesTree(part, 'initial');
      let applied = 0;
      for (let step = 0; step < 400; step += 1) {
        const op = randomOp(part, random);
        if (!op) continue;
        const result = applyTreeOp(part, op, { deferValidation: true });
        if (!result.ok) continue;
        part = result.part;
        applied += 1;
        expectIndexMatchesTree(part, `seed ${seed} step ${step} op ${op.op}`);
      }
      // The sequence must have actually exercised the patch, not skipped everything.
      expect(applied).toBeGreaterThan(200);
    });
  }
});
