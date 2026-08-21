// A content control resolves in the story the caret is in, and its verbs write there.
//
// The sharpest test in the contract, because the defect it was written for is the only one
// that edited content the user could not see. `contentControlAtCaret` resolved the control
// from the caret's x/y against `layout.contentControls`, which holds BODY records only. A
// header caret's coordinates land in the top band of the body content box, so a body control
// won the hit test, and `setValue` and `remove` rewrote and deleted body content while the
// reader was editing a header.
//
// The assertions are structural rather than behavioural: node ids are part-qualified, so "did
// this resolve in the right story" is a question about the id's prefix, and that holds however
// the resolver is later rewritten.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { CONTROL_TAG, STORIES_WITH_CONTROL } from './story-parity-fixture.ts';
import {
  caretInControl,
  changedParts,
  openStory,
  PART_OF_STORY,
  partOfNodeId,
  savedParts,
} from './story-parity-harness.ts';

describe('a content control resolves in the story the caret is in', () => {
  for (const story of STORIES_WITH_CONTROL) {
    test(`atCaret names the ${story}'s own control`, () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        const at = open.surface.contentControls.atCaret();
        expect(at).not.toBeNull();
        // Ids carry a leading slash. Asserting it means a change to the id shape fails loudly
        // instead of quietly shifting what `partOfNodeId` returns.
        expect(at!.id.startsWith('/')).toBe(true);
        expect(partOfNodeId(at!.id)).toBe(PART_OF_STORY[story]);
        // By TAG as well as by part: every story's control is tagged with its own name, so a
        // resolve that lands in the right part but on the wrong control still fails.
        expect(at!.tag).toBe(CONTROL_TAG[story]);
      } finally {
        open.destroy();
      }
    });

    test(`setValue writes only the ${story}'s part`, async () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        const at = open.surface.contentControls.atCaret();
        expect(at).not.toBeNull();
        const before = await savedParts(open);
        expect(open.surface.contentControls.setValue(at!.id, 'REPLACED')).toBe(true);
        const after = await savedParts(open);

        expect(changedParts(before, after)).toEqual([PART_OF_STORY[story]]);
        expect(after.get(PART_OF_STORY[story])).toContain('REPLACED');
        // The body is the part this used to damage, so it is named explicitly rather than
        // left to the "only one part changed" assertion above.
        for (const other of STORIES_WITH_CONTROL) {
          if (other === story) continue;
          expect(after.get(PART_OF_STORY[other])).not.toContain('REPLACED');
        }
      } finally {
        open.destroy();
      }
    });

    test(`remove deletes only the ${story}'s control`, async () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        const at = open.surface.contentControls.atCaret();
        expect(at).not.toBeNull();
        const before = await savedParts(open);
        expect(open.surface.contentControls.remove(at!.id)).toBe(true);
        const after = await savedParts(open);

        expect(changedParts(before, after)).toEqual([PART_OF_STORY[story]]);
        expect(after.get(PART_OF_STORY[story])).not.toContain(CONTROL_TAG[story]);
        for (const other of STORIES_WITH_CONTROL) {
          if (other === story) continue;
          expect(after.get(PART_OF_STORY[other])).toContain(CONTROL_TAG[other]);
        }
      } finally {
        open.destroy();
      }
    });
  }

  for (const story of ['header', 'footer'] as const) {
    test(`navigate('next') keeps the caret in the ${story} (known broken)`, () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        open.surface.contentControls.navigate('next');
        // The tab roster is still built from `contentControlsInLayout`, which is body-only, so
        // the caret's own control is never in it and 'next' lands on the first control in the
        // document BODY. The caret then sits in the body while the scope still says furniture,
        // and every keystroke after it routes to a store that has never heard of it.
        expect(
          partOfNodeId(open.surface.state().selection.head.paragraphId),
          `navigate now stays in the ${story}: drop the knownBroken`
        ).toBe(PART_OF_STORY.body);
        expect(open.surface.activeScope()).toEqual({
          kind: 'headerFooter',
          rId: story === 'header' ? 'rId10' : 'rId11',
        });
      } finally {
        open.destroy();
      }
    });
  }
});
