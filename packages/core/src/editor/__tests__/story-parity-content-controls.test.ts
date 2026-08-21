// A content control resolves in the story the caret is in, and its verbs write there.
//
// The sharpest test in the contract, because the defect it covers is the only one that edits
// content the user cannot see. `contentControlAtCaret` resolves the control from the caret's
// x/y against `layout.contentControls`, which holds BODY records only: `collectControls` looks
// for a `w:body` child, and a `w:hdr` root has none, so nothing is ever collected from
// furniture even if the part were passed. A header caret's coordinates then land in the body
// content box, a body control wins the hit test, and `setValue` and `remove` rewrite and delete
// body content while the reader is in a header.
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

const BODY_PART = PART_OF_STORY.body;

describe('a content control resolves in the story the caret is in', () => {
  for (const story of STORIES_WITH_CONTROL) {
    const known = story !== 'body';

    test(`atCaret names the ${story}'s own control${known ? ' (known broken)' : ''}`, () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        const at = open.surface.contentControls.atCaret();
        expect(at).not.toBeNull();
        // Ids carry a leading slash. Asserting it here means a change to the id shape fails
        // loudly instead of quietly shifting what `partOfNodeId` returns.
        expect(at!.id.startsWith('/')).toBe(true);

        if (known) {
          // Pinned to the BODY part, not merely "not the header's". `not.toBe` would also pass
          // if the resolver answered the footer's control, or a malformed id, which would be a
          // different bug wearing this one's clothes.
          expect(
            partOfNodeId(at!.id),
            `atCaret now resolves in the ${story}: drop the knownBroken`
          ).toBe(BODY_PART);
          expect(at!.tag).toBe(CONTROL_TAG.body);
          return;
        }
        expect(partOfNodeId(at!.id)).toBe(PART_OF_STORY[story]);
        expect(at!.tag).toBe(CONTROL_TAG[story]);
      } finally {
        open.destroy();
      }
    });

    test(`setValue writes only the ${story}'s part${known ? ' (known broken)' : ''}`, async () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        const at = open.surface.contentControls.atCaret();
        expect(at).not.toBeNull();
        const before = await savedParts(open);
        open.surface.contentControls.setValue(at!.id, 'REPLACED');
        const after = await savedParts(open);
        const changed = changedParts(before, after);

        if (known) {
          // The write lands in the BODY: the resolver handed over a body control, and the write
          // path pins the body scope besides. Both halves have to be fixed together, or a
          // corrected resolver writes into a store that has never heard of the control.
          expect(
            changed,
            `setValue from the ${story} now spares the body: drop the knownBroken`
          ).toContain(BODY_PART);
          expect(after.get(BODY_PART)).toContain('REPLACED');
          expect(after.get(PART_OF_STORY[story])).not.toContain('REPLACED');
          return;
        }
        expect(changed).toEqual([PART_OF_STORY[story]]);
        expect(after.get(PART_OF_STORY[story])).toContain('REPLACED');
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
        // The roster is body-only, so the caret's own control is never in it and 'next'
        // unconditionally lands on the first control in the document BODY.
        expect(
          partOfNodeId(open.surface.state().selection.head.paragraphId),
          `navigate now stays in the ${story}: drop the knownBroken`
        ).toBe(BODY_PART);
        // The corrupting half: the caret is in the body and the scope still says furniture, so
        // every keystroke after this routes to a store that has never heard of it.
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
