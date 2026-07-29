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
  blockRegistryVersion,
  type DocOp,
  type BatchResult,
  type Block,
  type RunRecord,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';
import { docSchema } from './schema.ts';
import { modelToDoc, paragraphNodeToRuns } from './projection.ts';
import {
  nodeRole,
  isBindingEditableKind,
  assertBindingLaneComplete,
} from './binding-capabilities.ts';

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
/** Whether a PM node is an EDITABLE text-paragraph node (by its registered reverse role, not a
 *  hardcoded name) — so a feature's editable text node participates in the reverse mapper too. */
function isParagraph(node: PMNode): boolean {
  return nodeRole(node.type.name) === 'paragraph';
}

/** A canonical block's runs (empty for a non-paragraph block). */
function blockRuns(block: Block): readonly RunRecord[] {
  return block.kind === 'paragraph' ? block.runs : [];
}

/** Whether a run round-trips LOSSLESSLY through the ProseMirror projection, which represents
 *  only the PRESENCE of bold/italic/underline. A run carrying a stable id, a styleId, or an
 *  explicit-off bold/italic/underline would lose that metadata if its paragraph were re-set from a
 *  projected (PM-derived) run list — so such a paragraph must never be overwritten by an edit. */
export function runIsProjectable(run: RunRecord): boolean {
  if (run.id !== undefined) return false;
  const p = run.props;
  if (!p) return true;
  if (p.styleId !== undefined) return false;
  // Underline projects as a mark carrying its VARIANT and colour, so an authored `w:u`
  // round-trips. Only an authored OFF (`val: 'none'`) stays unrepresentable — mark ABSENCE
  // means omitted, not authored-false, exactly as for bold and italic. Refusing every
  // underline had locked whole paragraphs read-only for a property the model, the DocOp
  // validator, and the serializer all already carried.
  return p.bold !== false && p.italic !== false && p.underline?.val !== 'none';
}

/** Whether every run of a paragraph block round-trips losslessly through projection. */
function paragraphIsProjectable(block: Block): boolean {
  return block.kind === 'paragraph' && block.runs.every(runIsProjectable);
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

/** Whether a string contains an UNPAIRED UTF-16 surrogate — a lone half of an astral character
 *  that would become U+FFFD on UTF-8 serialization. Any run carrying one must never be committed. */
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true; // high surrogate not followed by a low
      i += 1; // valid pair — skip its low half
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true; // low surrogate with no preceding high
    }
  }
  return false;
}

/** Whether a PM node corresponds to a canonical block by KIND and semId — NOT by content,
 *  so an in-place text edit still "matches" its block (same identity, different runs). */
/**
 * The read-only policy currently in force, for the module-level alignment helpers.
 *
 * `nodeMatchesBlock` feeds `firstDivergence`, `trySplit`, `mapJoin`, `mapInsert`, and
 * `mapPasteIntoParagraph`, none of which are instance methods. Without the policy here
 * a `paragraph` node carrying a policy-read-only block's `semId` aligned as an ordinary
 * editable paragraph, and the reverse mapper emitted `setParagraphRuns` for a block that
 * has no lossless patch path — the store committed and `emitPreservedPart` then threw at
 * SAVE. `partial-body-editability/specs` requires that projection to be rejected at
 * reverse mapping, and both the spec scenario and the "never commit then fail to save"
 * rule were unimplemented.
 *
 * Set from the instance immediately before each mapping pass, so it always reflects the
 * policy for the revision being mapped.
 */
let activeReadOnlyBlockIds: ReadonlySet<string> = new Set();

