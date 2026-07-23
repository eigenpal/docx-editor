// Deterministic model normalization (document-engine task 4.6). Rules are idempotent and
// order-free so equivalent converged inputs produce byte-equivalent normalized authored state.
// The PER-KIND rules (merge adjacent identical-prop runs, recurse tables/SDTs) live in the model
// block-capability registry (comprehensive 3.2/3.3) — this module only walks stories and dispatches
// each block through `blockNormalize`, so a new block kind normalizes by registering a capability,
// not by editing a switch here. Identity is preserved (no id is minted or dropped).

import { type PackageModel, type Story, type Block, blockNormalize, normalizeRuns } from '../model/index.ts';

export { normalizeRuns };

/** Normalize one block by dispatching to its registered capability; the capability recurses nested
 *  blocks (table cells, SDT content) back through `normalizeBlocks`, so no kind is special-cased. */
function normalizeBlock(block: Block): Block {
  return blockNormalize(block, normalizeBlocks);
}

/** Normalize a block list, returning the SAME array reference when nothing changed. */
function normalizeBlocks(blocks: readonly Block[]): readonly Block[] {
  let changed = false;
  const out = blocks.map((b) => {
    const nb = normalizeBlock(b);
    if (nb !== b) changed = true;
    return nb;
  });
  return changed ? out : blocks;
}

/** Normalize every story's blocks recursively; each story keeps its block count. */
export function normalize(model: PackageModel): PackageModel {
  let changed = false;
  const stories = new Map(model.stories);
  for (const [storyId, story] of model.stories) {
    const blocks = normalizeBlocks(story.blocks);
    if (blocks !== story.blocks) {
      const next: Story = { ...story, blocks };
      stories.set(storyId, next);
      changed = true;
    }
  }
  return changed ? { ...model, stories } : model;
}
