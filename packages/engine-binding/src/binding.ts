// EditorBinding — the ONLY ProseMirror-aware integration (document-engine tasks
// 6.1, 6.3, 6.4, 6.5, 6.9 / ADR-S6). It maps an edited PM doc to semantic DocOps
// and commits the store FIRST, then reconciles the view from committed evidence.
// Forward mapping is model-first and identity-preserving: an existing paragraph's
// changed content becomes `setParagraphRuns` (ReplaceBlockContent, keeps id), a
// new paragraph becomes `appendParagraph` (mints id), a vanished paragraph becomes
// `deleteParagraph`. The rejected POC prefix/suffix text diff is NOT used.
//
// Loop prevention (6.9): reconciliation output is a projection; only genuine user
// edits call `commitFromDoc`, so a reconciled doc maps to zero ops.

import { EditorState } from 'prosemirror-state';
import { Node as PMNode } from 'prosemirror-model';
import {
  DocumentStore,
  bodyStoryId,
  normalizeRuns,
  ORIGIN_IDS,
  type DocOp,
  type BatchResult,
  type Block,
  type RunRecord,
} from '@docx-editor.dev/engine-core';
import { docSchema } from './schema.ts';
import { modelToDoc, paragraphNodeToRuns } from './projection.ts';

const MUTATION = ORIGIN_IDS.mutationHuman;

/** A structural edit the forward mapper refuses to apply (it would flatten, delete, or
 *  mutate a read-only non-paragraph block). commitFromDoc turns it into a rejected,
 *  no-commit result — the canonical store is left untouched. */
class BindingRejection extends Error {}

/** Compare run lists up to normalization. ProseMirror coalesces adjacent text with
 *  identical marks during projection, so an UNCHANGED paragraph whose model runs merge to
 *  the same normalized form must map to ZERO ops — otherwise re-projecting an untouched
 *  paragraph would spuriously rewrite (and collapse) its authored run segmentation. A real
 *  text/formatting edit still differs after normalization. */
function isParagraph(node: PMNode): boolean {
  return node.type.name === 'paragraph';
}

/** The plain text of a projected paragraph node (its runs concatenated). */
function pmText(node: PMNode): string {
  return paragraphNodeToRuns(node)
    .map((r) => r.text)
    .join('');
}

/** The plain text of a canonical block (empty for a non-paragraph block). */
function blockText(block: Block): string {
  return block.kind === 'paragraph' ? block.runs.map((r) => r.text).join('') : '';
}

/** Whether a PM node corresponds to a canonical block by KIND and semId — NOT by content,
 *  so an in-place text edit still "matches" its block (same identity, different runs). */
function nodeMatchesBlock(node: PMNode | undefined, block: Block | undefined): boolean {
  if (!node || !block) return false;
  if (node.type.name === 'blockEmbed') return block.kind !== 'paragraph' && node.attrs.semId === block.id;
  if (node.type.name === 'paragraph') return block.kind === 'paragraph' && node.attrs.semId === block.id;
  return false;
}

/** The first index at which the node/block sequences stop corresponding (by identity). */
function firstDivergence(nodes: readonly PMNode[], blocks: readonly Block[]): number {
  const n = Math.min(nodes.length, blocks.length);
  let i = 0;
  while (i < n && nodeMatchesBlock(nodes[i], blocks[i])) i += 1;
  return i;
}

/** Whether a PM node's CONTENT still equals its block's — so a paragraph edited alongside a
 *  split/join is NOT mistaken for an untouched neighbour (a read-only atom is content-fixed). */
function sameContent(node: PMNode, block: Block): boolean {
  if (node.type.name !== 'paragraph' || block.kind !== 'paragraph') return true;
  return runsEqual(block.runs, paragraphNodeToRuns(node));
}

/** Whether nodes[0..count) correspond 1:1 to blocks[0..count) by identity AND content — used
 *  to prove the region around a split/join is genuinely untouched (else fail closed). */
function prefixAligns(nodes: readonly PMNode[], blocks: readonly Block[], count: number): boolean {
  for (let i = 0; i < count; i += 1) {
    const b = blocks[i];
    if (!nodeMatchesBlock(nodes[i], b) || !sameContent(nodes[i], b)) return false;
  }
  return true;
}

/** Whether nodes[ni..] correspond 1:1 and in order to blocks[bi..] by identity AND content. */
function alignsAfter(nodes: readonly PMNode[], ni: number, blocks: readonly Block[], bi: number): boolean {
  if (nodes.length - ni !== blocks.length - bi) return false;
  for (let a = ni, b = bi; a < nodes.length; a += 1, b += 1) {
    const bl = blocks[b];
    if (!nodeMatchesBlock(nodes[a], bl) || !sameContent(nodes[a], bl)) return false;
  }
  return true;
}

function runsEqual(a: readonly RunRecord[], b: readonly RunRecord[]): boolean {
  return JSON.stringify(normalizeRuns(a)) === JSON.stringify(normalizeRuns(b));
}

export interface ForwardResult {
  readonly ops: readonly DocOp[];
  readonly result?: BatchResult;
  /** True when the edit was refused (fail closed) — no DocOps, no commit. */
  readonly rejected?: boolean;
}

export class EditorBinding {
  constructor(private readonly store: DocumentStore) {}

  get schema() {
    return docSchema;
  }

  /** Project current authored state into a ProseMirror doc / state. */
  projectDoc(): PMNode {
    return modelToDoc(this.store.currentModel);
  }
  createState(): EditorState {
    return EditorState.create({ schema: docSchema, doc: this.projectDoc() });
  }