function nodeMatchesBlock(node: PMNode | undefined, block: Block | undefined): boolean {
  if (!node || !block) return false;
  // A read-only atom must match its block by id AND kind — so a retyped atom (a table relabelled
  // 'sdt') is never treated as unchanged in a prefix/suffix alignment and cannot ride along a
  // split/join/insert/paste while the model keeps the original kind.
  const role = nodeRole(node.type.name);
  if (role === 'atom') {
    // A read-only atom must match a NON-editable-kind block by id AND kind (isBindingEditableKind
    // is the single source of truth for what the reverse lane treats as editable, == paragraph).
    // Identity and kind only. The kind-editability requirement was dropped for M6P.1:
    // a PARAGRAPH may legitimately be an atom now, when the access policy found no
    // lossless patch path for its current source slice. Fail-closed either way — a
    // forged atom naming a patchable paragraph makes it immutable, never editable.
    return node.attrs.semId === block.id && node.attrs.kind === block.kind;
  }
  // A paragraph node may only align to a block the POLICY says is editable. Kind alone
  // is not enough: a paragraph carrying unmodeled inline OOXML is a read-only region.
  if (role === 'paragraph') {
    return (
      isBindingEditableKind(block.kind) &&
      !activeReadOnlyBlockIds.has(block.id) &&
      node.attrs.semId === block.id
    );
  }
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
  if (!isParagraph(node) || block.kind !== 'paragraph') return true; // role-driven, not a hardcoded name
  return runsEqual(block.runs, paragraphNodeToRuns(node, block.runs));
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
function alignsAfter(
  nodes: readonly PMNode[],
  ni: number,
  blocks: readonly Block[],
  bi: number
): boolean {
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

/** The binding lane is verified when an EditorBinding opens a document (comprehensive 3.9): every
 *  editable core block kind must project to a first-class editable PM node. Keyed on the core block
 *  registry version (NOT a one-shot boolean) so a kind registered AFTER the first open still
 *  re-validates — a late editable kind bumps the version and is caught, mirroring the core lane's
 *  version-keyed cache. -1 forces the first open to check. */
let bindingLaneVerifiedAtVersion = -1;

export class EditorBinding {
  constructor(private readonly store: DocumentStore) {
    const version = blockRegistryVersion();
    if (bindingLaneVerifiedAtVersion !== version) {
      assertBindingLaneComplete();
      bindingLaneVerifiedAtVersion = version;
    }
  }

  get schema() {
    return docSchema;
  }

  /** Project current authored state into a ProseMirror doc / state. */
  /**
   * Block ids the body access policy marks read-only for the current revision.
   * Empty means "kind decides", which is the pre-M6P.1 behavior.
   */
  private readOnlyBlockIds: ReadonlySet<string> = new Set();

  /** Install the per-block access policy. Recomputed by the session per revision. */
  setReadOnlyBlockIds(ids: ReadonlySet<string>): void {
    this.readOnlyBlockIds = ids;
    activeReadOnlyBlockIds = ids;
  }

  projectDoc(): PMNode {
    return modelToDoc(this.store.currentModel, this.readOnlyBlockIds);
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
      // In precedence: a clean boundary INSERTION (every existing block unchanged); then a clean
      // SPLIT of one paragraph (Δ=1, its own runs merely reordered); then a mid-paragraph PASTE
      // (one paragraph edited + k new paragraphs after it). Each returns null when it does not
      // match, so the next is tried; only if none match do we fail closed.
      const inserted = this.mapInsert(nodes, blocks, storyId);
      if (inserted) return inserted;
      if (delta === 1) {
        const split = this.trySplit(nodes, blocks); // throws only on a corrupting (surrogate) split
        if (split) return split;
      }
      const pasted = this.mapPasteIntoParagraph(nodes, blocks, storyId);
      if (pasted) return pasted;
      throw new BindingRejection(
        'unsupported structural edit (paste or insertion combined with a change)'
      );
    }
    if (delta === -1) return this.mapJoin(nodes, blocks);
    if (delta !== 0)
      throw new BindingRejection('unsupported structural edit (multi-paragraph deletion)');

    // Δ=0: strictly in-place. Each node maps 1:1 to its canonical block by kind + semId.
    const ops: DocOp[] = [];
    nodes.forEach((node, i) => {
      const block = blocks[i];
      const role = nodeRole(node.type.name); // reverse-mapping role (capability-driven, not hardcoded)
      if (role === 'atom') {
        // A read-only atom must map to its EXACT block — same id AND same kind. Checking kind
        // too rejects a retyped atom (e.g. a table node relabelled 'sdt') that would otherwise
        // commit zero ops and leave the view diverged from the model.
        // Identity and kind must match exactly, which rejects a retyped atom (a table
        // relabelled 'sdt') that would otherwise commit zero ops and leave the view
        // diverged from the model.
        //
        // The kind-editability test was removed for M6P.1: a PARAGRAPH is now
        // legitimately an atom when the body access policy found no lossless patch path
        // for its current source slice. Keeping it rejected every edit in a partially
        // editable document — measured on the comprehensive fixture, where 70 of 237
        // paragraphs carry unmodeled inline OOXML.
        //
        // Still fail-closed: an atom commits no ops, so a paragraph wrongly projected as
        // one becomes immutable, never wrongly editable. The policy is validated on the
        // projection side, which is the authority.
        if (node.attrs.semId !== block.id || node.attrs.kind !== block.kind) {
          throw new BindingRejection('read-only block moved, replaced, or retyped');
        }
        if (!this.readOnlyBlockIds.has(block.id) && isBindingEditableKind(block.kind)) {
          // An atom naming a block the policy says IS editable means the projection and
          // the policy disagree — refuse rather than silently freeze the paragraph.
          throw new BindingRejection('read-only atom names an editable block');
        }
      } else if (role === 'paragraph') {
        if (!isBindingEditableKind(block.kind) || node.attrs.semId !== block.id) {
          throw new BindingRejection('paragraph reordered or retargeted');
        }
        // The policy, not just the kind. A projected paragraph naming a read-only block
        // would otherwise commit `setParagraphRuns` for content with no lossless patch
        // path, and the failure would surface at save with the store already mutated.
        if (this.readOnlyBlockIds.has(block.id)) {
          throw new BindingRejection('edit targets a read-only block');
        }
        // The reverse lane's run mapping is paragraph-shaped (BINDING_EDITABLE_KINDS is paragraph);
        // narrow to ParagraphRecord and fail closed if a future editable kind is not paragraph-shaped.
        if (block.kind !== 'paragraph')
          throw new BindingRejection('editable block kind has no run reverse-mapping');
        const runs = paragraphNodeToRuns(node, block.runs);
        if (!runsEqual(block.runs, runs)) {
          // Overwriting a paragraph whose runs carry metadata the projection drops (id/styleId/
          // underline/explicit-off) would silently lose it — refuse rather than corrupt.
          if (!paragraphIsProjectable(block))
            throw new BindingRejection('paragraph carries unprojectable run metadata');
          ops.push({ op: 'setParagraphRuns', paragraphId: block.id, runs });
        }
      } else throw new BindingRejection(`unexpected node type '${node.type.name}'`);
    });
    return ops;
  }

  /** One extra paragraph that is a clean SPLIT of one canonical paragraph X into two consecutive
   *  paragraphs — its OWN runs merely reordered at a boundary, nothing else changed. ProseMirror's
   *  splitBlock keeps X's id on the HEAD and copies it to the tail (a mid-split) or leaves the
   *  tail's id null (an end-split), so the head is the stable anchor. Returns the splitParagraph
   *  op, or null when the shape is NOT a clean split (so a caller can try a paste); throws only
   *  when the split IS clean but would corrupt an astral character (fail closed). */
  private trySplit(nodes: readonly PMNode[], blocks: readonly Block[]): DocOp[] | null {
    const bk = firstDivergence(nodes, blocks) - 1; // head = last node that still matched its block
    const x = blocks[bk];
    const head = nodes[bk];
    const tail = nodes[bk + 1];
    if (
      bk < 0 ||
      !x ||
      x.kind !== 'paragraph' ||
      !head ||
      !isParagraph(head) ||
      head.attrs.semId !== x.id ||
      // The tail is the split's NEW half: PM leaves its id null (end-split) or copies the head's
      // id (mid-split). Any other id means it is forging an existing block's identity.
      !tail ||
      !isParagraph(tail) ||
      (tail.attrs.semId !== null && tail.attrs.semId !== x.id) ||
      !prefixAligns(nodes, blocks, bk) ||
      !alignsAfter(nodes, bk + 2, blocks, bk + 1)
    ) {
      return null; // not a split shape — let the paste path try
    }
    // A clean split only reorders X's OWN runs at a boundary — the concatenated head+tail runs
    // (text AND formatting) must equal X's runs. If not, this is not a split (it may be a paste).
    const headRuns = paragraphNodeToRuns(head, blockRuns(x));
    const tailRuns = paragraphNodeToRuns(tail, blockRuns(x));
    if (!runsEqual([...headRuns, ...tailRuns], blockRuns(x))) return null;
    // The offset is a UTF-16 code-unit index (matching the store's slice). If it falls BETWEEN
    // a surrogate pair, each half keeps a lone surrogate that becomes U+FFFD on UTF-8 save —
    // corrupting the text. This IS a clean split, so REJECT (don't fall through to paste, which
    // would re-corrupt via setParagraphRuns): an astral character must stay whole in one half.
    if (splitsSurrogatePair(runsText(headRuns), runsText(tailRuns))) {
      throw new BindingRejection('split inside a surrogate pair would corrupt text');
    }
    return [{ op: 'splitParagraph', paragraphId: x.id, offset: pmTextLength(headRuns) }];
  }

  /** A mid-paragraph PASTE: one existing paragraph P (at a boundary) has its content CHANGED and
   *  k brand-new paragraphs are inserted right after it — exactly what ProseMirror produces when
   *  a multi-line clipboard is pasted inside a paragraph (P keeps its id and gains the paste head;
   *  the middle lines are new; the last new line carries P's tail). Maps to one setParagraphRuns
   *  (P's new content) plus k insertParagraph ops. Returns null when the shape does not match
   *  (every surrounding block must be unchanged in identity AND content), so nothing else is
   *  touched. */
  private mapPasteIntoParagraph(
    nodes: readonly PMNode[],
    blocks: readonly Block[],
    storyId: string
  ): DocOp[] | null {
    // The prefix ends at the first block whose identity OR content changed — the paste target P.
    let prefix = 0;
    while (
      prefix < blocks.length &&
      nodeMatchesBlock(nodes[prefix], blocks[prefix]) &&
      sameContent(nodes[prefix], blocks[prefix])
    ) {
      prefix += 1;
    }
    const target = nodes[prefix];
    const block = blocks[prefix];
    // P must be an EXISTING paragraph (same id) whose content changed (guaranteed: the prefix
    // stopped here). A new (null) node here would be a pure insertion (handled by mapInsert).
    if (
      !target ||
      !isParagraph(target) ||
      !block ||
      block.kind !== 'paragraph' ||
      target.attrs.semId !== block.id
    ) {
      return null;
    }
    const k = nodes.length - blocks.length; // number of NEW paragraphs after P
    for (let j = prefix + 1; j <= prefix + k; j += 1) {
      const n = nodes[j];
      if (!n || !isParagraph(n) || n.attrs.semId !== null) return null; // the extra lines must be new
    }
    // Everything after the inserted run is the UNCHANGED tail of the canonical blocks.
    if (!alignsAfter(nodes, prefix + k + 1, blocks, prefix + 1)) return null;
    // The paste overwrites P (and moves its tail into a new paragraph). If P's ORIGINAL runs carry
    // metadata the projection drops (id/styleId/underline/explicit-off), the paste would silently
    // lose it — refuse. Likewise if P has PARAGRAPH-level props (numbering/style/etc.) OR an
    // ownership-scoped w:pPr capsule: P keeps them via setParagraphRuns, but the tail moves to a NEW
    // paragraph and insertParagraph cannot reproduce them, so the tail would silently lose its
    // list/style/properties context.
    if (
      !paragraphIsProjectable(block) ||
      block.props !== undefined ||
      (block as ParagraphRecord).pPrCapsule !== undefined
    ) {
      return null;
    }
    // A paste that redistributes the paragraph's text must never leave a run holding a lone
    // surrogate (a boundary inside an astral character) — checked PER RUN, since a pair split
    // across two differently-formatted runs concatenates to a valid string yet serializes each
    // half separately and corrupts on save.
    const affected = [target, ...nodes.slice(prefix + 1, prefix + 1 + k)];
    if (affected.some((n) => paragraphNodeToRuns(n).some((r) => hasLoneSurrogate(r.text)))) {
      throw new BindingRejection('paste would split an astral character (surrogate) — refused');
    }
    const ops: DocOp[] = [
      {
        op: 'setParagraphRuns',
        paragraphId: block.id,
        runs: paragraphNodeToRuns(target, block.runs),
      },
    ];
    for (let j = 0; j < k; j += 1) {
      ops.push({
        op: 'insertParagraph',
        storyId,
        index: prefix + 1 + j,
        runs: paragraphNodeToRuns(nodes[prefix + 1 + j]),
      });
    }
    return ops;
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
      !y ||
      y.kind !== 'paragraph' ||
      !x ||
      x.kind !== 'paragraph' ||
      !survivor ||
      !isParagraph(survivor) ||
      survivor.attrs.semId !== x.id ||
      !prefixAligns(nodes, blocks, bk - 1) || // the blocks BEFORE the survivor are unchanged
      !alignsAfter(nodes, bk, blocks, bk + 1) // the blocks after Y are unchanged
    ) {
      throw new BindingRejection('unsupported paragraph deletion');
    }
    if (
      !runsEqual(paragraphNodeToRuns(survivor, [...blockRuns(x), ...blockRuns(y)]), [
        ...blockRuns(x),
        ...blockRuns(y),
      ])
    ) {
      throw new BindingRejection('join combined with an edit is not supported');
    }
    // A join DELETES Y. Every other lane validates the block it touches against the
    // read-only policy; this one did not, and that made it the way to destroy an
    // unpatchable block. Delegation is what makes it reachable: a native
    // `deleteWordBackward`/`deleteHardLineBackward` at the start of the paragraph after a
    // read-only atom lets the browser remove the `contenteditable="false"` block itself,
    // and PM reconciles a doc with one fewer top-level node — which lands right here.
    //
    // Independent security review proved the store committed the deletion and the block
    // was gone. Only the `structuralMutationAllowed` preflight in the session stood in
    // the way, one layer up and for an unrelated reason. Both ends are checked: X
    // survives but absorbs Y's runs, so neither may be read-only.
    if (this.readOnlyBlockIds.has(y.id) || this.readOnlyBlockIds.has(x.id)) {
      throw new BindingRejection('edit targets a read-only block');
    }
    return [{ op: 'joinParagraphs', firstId: x.id, secondId: y.id }];
  }

  /** k extra paragraphs (k ≥ 1): a clean INSERTION of k brand-new paragraphs at ONE boundary —
   *  every existing block is unchanged (identity AND content) and the k inserted nodes are all
   *  new (semId null) paragraphs. Maps to k insertParagraph ops at the boundary index. Returns
   *  null when the shape is NOT a clean boundary insertion (so a Δ=1 caller can try a split);
   *  a mid-paragraph paste (which also splits) or an insert-plus-edit is not a clean insertion
   *  and falls through to fail closed. */
  private mapInsert(
    nodes: readonly PMNode[],
    blocks: readonly Block[],
    storyId: string
  ): DocOp[] | null {
    // The prefix ends at the first node that does not match its block by identity AND content.
    // A brand-new paragraph has semId null, which never matches an existing block, so the prefix
    // stops exactly where the inserted run begins.
    let prefix = 0;
    while (
      prefix < blocks.length &&
      nodeMatchesBlock(nodes[prefix], blocks[prefix]) &&
      sameContent(nodes[prefix], blocks[prefix])
    ) {
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
    // Inserting a SINGLE EMPTY paragraph right after an existing paragraph is ambiguous with an
    // end-of-paragraph split (Enter). Defer to the split path so the new paragraph inherits the
    // source paragraph's properties (a split preserves style; a bare insert would not).
    if (
      k === 1 &&
      prefix >= 1 &&
      blocks[prefix - 1].kind === 'paragraph' &&
      pmTextLength(paragraphNodeToRuns(nodes[prefix])) === 0
    ) {
      return null;
    }
    const ops: DocOp[] = [];
    for (let j = 0; j < k; j += 1) {
      ops.push({
        op: 'insertParagraph',
        storyId,
        index: prefix + j,
        runs: paragraphNodeToRuns(nodes[prefix + j]),
      });
    }
    return ops;
  }

  /** Forward: map an edited PM doc to DocOps and commit ONE store transaction. An edit
   *  that disturbs a read-only block is refused (fail closed): no ops, no commit. */
  commitFromDoc(newDoc: PMNode): ForwardResult {
    let ops: DocOp[];
    activeReadOnlyBlockIds = this.readOnlyBlockIds;
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
