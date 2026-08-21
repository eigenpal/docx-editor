// Every story's paragraphs are addressable before anyone opens that story.
//
// `w14:paraId` is minted when a story STORE opens, and only reaches the coordinator's package
// on the first commit. So a header nobody had clicked into carried none at all, and indexing
// the package copy verbatim left every one of its paragraphs unaddressable — `snapshot()` could
// not name them, and `exec({ setSelection, anchor })` answered `notFound`.
//
// The contract's own harness enters a story before asking anything, so it is structurally blind
// to this: entering is what mints the ids the assertion then finds.
//
// The id must also be the SAME one before and after opening. A durable anchor that changes
// under the caller is worse than none: it names a real paragraph, just not the one they meant.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { PART_OF_STORY, partOfNodeId, scopeOf } from './story-parity-harness.ts';
import { storyParityDocx, HEADER_R_ID, FOOTER_R_ID } from './story-parity-fixture.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

/** Mount WITHOUT entering any story, which is the state this is about. */
function mountUntouched(): DocxEditorInstance {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: storyParityDocx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

/** Every part the paraId index reaches, as zip entry names. */
function partsWithParaIds(editor: DocxEditorInstance): Set<string> {
  const parts = new Set<string>();
  for (const [nodeId] of editor.surface!.session.paragraphAnchors().paraIdByNode) {
    parts.add(partOfNodeId(nodeId));
  }
  return parts;
}

describe('a story nobody has opened is still addressable', () => {
  test('every story part carries paraIds on a fresh mount', () => {
    const editor = mountUntouched();
    const reached = partsWithParaIds(editor);
    for (const part of Object.values(PART_OF_STORY)) {
      expect(reached.has(part), `${part} has no addressable paragraph`).toBe(true);
    }
  });

  test('the paraId does not change when the story is opened', () => {
    const editor = mountUntouched();
    const surface = editor.surface!;

    const before = new Map(
      [...surface.session.paragraphAnchors().paraIdByNode].filter(
        ([nodeId]) => partOfNodeId(nodeId) === PART_OF_STORY.header
      )
    );
    expect(before.size, 'the header contributed no paraIds').toBeGreaterThan(0);

    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);
    const after = surface.session.paragraphAnchors().paraIdByNode;
    for (const [nodeId, paraId] of before) {
      // Minting is deterministic and seeded by the structural node id, so the read-side value
      // and the store's are the same value — which is the whole reason an anchor taken before
      // the story opened still names the paragraph the caller meant.
      expect(after.get(nodeId), `${nodeId} was re-minted on open`).toBe(paraId);
    }
  });

  test('an anchor taken before entry selects into the story', () => {
    const editor = mountUntouched();
    const surface = editor.surface!;

    const [nodeId, paraId] = [...surface.session.paragraphAnchors().paraIdByNode].find(
      ([id]) => partOfNodeId(id) === PART_OF_STORY.footer
    )!;
    const result = editor.exec({ type: 'setSelection', anchor: { paraId } });
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);

    // The scope followed the anchor, so the next keystroke lands in the footer rather than
    // in a store that has never heard of this paragraph.
    expect(surface.activeScope()).toEqual(scopeOf('footer'));
    expect(surface.state().selection.head.paragraphId).toBe(nodeId);
    void FOOTER_R_ID;
  });
});
