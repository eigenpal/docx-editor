// Authored-state digest (document-engine task 3.7 "reopen to equivalent authored-state hashes").
// Projects the SEMANTIC authored content of a PackageModel — what a user authored — and fingerprints
// it under the frozen `authoredState` comparator (canonical-exact). It deliberately EXCLUDES volatile
// bookkeeping that legitimately differs across a save+reopen while the authored content is unchanged:
// internal block/story identity ids, the identity allocator cursors, the byte-level preservation
// index, and the live revision. Two models with the same authored content therefore share a digest,
// which is exactly the equivalence a complete-export round-trip must preserve.

import type { PackageModel, Block, Story, RunRecord } from '../model/authored-model.ts';
import { normalizeRuns } from '../model/normalize-runs.ts';
import {
  canonicalParagraphProps,
  canonicalRunProps,
  canonicalStyle,
  canonicalDocDefaults,
} from '../model/paragraph-props.ts';
import { hashPreservableBlock } from './wml-preserve.ts';
import { stableHash } from '../comparators/canonical.ts';

function runDigest(r: RunRecord): unknown {
  // Text + the authored formatting facts: modeled props and the verbatim run-properties capsule.
  // (id is volatile identity, excluded.)
  return { text: r.text, props: r.props ?? null, rPr: r.rPrCapsule ?? null };
}

function blockDigest(b: Block): unknown {
  if (b.kind === 'paragraph') {
    // Strip volatile ids BEFORE normalizing so adjacent identically-formatted runs merge regardless
    // of their (excluded) ids — then lexically-different-but-equivalent segmentations ([{"a"},{"b"}]
    // vs [{"ab"}]) share a digest, matching how the model treats them.
    const idless = b.runs.map((r) => {
      const rp = canonicalRunProps(r.props);
      return {
        text: r.text,
        ...(rp ? { props: rp } : {}),
        ...(r.rPrCapsule ? { rPrCapsule: r.rPrCapsule } : {}),
      };
    });
    return {
      k: 'paragraph',
      // An empty-string capsule is a no-op the serializer treats as absent — digest it as null so the
      // two representations never drift.
      pPr: b.pPrCapsule ? b.pPrCapsule : null,
      attrs: b.pAttrsCapsule ? b.pAttrsCapsule : null,
      // Canonicalize modeled props so a degenerate value ({} / '' id / non-integer ilvl) digests the
      // same absence the parser produces on reopen.
      props: canonicalParagraphProps(b.props) ?? null,
      runs: normalizeRuns(idless).map(runDigest),
    };
  }
  // Non-paragraph blocks (table, sdt): digest the block's COMPLETE current semantic subtree via the
  // same id-independent content hash the exporter uses for edit detection. This reflects a table-cell
  // paragraph edit (the baseline source slice would NOT — it is the pre-edit bytes, giving edited and
  // unedited tables the same digest), captures structural props/grid so two differently-authored
  // tables differ, and stays symmetric across save+reopen (equal model content -> equal hash).
  return { k: b.kind, h: hashPreservableBlock(b) };
}

function storyDigest(s: Story): unknown {
  return { kind: s.kind, blocks: s.blocks.map((b) => blockDigest(b)) };
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
    stories: [...model.stories.values()].map((s) => storyDigest(s)),
    // Canonicalize styles + docDefaults so a degenerate authored value (runProps:{}, isDefault:false,
    // empty basedOn) digests the same form the serializer emits and the parser yields on reopen.
    styles: model.styles.map(canonicalStyle),
    numbering: model.numbering,
    docDefaults: canonicalDocDefaults(model.docDefaults) ?? null,
    themeFonts: model.themeFonts ?? null,
  };
}

/** 16-hex authored-state fingerprint. Equal across a save+reopen iff the authored content is equal. */
export function authoredStateDigest(model: PackageModel): string {
  return stableHash(authoredStateProjection(model));
}
