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
import { HEADER_R_ID, PROBE } from './story-parity-fixture.ts';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { buildParagraphAnchorIndex } from '../../binding/paragraph-anchors.ts';
import { resolveDocAnchor } from '../anchor-resolution.ts';
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

  // THE HOST'S ORDER, which every test above inverts. `openStory` enters the story before it
  // reads anything, and entering is what mints the story's paraIds — so the tests above only
  // ever ask the question after the answer exists. A real host reads `snapshot()` on mount,
  // long before the reader opens a header, and that read used to poison the index with a
  // body-only answer that nothing invalidated for the rest of the session.
  test('reading the index before entering a header does not poison it', () => {
    const open = openStory('body');
    try {
      const before = open.surface.session.paragraphAnchors();
      expect(before.paraIdByNode.size).toBeGreaterThan(0);

      expect(open.surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);
      const headerParagraph = open.surface.session.paragraphIdsIn({
        kind: 'headerFooter',
        rId: HEADER_R_ID,
      })[0]!;

      const after = open.surface.session.paragraphAnchors();
      expect(
        after.paraIdByNode.get(headerParagraph),
        'the header is unaddressable after a read that preceded it'
      ).toBeTruthy();
    } finally {
      open.destroy();
    }
  });

  test('a paraId two stories both claim is refused rather than guessed', () => {
    const index = buildParagraphAnchorIndex([
      twinPart('/word/document.xml'),
      twinPart('/word/header1.xml'),
    ]);
    expect([...index.ambiguousParaIds]).toEqual([TWIN_PARA_ID]);
    const resolved = resolveDocAnchor(twinPart('/word/document.xml'), index, {
      paraId: TWIN_PARA_ID,
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    // Refused, not resolved to whichever story happened to come first.
    expect(resolved.code).toBe('ambiguous');
  });
});

const TWIN_PARA_ID = '11112222';

/** A one-paragraph part whose `w14:paraId` is deliberately the same in every story. */
function twinPart(name: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W_NS}" xmlns:w14="${W14_NS}"><w:body>` +
      `<w:p w14:paraId="${TWIN_PARA_ID}"><w:r><w:t>twin</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
    { name, contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
