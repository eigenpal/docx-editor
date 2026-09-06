// Text-box story expansion for navigation Find, indexed once per owning package part.

import type { ViewScope } from '../contracts/editor.ts';
import { storyParagraphs } from '../store/package/story-blocks.ts';
import { textboxStoriesInPart, type TextboxStoryRoot } from '../store/package/textbox-stories.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';

/** One root searched by navigation Find. Internal to the binding lane. */
export interface SearchStory {
  readonly part: OoxmlPart;
  readonly root: OoxmlNode;
  readonly scope?: ViewScope;
}

/** Work counters used by the linear-complexity regression test. */
export interface TextboxStoryExpansionWork {
  indexBuilds: number;
  hostLookups: number;
  indexedFrames: number;
}

type FrameIndex = ReadonlyMap<string, readonly TextboxStoryRoot[]>;
type TextboxStoriesOf = (part: OoxmlPart) => readonly TextboxStoryRoot[];

function indexFramesByHost(
  part: OoxmlPart,
  work: TextboxStoryExpansionWork | undefined,
  textboxStoriesOf: TextboxStoriesOf
): FrameIndex {
  const mutable = new Map<string, TextboxStoryRoot[]>();
  const frames = textboxStoriesOf(part);
  for (const frame of frames) {
    const atHost = mutable.get(frame.hostParagraphId);
    if (atHost) atHost.push(frame);
    else mutable.set(frame.hostParagraphId, [frame]);
  }
  if (work) {
    work.indexBuilds += 1;
    work.indexedFrames += frames.length;
  }
  return mutable;
}

function framesInStory(
  story: SearchStory,
  index: FrameIndex,
  work?: TextboxStoryExpansionWork
): readonly TextboxStoryRoot[] {
  const frames: TextboxStoryRoot[] = [];
  for (const paragraph of storyParagraphs(story.root)) {
    if (work) work.hostLookups += 1;
    const atHost = index.get(paragraph.id);
    if (!atHost) continue;
    for (const frame of atHost) frames.push(frame);
  }
  return frames;
}

/**
 * Add selectable body and furniture text-box stories after their owning story.
 *
 * Note text boxes remain excluded until note drawing layout and overlay lookup support them.
 * The enumeration itself lists only boxes layout can paint and an overlay can resolve.
 */
export function expandSelectableTextboxStories(
  stories: readonly SearchStory[],
  work?: TextboxStoryExpansionWork,
  textboxStoriesOf: TextboxStoriesOf = textboxStoriesInPart
): SearchStory[] {
  const expanded: SearchStory[] = [];
  const indexes = new Map<OoxmlPart, FrameIndex>();
  for (const story of stories) {
    expanded.push(story);
    // A note owns no selectable frame, so it earns neither the index nor the paragraph walk.
    if (story.scope?.kind === 'note') continue;
    let index = indexes.get(story.part);
    if (!index) {
      index = indexFramesByHost(story.part, work, textboxStoriesOf);
      indexes.set(story.part, index);
    }
    for (const frame of framesInStory(story, index, work)) {
      const owner = story.scope;
      expanded.push({
        part: story.part,
        root: frame.root,
        scope: {
          kind: 'frame',
          id: frame.root.id,
          drawingNodeId: frame.drawingNodeId,
          hostParagraphId: frame.hostParagraphId,
          ...(owner?.kind === 'headerFooter' ? { owner } : {}),
        },
      });
    }
  }
  return expanded;
}
