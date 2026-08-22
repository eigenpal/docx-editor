// The order these public reads fall back to spans every story.
//
// `selectionRects` and `spansInSelection` take the ACTIVE story's paragraph order. Omitting it
// used to mean the BODY's, and that is what made a multi-paragraph selection in a header come
// back empty: both endpoints ranked -1 against a list they were not in, the walk gave up, and
// the size box emptied on a two-paragraph header selection.
//
// The default is now every story the layout paints. A selection cannot span two stories, so
// only the order within one is ever compared — which makes the shared list correct, not merely
// convenient.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  everyStoryOrder,
  selectionRects,
  spansInSelection,
} from '@docx-editor.dev/core/layout';
import { STORY_KINDS } from './story-parity-contract.ts';
import { PROBE } from './story-parity-fixture.ts';
import { openStory } from './story-parity-harness.ts';

describe('everyStoryOrder serves a selection in any story', () => {
  for (const story of STORY_KINDS) {
    test(`${story}: a two-paragraph selection reads through the shared order`, () => {
      const open = openStory(story);
      try {
        const from = open.paragraphIds[PROBE.formatted]!;
        const to = open.paragraphIds[PROBE.plain]!;
        open.surface.setSelection({
          anchor: { paragraphId: from, offset: 0 },
          head: { paragraphId: to, offset: 1 },
        });
        const layout = open.surface.publishedLayout();
        const selection = open.surface.state().selection;

        // `everyStoryOrder` is what a caller with no story in hand passes. Against the body's
        // order this came back empty for every story but the body: both endpoints ranked -1
        // against a list they were not in and the walk gave up.
        const every = everyStoryOrder(layout);
        expect(spansInSelection(layout, selection, every).length, 'no spans').toBeGreaterThan(0);

        // And it agrees with the story's OWN order, which is what makes the shared list
        // correct rather than merely non-empty.
        const scoped = every.filter((id) => id.startsWith(partOf(from)));
        expect(spansInSelection(layout, selection, every)).toEqual(
          spansInSelection(layout, selection, scoped)
        );

        // `selectionRects` is deliberately NOT asserted non-empty: bands do not paint in
        // furniture, which is a documented limit of the paint lane, not of this order.
        expect(() => selectionRects(layout, selection, every)).not.toThrow();
      } finally {
        open.destroy();
      }
    });
  }
});

/** The part a node id belongs to, with its `#` separator, for a prefix match. */
function partOf(nodeId: string): string {
  return `${nodeId.slice(0, nodeId.indexOf('#'))}#`;
}
