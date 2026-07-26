// Minimal authored-model edit primitives (document-engine task 2.9). These prove
// a created model is semantically editable before any serializer exists. They
// mutate only the authored model and preserve authored omission (no resolved
// values are written). Section 4 wraps these as DocOp handlers inside the
// transactional store; normalization/merging (task 4.6) is not applied here.

import {
  type PackageModel,
  type ParagraphRecord,
  type RunRecord,
  type Story,
} from './authored-model.ts';
import { IdentityAllocator } from './identity.ts';

/** Append an empty paragraph to a story; returns the updated model and new id. */
export function appendParagraph(
  model: PackageModel,
  storyId: string
): { model: PackageModel; paragraphId: string } {
  const story = model.stories.get(storyId);
  if (!story) throw new Error(`unknown story ${storyId}`);
  const alloc = new IdentityAllocator(model.identity);
  const paragraphId = alloc.allocate('paragraph');
  const paragraph: ParagraphRecord = { kind: 'paragraph', id: paragraphId, runs: [] };
  const updated: Story = { ...story, blocks: [...story.blocks, paragraph] };
  const stories = new Map(model.stories);
  stories.set(storyId, updated);
  return { model: { ...model, stories, identity: alloc.state() }, paragraphId };
}

/** Insert a NEW paragraph (with the given runs) at `index` in a story, minting an id.
 *  `index` must be within [0, blocks.length] (length = append); an out-of-range index is
 *  REJECTED rather than clamped, so a stale/invalid position can never silently misorder the
 *  canonical block sequence. */
export function insertParagraph(
  model: PackageModel,
  storyId: string,
  index: number,
  runs: readonly RunRecord[]
): { model: PackageModel; paragraphId: string } {
  const story = model.stories.get(storyId);
  if (!story) throw new Error(`unknown story ${storyId}`);
  if (index < 0 || index > story.blocks.length) {
    throw new Error(`insertParagraph index ${index} out of range [0, ${story.blocks.length}]`);
  }
  const alloc = new IdentityAllocator(model.identity);
  const paragraphId = alloc.allocate('paragraph');
  const paragraph: ParagraphRecord = { kind: 'paragraph', id: paragraphId, runs: [...runs] };
  const blocks = [...story.blocks];
  blocks.splice(index, 0, paragraph);
  const stories = new Map(model.stories);
  stories.set(storyId, { ...story, blocks });
  return { model: { ...model, stories, identity: alloc.state() }, paragraphId };
}

/** Append a text run to a paragraph (by id), searching every story. */
export function insertTextIntoParagraph(
  model: PackageModel,
  paragraphId: string,
  text: string,
  props?: RunRecord['props']
): PackageModel {
  for (const [storyId, story] of model.stories) {
    const idx = story.blocks.findIndex((b) => b.kind === 'paragraph' && b.id === paragraphId);
    if (idx < 0) continue;
    const para = story.blocks[idx] as ParagraphRecord;
    const run: RunRecord = props ? { text, props } : { text };
    const newPara: ParagraphRecord = { ...para, runs: [...para.runs, run] };
    const blocks = [...story.blocks];
    blocks[idx] = newPara;
    const stories = new Map(model.stories);
    stories.set(storyId, { ...story, blocks });
    return { ...model, stories };
  }
  throw new Error(`paragraph ${paragraphId} not found`);
}

/** Replace a paragraph's runs while KEEPING its id (ReplaceBlockContent, task 6.4). */
export function setParagraphRuns(
  model: PackageModel,
  paragraphId: string,
  runs: readonly RunRecord[]
): PackageModel {
  for (const [storyId, story] of model.stories) {
    const idx = story.blocks.findIndex((b) => b.kind === 'paragraph' && b.id === paragraphId);
    if (idx < 0) continue;
    const para = story.blocks[idx] as ParagraphRecord;
    const blocks = [...story.blocks];
    blocks[idx] = { ...para, runs: [...runs] };
    const stories = new Map(model.stories);
    stories.set(storyId, { ...story, blocks });
    return { ...model, stories };
  }
  throw new Error(`paragraph ${paragraphId} not found`);
}

/** Total run text of a paragraph (for assertions/queries; not a resolved cache). */
export function paragraphText(model: PackageModel, paragraphId: string): string | undefined {
  for (const story of model.stories.values()) {
    const p = story.blocks.find((b) => b.kind === 'paragraph' && b.id === paragraphId) as
      | ParagraphRecord
      | undefined;
    if (p) return p.runs.map((r) => r.text).join('');
  }
  return undefined;
}
