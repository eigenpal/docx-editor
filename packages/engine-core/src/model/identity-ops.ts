// Structural identity rules (document-engine task 3.4 / lossless-package-model
// "Stable package and content identities"): split keeps the first fragment id and
// mints one for the tail; join keeps the first survivor id; move keeps identity;
// semantic replacement mints identity; deletion removes and undo restores the
// exact id. Ops accept an explicit id for REDO replay so a redone split restores
// the same tail id it originally minted (not a freshly allocated one).

import {
  type PackageModel,
  type ParagraphRecord,
  type RunRecord,
  type Story,
} from './authored-model.ts';
import { IdentityAllocator } from './identity.ts';

/** The subset of a paragraph's opening-tag attributes a SPLIT/derived paragraph may inherit: every
 *  attribute EXCEPT the unique per-paragraph identities (`w14:paraId`, `w14:textId`), which must not
 *  be duplicated. Namespace declarations (`xmlns:*`), markup-compatibility (`mc:*`), and revision ids
 *  (`w:rsid*`) are kept, so the tail's inherited `w:pPr` keeps the namespace/markup context those
 *  bytes depend on. Quote-aware. */
export function inheritableParagraphAttributes(attrs: string): string {
  let out = attrs;
  for (const name of ['w14:paraId', 'w14:textId']) {
    out = out.replace(new RegExp(`\\s+${name}\\s*=\\s*("[^"]*"|'[^']*')`, 'g'), '');
  }
  return out;
}

function findParagraph(
  model: PackageModel,
  paragraphId: string,
): { storyId: string; index: number; story: Story } | undefined {
  for (const [storyId, story] of model.stories) {
    const index = story.blocks.findIndex((b) => b.kind === 'paragraph' && b.id === paragraphId);
    if (index >= 0) return { storyId, index, story };
  }
  return undefined;
}

/** Split a run list at a character offset into [head, tail], splitting a run if needed. */
export function splitRunsAt(runs: readonly RunRecord[], offset: number): [RunRecord[], RunRecord[]] {
  const head: RunRecord[] = [];
  const tail: RunRecord[] = [];
  let remaining = offset;
  for (const run of runs) {
    if (remaining <= 0) tail.push(run);
    else if (remaining >= run.text.length) {
      head.push(run);
      remaining -= run.text.length;
    } else {
      head.push({ ...run, text: run.text.slice(0, remaining) });
      tail.push({ ...run, text: run.text.slice(remaining) });
      remaining = 0;
    }
  }
  return [head, tail];
}

function replaceStory(model: PackageModel, storyId: string, blocks: readonly ParagraphRecord[]): PackageModel {
  const story = model.stories.get(storyId)!;
  const stories = new Map(model.stories);
  stories.set(storyId, { ...story, blocks });
  return { ...model, stories };
}

export interface SplitResult {
  readonly model: PackageModel;
  readonly tailId: string;
}

/** Split a paragraph at a char offset. First fragment keeps its id; tail gets a new (or given) id. */
export function splitParagraph(
  model: PackageModel,
  paragraphId: string,
  charOffset: number,
  opts: { tailId?: string } = {},
): SplitResult {
  const loc = findParagraph(model, paragraphId);
  if (!loc) throw new Error(`paragraph ${paragraphId} not found`);
  const para = loc.story.blocks[loc.index] as ParagraphRecord;
  const [headRuns, tailRuns] = splitRunsAt(para.runs, charOffset);

  const alloc = new IdentityAllocator(model.identity);
  const tailId = opts.tailId ?? alloc.allocate('paragraph');
  const identity = opts.tailId ? model.identity : alloc.state();

  const first: ParagraphRecord = { ...para, runs: headRuns };
  // The tail inherits the head's paragraph properties — including the ownership-scoped w:pPr capsule
  // — so splitting a styled paragraph gives BOTH halves those properties (as Word does) and never
  // drops the capsule.
  // The w:pPr capsule (styles/spacing) is shared by both split halves, as Word does. The opening
  // ATTRIBUTES capsule is INHERITED WITHOUT its unique identities (w14:paraId/textId) so the tail
  // does not duplicate the head's identity, but KEEPS the namespace declarations + markup-compat +
  // rsid the copied w:pPr may depend on (a w:pPr using a w14: attribute needs the tail's xmlns:w14).
  const tailAttrs = para.pAttrsCapsule ? inheritableParagraphAttributes(para.pAttrsCapsule) : undefined;
  const tail: ParagraphRecord = {
    kind: 'paragraph',
    id: tailId,
    runs: tailRuns,
    props: para.props,
    ...(para.pPrCapsule ? { pPrCapsule: para.pPrCapsule } : {}),
    ...(tailAttrs ? { pAttrsCapsule: tailAttrs } : {}),
  };
  const blocks = loc.story.blocks as ParagraphRecord[];
  const next = [...blocks.slice(0, loc.index), first, tail, ...blocks.slice(loc.index + 1)];
  return { model: { ...replaceStory(model, loc.storyId, next), identity }, tailId };
}

