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
