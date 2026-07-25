import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditor } from '../src/create-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/editor';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';
import type { SemanticSelection } from '@docx-editor.dev/core-contract/interaction';

function hostWith(body: HTMLElement): EditorHost {
  return {
    getBodyHostEl: () => body,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

describe('createEditor setSelection command', () => {
  test('syncs frame-bound semantic selection through the public exec surface', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Etiqueta',
    });

    const entries = editor.getAccessibilityObservation().entries.filter((entry) => entry.role === 'editableParagraph');
    const blockId = entries[0]!.identity.blockId;
    const storyId = entries[0]!.identity.storyId;
    const frameId = editor.getInteractionFrame().id;
    const selection: SemanticSelection = {
      frameId,
      scope: { kind: 'body' },
      anchor: {
        kind: 'text',
        scope: { kind: 'body' },
        identity: { storyId, blockId },
        graphemeOffset: 0,
        affinity: 'upstream',
      },
      head: {
        kind: 'text',
        scope: { kind: 'body' },
        identity: { storyId, blockId },
        graphemeOffset: 3,
        affinity: 'downstream',
      },
    };

    const set = editor.exec({ type: 'setSelection', range: selection });
    expect(set.ok).toBe(true);
    const focus = editor.focus();
    expect(focus.ok).toBe(true);

    const obs = editor.getAccessibilityObservation();
    expect(obs.focus.focused).toBe(true);
    expect(obs.selection?.collapsed).toBe(false);
    if (obs.selection?.anchor.kind === 'text' && obs.selection.head.kind === 'text') {
      expect(obs.selection.anchor.identity.blockId).toBe(blockId);
      expect(obs.selection.head.identity.blockId).toBe(blockId);
      expect(obs.selection.anchor.graphemeOffset).toBe(0);
      expect(obs.selection.head.graphemeOffset).toBe(3);
    }

    editor.destroy();
    body.remove();
  });
});

// The locked-block refusal, which shipped with no coverage (correctness re-review,
// High 2): deleting the check left the whole suite green.
//
// A partially editable document locks INDIVIDUAL blocks. `session.editable` is
// document-wide and stays true, and a locked paragraph is a real model block, so it
// resolves cleanly against canonical state — nothing else in the path stops the caret
// from moving into it. When it did, the frame reported a selection inside the block
// while the accessibility observation reported none, and every keystroke that followed
// was refused by the reverse mapper.
describe('createEditor setSelection refuses read-only blocks', () => {
  test('a caret cannot be placed in a locked paragraph', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const fixture = path.resolve(import.meta.dir, '../../../e2e/fixtures/comprehensive-word-element-test.docx');
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({ host: hostWith(body), document: new Uint8Array(readFileSync(fixture)) });

    const entries = editor.getAccessibilityObservation().entries;
    const locked = entries.find((e) => e.role === 'unsupportedStructure');
    const editable = entries.find((e) => e.role === 'editableParagraph' && e.text.length > 3);
    // The fixture must exercise BOTH, or this proves nothing about partial mode.
    expect(locked, 'fixture locks no paragraph').toBeDefined();
    expect(editable, 'fixture has no editable paragraph').toBeDefined();

    const at = (identity: { storyId: string; blockId: string }): SemanticSelection => ({
      frameId: editor.getInteractionFrame().id,
      scope: { kind: 'body' },
      anchor: { kind: 'text', scope: { kind: 'body' }, identity, graphemeOffset: 0, affinity: 'downstream' },
      head: { kind: 'text', scope: { kind: 'body' }, identity, graphemeOffset: 0, affinity: 'downstream' },
    });

    const refused = editor.exec({ type: 'setSelection', range: at(locked!.identity) });
    expect(refused.ok, 'a locked paragraph accepted a caret').toBe(false);
    expect(refused.ok === false && refused.code).toBe('locked');
    // The canonical selection did not move into it.
    const head = editor.getInteractionFrame().selection?.head;
    if (head && head.kind === 'text') expect(head.identity.blockId).not.toBe(locked!.identity.blockId);

    // The control: the same call on an editable paragraph succeeds, so the refusal above
    // is about the POLICY and not about this document refusing every selection.
    expect(editor.exec({ type: 'setSelection', range: at(editable!.identity) }).ok).toBe(true);

    editor.destroy();
    body.remove();
  });
});