/** Join `secondId` into `firstId`; the first survivor keeps its id, the second is removed. */
export function joinParagraphs(model: PackageModel, firstId: string, secondId: string): PackageModel {
  const first = findParagraph(model, firstId);
  const second = findParagraph(model, secondId);
  if (!first || !second) throw new Error('join target not found');
  if (first.storyId !== second.storyId) throw new Error('cannot join across stories');
  const firstPara = first.story.blocks[first.index] as ParagraphRecord;
  const secondPara = second.story.blocks[second.index] as ParagraphRecord;
  const merged: ParagraphRecord = { ...firstPara, runs: [...firstPara.runs, ...secondPara.runs] };
  const blocks = (first.story.blocks as ParagraphRecord[]).filter((b) => b.id !== secondId);
  const idx = blocks.findIndex((b) => b.id === firstId);
  blocks[idx] = merged;
  return replaceStory(model, first.storyId, blocks);
}

/** Move a block within its story; identity is retained. */
export function moveBlock(model: PackageModel, storyId: string, fromIndex: number, toIndex: number): PackageModel {
  const story = model.stories.get(storyId);
  if (!story) throw new Error(`unknown story ${storyId}`);
  const blocks = [...story.blocks];
  if (fromIndex < 0 || fromIndex >= blocks.length || toIndex < 0 || toIndex >= blocks.length) {
    throw new Error('move index out of range');
  }
  const [moved] = blocks.splice(fromIndex, 1);
  blocks.splice(toIndex, 0, moved);
  return replaceStory(model, storyId, blocks as ParagraphRecord[]);
}

export interface ReplaceResult {
  readonly model: PackageModel;
  readonly newId: string;
}

/** Semantic replacement: mint a new identity (or reuse a given one for redo). */
export function replaceParagraph(
  model: PackageModel,
  paragraphId: string,
  newRuns: readonly RunRecord[],
  opts: { newId?: string } = {},
): ReplaceResult {
  const loc = findParagraph(model, paragraphId);
  if (!loc) throw new Error(`paragraph ${paragraphId} not found`);
  const alloc = new IdentityAllocator(model.identity);
  const newId = opts.newId ?? alloc.allocate('paragraph');
  const identity = opts.newId ? model.identity : alloc.state();
  const replacement: ParagraphRecord = { kind: 'paragraph', id: newId, runs: [...newRuns] };
  const blocks = [...loc.story.blocks] as ParagraphRecord[];
  blocks[loc.index] = replacement;
  return { model: { ...replaceStory(model, loc.storyId, blocks), identity }, newId };
}

export interface DeleteResult {
  readonly model: PackageModel;
  readonly storyId: string;
  readonly index: number;
  readonly removed: ParagraphRecord;
}

/** Delete a paragraph, returning enough to restore its exact identity on undo. */
export function deleteParagraph(model: PackageModel, paragraphId: string): DeleteResult {
  const loc = findParagraph(model, paragraphId);
  if (!loc) throw new Error(`paragraph ${paragraphId} not found`);
  const removed = loc.story.blocks[loc.index] as ParagraphRecord;
  const blocks = (loc.story.blocks as ParagraphRecord[]).filter((_, i) => i !== loc.index);
  return { model: replaceStory(model, loc.storyId, blocks), storyId: loc.storyId, index: loc.index, removed };
}

/** Undo of delete: reinsert the removed paragraph at its index with its exact id. */
export function restoreParagraph(
  model: PackageModel,
  storyId: string,
  index: number,
  paragraph: ParagraphRecord,
): PackageModel {
  const story = model.stories.get(storyId);
  if (!story) throw new Error(`unknown story ${storyId}`);
  const blocks = [...story.blocks] as ParagraphRecord[];
  blocks.splice(index, 0, paragraph);
  return replaceStory(model, storyId, blocks);
}
