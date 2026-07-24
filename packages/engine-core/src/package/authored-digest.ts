// Authored-state digest (document-engine task 3.7 "reopen to equivalent authored-state hashes").
// Projects the SEMANTIC authored content of a PackageModel — what a user authored — and fingerprints
// it under the frozen `authoredState` comparator (canonical-exact). It deliberately EXCLUDES volatile
// bookkeeping that legitimately differs across a save+reopen while the authored content is unchanged:
// internal block/story identity ids, the identity allocator cursors, the byte-level preservation
// index, and the live revision. Two models with the same authored content therefore share a digest,
// which is exactly the equivalence a complete-export round-trip must preserve.

import type { PackageModel, Block, Story, RunRecord } from '../model/authored-model.ts';
import { normalizeRuns } from '../model/normalize-runs.ts';
import { canonicalParagraphProps } from '../model/paragraph-props.ts';
import { stableHash } from '../comparators/canonical.ts';

function runDigest(r: RunRecord): unknown {
  // Text + the authored formatting facts: modeled props and the verbatim run-properties capsule.
  // (id is volatile identity, excluded.)
  return { text: r.text, props: r.props ?? null, rPr: r.rPrCapsule ?? null };
}

function blockDigest(b: Block, model: PackageModel): unknown {
  if (b.kind === 'paragraph') {
    // Strip volatile ids BEFORE normalizing so adjacent identically-formatted runs merge regardless
    // of their (excluded) ids — then lexically-different-but-equivalent segmentations ([{"a"},{"b"}]
    // vs [{"ab"}]) share a digest, matching how the model treats them.
    const idless = b.runs.map((r) => ({ text: r.text, ...(r.props ? { props: r.props } : {}), ...(r.rPrCapsule ? { rPrCapsule: r.rPrCapsule } : {}) }));
    return {
      k: 'paragraph',
      pPr: b.pPrCapsule ?? null,
      attrs: b.pAttrsCapsule ?? null,
      // Canonicalize modeled props so a degenerate value ({} / '' id / non-integer ilvl) digests the
      // same absence the parser produces on reopen.
      props: canonicalParagraphProps(b.props) ?? null,
      runs: normalizeRuns(idless).map(runDigest),
    };
  }
  // Non-paragraph blocks (table, sdt) are preserved verbatim and never regenerated; their authored
  // content IS their byte-exact source range, so digest that slice (id-free). A preserved block
  // ALWAYS has a range; a non-paragraph block with no slice cannot be faithfully compared, so fail
  // closed rather than collapse two differently-authored tables to an equal {k, slice:null} hash.
  const range = model.preservation?.blockRanges.get(b.id);
  const source = range ? model.preservation?.originalParts.get(range.partName) : undefined;
  if (!range || source === undefined) {
    throw new Error(`cannot digest a '${b.kind}' block without a preservation source range (block ${b.id})`);
  }
  return { k: b.kind, slice: source.slice(range.start, range.end) };
}

function storyDigest(s: Story, model: PackageModel): unknown {
  return { kind: s.kind, blocks: s.blocks.map((b) => blockDigest(b, model)) };
}

/**
 * A canonical projection of a model's authored content: stories (in order, by kind + blocks),
 * styles, and numbering — with volatile identity/preservation/revision bookkeeping stripped.
 * contentTypes/relationships are DELIBERATELY excluded: parseDocx does not model per-file OPC
 * records (it returns createEmptyModel defaults, the actual bytes living in the verbatim
 * preservation index), so hashing them would be false assurance — they are always equal regardless
 * of the file. OPC-record preservation is proven by the byte/container comparators, not this digest.
 */
export function authoredStateProjection(model: PackageModel): unknown {
  return {
    stories: [...model.stories.values()].map((s) => storyDigest(s, model)),
    styles: model.styles,
    numbering: model.numbering,
    docDefaults: model.docDefaults ?? null, // document-wide default formatting is authored state
  };
}

/** 16-hex authored-state fingerprint. Equal across a save+reopen iff the authored content is equal. */
export function authoredStateDigest(model: PackageModel): string {
  return stableHash(authoredStateProjection(model));
}
