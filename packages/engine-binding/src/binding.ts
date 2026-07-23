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

/** A canonical block's runs (empty for a non-paragraph block). */
function blockRuns(block: Block): readonly RunRecord[] {
  return block.kind === 'paragraph' ? block.runs : [];
}

/** The character length of a run list — the split offset splitParagraph cuts at. */
function pmTextLength(runs: readonly RunRecord[]): number {
  return runs.reduce((n, r) => n + r.text.length, 0);
}

/** The concatenated text of a run list. */
function runsText(runs: readonly RunRecord[]): string {
  return runs.map((r) => r.text).join('');
}

/** Whether the boundary between two text halves falls INSIDE a UTF-16 surrogate pair (the
 *  first half ends on a high surrogate and the second begins on the matching low surrogate). */
function splitsSurrogatePair(head: string, tail: string): boolean {
  if (head.length === 0 || tail.length === 0) return false;
  const hi = head.charCodeAt(head.length - 1);
  const lo = tail.charCodeAt(0);
  return hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff;
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
   *  text edits (per paragraph), a paragraph SPLIT (Enter) or JOIN (Backspace at a boundary),
   *  and the INSERTION of whole new paragraphs at a paragraph boundary (paste). The PM
   *  top-level nodes otherwise correspond 1:1 and IN ORDER to the canonical body blocks
   *  (paragraph↔paragraph by semId, blockEmbed atom↔its exact non-paragraph block). A reorder,
   *  a mid-paragraph paste (insert + split at once), an insert/split/join combined with an edit
   *  to an untouched paragraph, or any disturbance of a read-only block throws
   *  {@link BindingRejection} (fail closed) so nothing is silently dropped, misordered, or
   *  mutated. */
  mapDocToOps(newDoc: PMNode): DocOp[] {
    const model = this.store.currentModel;
    const storyId = bodyStoryId(model);
    const blocks = model.stories.get(storyId)!.blocks;
    const nodes: PMNode[] = [];
    newDoc.forEach((n) => nodes.push(n));

    const delta = nodes.length - blocks.length;
    if (delta > 0) {
      // Prefer a clean boundary INSERTION (every existing block unchanged, k brand-new
      // paragraphs). A single extra paragraph that is NOT a clean insertion may instead be a
      // split of an existing paragraph.
      const inserted = this.mapInsert(nodes, blocks, storyId);
      if (inserted) return inserted;
      if (delta === 1) return this.mapSplit(nodes, blocks);
      throw new BindingRejection('unsupported structural edit (insertion combined with an edit, or multi)');
    }
    if (delta === -1) return this.mapJoin(nodes, blocks);
    if (delta !== 0) throw new BindingRejection('unsupported structural edit (multi-paragraph deletion)');

    // Δ=0: strictly in-place. Each node maps 1:1 to its canonical block by kind + semId.
    const ops: DocOp[] = [];
    nodes.forEach((node, i) => {
      const block = blocks[i];
      if (node.type.name === 'blockEmbed') {
        // A read-only atom must map to its EXACT block — same id AND same kind. Checking kind
        // too rejects a retyped atom (e.g. a table node relabelled 'sdt') that would otherwise
        // commit zero ops and leave the view diverged from the model.
        if (block.kind === 'paragraph' || node.attrs.semId !== block.id || node.attrs.kind !== block.kind) {
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
      // The tail is the split's NEW half: PM leaves its id null (end-split) or copies the head's
      // id (mid-split). Any other id means it is forging an existing block's identity — reject.
      !tail || !isParagraph(tail) || (tail.attrs.semId !== null && tail.attrs.semId !== x.id) ||
      !prefixAligns(nodes, blocks, bk) || !alignsAfter(nodes, bk + 2, blocks, bk + 1)
    ) {
      throw new BindingRejection('unsupported paragraph insertion');
    }
    // A clean split only reorders X's OWN runs at a boundary — the concatenated head+tail runs
    // (text AND formatting) must equal X's runs. A split that also changes text or marks is a
    // combined edit and fails closed, so no run change is ever silently dropped.
    const headRuns = paragraphNodeToRuns(head);
    const tailRuns = paragraphNodeToRuns(tail);
    if (!runsEqual([...headRuns, ...tailRuns], blockRuns(x))) {
      throw new BindingRejection('split combined with an edit is not supported');
    }
    // The offset is a UTF-16 code-unit index (matching the store's slice). If it falls BETWEEN
    // a surrogate pair, each half keeps a lone surrogate that becomes U+FFFD on UTF-8 save —
    // corrupting the text. Reject: an astral character must stay whole in one half.
    if (splitsSurrogatePair(runsText(headRuns), runsText(tailRuns))) {
      throw new BindingRejection('split inside a surrogate pair would corrupt text');
    }
    return [{ op: 'splitParagraph', paragraphId: x.id, offset: pmTextLength(headRuns) }];
  }

  /** One fewer paragraph: canonical [X, Y] were joined into X (Y removed, X keeps its id).
   *  A clean join (X's + Y's runs concatenated, unchanged) maps to one joinParagraphs; else
   *  fails closed. */
  private mapJoin(nodes: readonly PMNode[], blocks: readonly Block[]): DocOp[] {
    const bk = firstDivergence(nodes, blocks); // index of the removed Y in the canonical
    const y = blocks[bk];
    const x = blocks[bk - 1];
    const survivor = nodes[bk - 1];
    if (
      !y || y.kind !== 'paragraph' || !x || x.kind !== 'paragraph' ||
      !survivor || !isParagraph(survivor) || survivor.attrs.semId !== x.id ||
      !prefixAligns(nodes, blocks, bk - 1) || // the blocks BEFORE the survivor are unchanged
      !alignsAfter(nodes, bk, blocks, bk + 1) // the blocks after Y are unchanged
    ) {
      throw new BindingRejection('unsupported paragraph deletion');
    }
    if (!runsEqual(paragraphNodeToRuns(survivor), [...blockRuns(x), ...blockRuns(y)])) {
      throw new BindingRejection('join combined with an edit is not supported');
    }
    return [{ op: 'joinParagraphs', firstId: x.id, secondId: y.id }];
  }

  /** k extra paragraphs (k ≥ 1): a clean INSERTION of k brand-new paragraphs at ONE boundary —
   *  every existing block is unchanged (identity AND content) and the k inserted nodes are all
   *  new (semId null) paragraphs. Maps to k insertParagraph ops at the boundary index. Returns
   *  null when the shape is NOT a clean boundary insertion (so a Δ=1 caller can try a split);
   *  a mid-paragraph paste (which also splits) or an insert-plus-edit is not a clean insertion
   *  and falls through to fail closed. */
  private mapInsert(nodes: readonly PMNode[], blocks: readonly Block[], storyId: string): DocOp[] | null {
    // The prefix ends at the first node that does not match its block by identity AND content.
    // A brand-new paragraph has semId null, which never matches an existing block, so the prefix
    // stops exactly where the inserted run begins.
    let prefix = 0;
    while (prefix < blocks.length && nodeMatchesBlock(nodes[prefix], blocks[prefix]) && sameContent(nodes[prefix], blocks[prefix])) {
      prefix += 1;
    }
    const k = nodes.length - blocks.length;
    // The k inserted nodes must all be genuinely new paragraphs (a read-only atom can't be pasted).
    for (let j = prefix; j < prefix + k; j += 1) {
      const n = nodes[j];
      if (!n || !isParagraph(n) || n.attrs.semId !== null) return null;
    }
    // Everything after the inserted run must be the UNCHANGED tail of the canonical blocks.
    if (!alignsAfter(nodes, prefix + k, blocks, prefix)) return null;
    const ops: DocOp[] = [];
    for (let j = 0; j < k; j += 1) {
      ops.push({ op: 'insertParagraph', storyId, index: prefix + j, runs: paragraphNodeToRuns(nodes[prefix + j]) });
    }
    return ops;
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
