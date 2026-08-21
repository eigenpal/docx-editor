// A paragraph in any story has an address, and the facade can see and use it.
//
// The paraId index covered the main part alone, and the comment on it named `DocLocation` as
// the way to reach the rest — but `resolveAnchorSelection` refuses `DocLocation` endpoints
// outright, so NO addressing form reached a header, footer or note paragraph. The visible
// consequence was `snapshot().selection` reading null for the whole time the caret was in one,
// which is an agent that cannot see where the user is, and `hyperlinkAt` answering null on a
// link the caret was standing in.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { STORY_KINDS } from './story-parity-contract.ts';
import { PROBE } from './story-parity-fixture.ts';
import { caretIn, openStory, partOfNodeId, PART_OF_STORY } from './story-parity-harness.ts';

describe('every story is addressable', () => {
  for (const story of STORY_KINDS) {
    test(`a ${story} paragraph has a paraId`, () => {
      const open = openStory(story);
      try {
        const anchors = open.surface.session.paragraphAnchors();
        for (const paragraphId of open.paragraphIds) {
          expect(
            anchors.paraIdByNode.get(paragraphId),
            `no paraId for a ${story} paragraph`
          ).toBeTruthy();
        }
      } finally {
        open.destroy();
      }
    });

    test(`snapshot().selection reports a caret in the ${story}`, () => {
      const open = openStory(story);
      try {
        caretIn(open, PROBE.plain);
        const selection = open.editor.snapshot().selection;
        expect(selection, `snapshot().selection is null in the ${story}`).not.toBeNull();
      } finally {
        open.destroy();
      }
    });

    test(`the paraId round-trips back to the same ${story} paragraph`, () => {
      const open = openStory(story);
      try {
        const anchors = open.surface.session.paragraphAnchors();
        const paragraphId = open.paragraphIds[PROBE.plain]!;
        const paraId = anchors.paraIdByNode.get(paragraphId)!;
        // Back to the SAME node, in the same part — not to a twin the body happens to hold.
        const resolved = anchors.nodeByParaId.get(paraId.toUpperCase());
        expect(resolved).toBe(paragraphId);
        expect(partOfNodeId(resolved!)).toBe(PART_OF_STORY[story]);
      } finally {
        open.destroy();
      }
    });
  }

  test('every paraId in the document is distinct', () => {
    const open = openStory('body');
    try {
      const anchors = open.surface.session.paragraphAnchors();
      // Minting is unique per PART and the contract's uniqueness is per DOCUMENT, so the
      // index records any id two stories claim rather than resolving it to whichever came
      // first. A file this engine wrote must never have one.
      expect([...anchors.ambiguousParaIds]).toEqual([]);
      expect(anchors.nodeByParaId.size).toBe(anchors.paraIdByNode.size);
    } finally {
      open.destroy();
    }
  });
});