  /** Derive the DocOps that turn the current authored state into `newDoc`. Supports in-place
   *  text edits (per paragraph) plus the two common STRUCTURAL edits: a paragraph SPLIT
   *  (Enter) and a JOIN (Backspace/Delete at a boundary). The PM top-level nodes otherwise
   *  correspond 1:1 and IN ORDER to the canonical body blocks (paragraph↔paragraph by semId,
   *  blockEmbed atom↔its exact non-paragraph block). A reorder, a multi-paragraph paste, a
   *  split-with-edit, or any disturbance of a read-only block throws {@link BindingRejection}
   *  (fail closed) so nothing is silently dropped, misordered, or mutated. */
  mapDocToOps(newDoc: PMNode): DocOp[] {
    const model = this.store.currentModel;
    const blocks = model.stories.get(bodyStoryId(model))!.blocks;
    const nodes: PMNode[] = [];
    newDoc.forEach((n) => nodes.push(n));

    const delta = nodes.length - blocks.length;
    if (delta === 1) return this.mapSplit(nodes, blocks);
    if (delta === -1) return this.mapJoin(nodes, blocks);
    if (delta !== 0) throw new BindingRejection('unsupported structural edit (multi-paragraph)');

    // Δ=0: strictly in-place. Each node maps 1:1 to its canonical block by kind + semId.
    const ops: DocOp[] = [];
    nodes.forEach((node, i) => {
      const block = blocks[i];
      if (node.type.name === 'blockEmbed') {
        if (block.kind === 'paragraph' || node.attrs.semId !== block.id) {
          throw new BindingRejection('read-only block moved, replaced, or retyped');
        }
      } else if (node.type.name === 'paragraph') {
        if (block.kind !== 'paragraph' || node.attrs.semId !== block.id) {
          throw new BindingRejection('paragraph reordered or retargeted');
        }
        const runs = paragraphNodeToRuns(node);
        if (!runsEqual(block.runs, runs)) ops.push({ op: 'setParagraphRuns', paragraphId: block.id, runs });
      } else throw new BindingRejection(`unexpected node type '${node.type.name}'`);
    });
    return ops;
  }

  /** One extra paragraph: exactly one canonical paragraph X was split into two consecutive
   *  paragraphs. ProseMirror's splitBlock keeps X's id on the HEAD and copies it to the tail
   *  (a mid-split) or leaves the tail's id null (an end-split) — so the head, not the tail, is
   *  the stable anchor. The head sits just before the first identity divergence; the tail is
   *  the node after it. A clean split (concatenated text unchanged) maps to one splitParagraph
   *  at the head's length; anything else fails closed. */
  private mapSplit(nodes: readonly PMNode[], blocks: readonly Block[]): DocOp[] {
    const bk = firstDivergence(nodes, blocks) - 1; // head = last node that still matched its block
    const x = blocks[bk];
    const head = nodes[bk];
    const tail = nodes[bk + 1];
    if (
      bk < 0 || !x || x.kind !== 'paragraph' ||
      !head || !isParagraph(head) || head.attrs.semId !== x.id ||
      !tail || !isParagraph(tail) ||
      !prefixAligns(nodes, blocks, bk) || !alignsAfter(nodes, bk + 2, blocks, bk + 1)
    ) {
      throw new BindingRejection('unsupported paragraph insertion');
    }
    if (pmText(head) + pmText(tail) !== blockText(x)) throw new BindingRejection('split combined with an edit is not supported');
    return [{ op: 'splitParagraph', paragraphId: x.id, offset: pmText(head).length }];
  }

  /** One fewer paragraph: canonical [X, Y] were joined into X (Y removed, X keeps its id).
   *  A clean join (concatenated text unchanged) maps to one joinParagraphs; else fails closed. */
  private mapJoin(nodes: readonly PMNode[], blocks: readonly Block[]): DocOp[] {
    const bk = firstDivergence(nodes, blocks); // index of the removed Y in the canonical
    const y = blocks[bk];
    const x = blocks[bk - 1];
    const survivor = nodes[bk - 1];
    if (
      !y || y.kind !== 'paragraph' || !x || x.kind !== 'paragraph' ||
      !survivor || !isParagraph(survivor) || survivor.attrs.semId !== x.id ||
      !alignsAfter(nodes, bk, blocks, bk + 1) // the blocks after Y are unchanged
    ) {
      throw new BindingRejection('unsupported paragraph deletion');
    }
    if (pmText(survivor) !== blockText(x) + blockText(y)) throw new BindingRejection('join combined with an edit is not supported');
    return [{ op: 'joinParagraphs', firstId: x.id, secondId: y.id }];
  }

  /** Forward: map an edited PM doc to DocOps and commit ONE store transaction. An edit
   *  that disturbs a read-only block is refused (fail closed): no ops, no commit. */
  commitFromDoc(newDoc: PMNode): ForwardResult {
    let ops: DocOp[];
    try {
      ops = this.mapDocToOps(newDoc);
    } catch (e) {
      if (e instanceof BindingRejection) return { ops: [], rejected: true };
      throw e;
    }
    if (ops.length === 0) return { ops };
    return { ops, result: this.store.applyEdits(ops, MUTATION) };
  }

  /**
   * Reverse reconciliation: after a non-PM commit (remote/agent/undo), reproject
   * the authored model into a fresh PM doc for the view. Tagged as projection
   * work — it is never fed back into `commitFromDoc`.
   */
  reconcileDoc(): PMNode {
    return this.projectDoc();
  }
}
