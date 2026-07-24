// Authored-state digest (document-engine task 3.7 "reopen to equivalent authored-state hashes").
// Projects the SEMANTIC authored content of a PackageModel — what a user authored — and fingerprints
// it under the frozen `authoredState` comparator (canonical-exact). It deliberately EXCLUDES volatile
// bookkeeping that legitimately differs across a save+reopen while the authored content is unchanged:
// internal block/story identity ids, the identity allocator cursors, the byte-level preservation
// index, and the live revision. Two models with the same authored content therefore share a digest,
// which is exactly the equivalence a complete-export round-trip must preserve.

import type { PackageModel, Block, Story, RunRecord } from '../model/authored-model.ts';
import { stableHash } from '../comparators/canonical.ts';

function runDigest(r: RunRecord): unknown {
  // Text + the authored formatting facts: modeled props and the verbatim run-properties capsule.
  // (id is volatile identity, excluded.)
  return { text: r.text, props: r.props ?? null, rPr: r.rPrCapsule ?? null };
}

function blockDigest(b: Block, model: PackageModel): unknown {
  if (b.kind === 'paragraph') {
    return {
      k: 'paragraph',
      pPr: b.pPrCapsule ?? null,
      attrs: b.pAttrsCapsule ?? null,
      runs: b.runs.map(runDigest),
    };
  }
  // Non-paragraph blocks (table, sdt) are preserved verbatim and never regenerated; their authored
  // content IS their byte-exact source range, so digest that slice (id-free). A preserved block
  // always has a range; without one (should not occur) fall back to the kind so the digest still
  // reflects the block's presence rather than throwing.
  const range = model.preservation?.blockRanges.get(b.id);
  const source = range ? model.preservation?.originalParts.get(range.partName) : undefined;
  const slice = range && source !== undefined ? source.slice(range.start, range.end) : null;
  return { k: b.kind, slice };
}

function storyDigest(s: Story, model: PackageModel): unknown {
  return { kind: s.kind, blocks: s.blocks.map((b) => blockDigest(b, model)) };
}

/**
 * A canonical projection of a model's authored content: stories (in order, by kind + blocks),
 * styles, numbering, content types, and relationships — with volatile identity/preservation/revision
 * bookkeeping stripped. Feed to `stableHash` for the authored-state fingerprint.
 */
export function authoredStateProjection(model: PackageModel): unknown {
  return {
    stories: [...model.stories.values()].map((s) => storyDigest(s, model)),
    styles: model.styles,
    numbering: model.numbering,
    contentTypes: model.contentTypes,
    relationships: model.relationships,
  };
}

/** 16-hex authored-state fingerprint. Equal across a save+reopen iff the authored content is equal. */
export function authoredStateDigest(model: PackageModel): string {
  return stableHash(authoredStateProjection(model));
}
