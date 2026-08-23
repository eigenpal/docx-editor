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
  scopeOf,
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
    test(`navigate('next') keeps the caret in the ${story}`, () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        open.surface.contentControls.navigate('next');
        // Against a body-only roster the caret's own control was never in the list, so its
        // index was always -1 and 'next' landed on the first control in the document body —
        // moving the caret out of the story while the scope still said it was open, which
        // refuses every keystroke after it.
        expect(partOfNodeId(open.surface.state().selection.head.paragraphId)).toBe(
          PART_OF_STORY[story]
        );
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

// A control is addressed by its OWN part-qualified id, so an explicitly-scoped call can be
// answered wherever the caret is. `gateContentControlCommand` refused every non-body scope
// outright, and `exec` runs the same gate — so a host that told the truth about where its
// caret was got refused on a control the caret path would have edited.
//
// The refusal that stays is the narrow one: an explicit `DocLocation` or `DocAnchor` target
// resolves against `session.part()`, the body's, and cannot address a furniture control.
describe('an explicit scope does not refuse a control the caret already resolves', () => {
  for (const story of STORIES_WITH_CONTROL) {
    if (story === 'body') continue;

    test(`can(setContentControlValue) in the ${story} is not refused for its scope`, () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        const at = open.surface.contentControls.atCaret();
        expect(at).not.toBeNull();
        const gate = open.editor.can(
          { type: 'setContentControlValue', target: undefined, value: 'X' },
          { scope: scopeOf(story) }
        );
        expect(gate.ok).toBe(true);
      } finally {
        open.destroy();
      }
    });

    test(`an explicit target in the ${story} refuses, and says why`, () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        const gate = open.editor.can(
          {
            type: 'setContentControlValue',
            target: { paragraphId: 'nope', offset: 0 },
            value: 'X',
          },
          { scope: scopeOf(story) }
        );
        expect(gate.ok).toBe(false);
        // The reason has to name the real limit. A generic "only the body scope is supported"
        // is what let a fixable gap read as a design decision for the length of this PR.
        expect(gate.ok === false && gate.reason).toContain('resolves in the body only');
      } finally {
        open.destroy();
      }
    });
  }
});
