import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ref, shallowRef } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { useContextMenus } from './useContextMenus';

/**
 * Issue #929: in the Vue adapter, context-menu Cut/Copy did nothing because
 * `document.execCommand` ran while the hidden PM (left: -9999px) was not
 * focused. The handler must focus the editor BEFORE execCommand, like React.
 */

const calls: string[] = [];
let originalDocument: typeof globalThis.document | undefined;

beforeEach(() => {
  calls.length = 0;
  originalDocument = globalThis.document;
  // Minimal document stub: only execCommand is exercised by the cut/copy path.
  (globalThis as { document: unknown }).document = {
    execCommand: (cmd: string) => {
      calls.push(`execCommand:${cmd}`);
      return true;
    },
  };
});

afterEach(() => {
  (globalThis as { document: unknown }).document = originalDocument;
});

function makeOpts() {
  const view = {
    focus: mock(() => calls.push('focus')),
    state: {},
  } as unknown as EditorView;
  return {
    editorView: ref(view) as never,
    selectedImage: shallowRef(null),
    zoom: ref(1),
    showImageProperties: ref(false),
    getCommands: () => ({}),
    clearOverlay: () => {},
    setPmSelection: () => {},
    resolvePos: () => null,
  };
}

describe('useContextMenus cut/copy focus order (#929)', () => {
  test('Cut focuses the editor before document.execCommand', () => {
    const { handleContextMenuAction } = useContextMenus(makeOpts());
    handleContextMenuAction('cut');
    expect(calls).toContain('focus');
    expect(calls).toContain('execCommand:cut');
    // focus must come before the clipboard op, or the off-screen PM is not the
    // target and the cut is a no-op.
    expect(calls.indexOf('focus')).toBeLessThan(calls.indexOf('execCommand:cut'));
  });

  test('Copy focuses the editor before document.execCommand', () => {
    const { handleContextMenuAction } = useContextMenus(makeOpts());
    handleContextMenuAction('copy');
    expect(calls.indexOf('focus')).toBeLessThan(calls.indexOf('execCommand:copy'));
  });
});
