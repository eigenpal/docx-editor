// React tree-lane wiring contract (legacy-lane retirement, phase 3).
//
// `DocxEditor` is a THIN host over `createDocxEditor`: it owns a container element, the
// facade's lifetime, and prop-to-facade forwarding — nothing else. These assertions are
// the static half a headless run can enforce on every commit: the adapter must reach the
// engine through the composition root, program against the `Editor` contract alone, and
// derive no geometry of its own. The predecessor of this file pinned the legacy display
// pipeline (adapter event bridge, display lists, paint gates); the tree lane's surface
// owns interaction and painting internally, so those rules are replaced, not dropped.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', 'src');

// The host is now sugar over the provider-first composition layer, so the wiring these
// rules pin lives across the sugar component AND the primitives it composes. The rules
// apply to the union: the facade must be created/destroyed somewhere in this set, and
// the forbidden symbols must appear nowhere in it.
const editorSource = [
  join(SRC, 'components', 'DocxEditor.tsx'),
  join(SRC, 'editor', 'context.ts'),
  join(SRC, 'editor', 'loading-snapshot.ts'),
  join(SRC, 'editor', 'DocxEditorRoot.tsx'),
  join(SRC, 'editor', 'DocxEditorViewport.tsx'),
  join(SRC, 'editor', 'DocxEditorContent.tsx'),
  join(SRC, 'editor', 'useEditorState.ts'),
  join(SRC, 'editor', 'useEditorCommand.ts'),
  join(SRC, 'editor', 'useEditorEvent.ts'),
]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

describe('React tree-lane wiring (phase 3)', () => {
  test('the editor is created through the composition root facade', () => {
    expect(editorSource).toContain('createDocxEditor');
    expect(editorSource).toContain("from '@docx-editor.dev/core-contract/editor'");
    // The legacy engine constructor and its display pipeline must be gone.
    for (const forbidden of [
      'createEditor(',
      'attachAdapterEventBridge',
      'installDisplayFonts',
      'PaintEpochGate',
      'EditorHost',
    ]) {
      expect(editorSource).not.toContain(forbidden);
    }
  });

  test('the adapter programs against the Editor contract, never the surface escape hatch', () => {
    // `DocxEditorInstance.surface` exists for harnesses and tests; a production adapter that
    // reaches through it is depending on internals the contract does not name.
    expect(editorSource).not.toContain('.surface');
  });

  test('no adapter-side geometry derivation', () => {
    for (const forbidden of [
      'getBoundingClientRect',
      'getClientRects',
      'elementFromPoint',
      'caretRangeFromPoint',
    ]) {
      expect(editorSource).not.toContain(forbidden);
    }
  });

  test('no hand-rolled listeners for input the surface owns', () => {
    // The paginated surface owns pointer, keyboard, caret, and selection internally.
    for (const forbidden of ['onPointerDown=', 'onPointerMove=', 'onPointerUp=', 'onKeyDown=']) {
      expect(editorSource).not.toContain(forbidden);
    }
  });

  test('the adapter never imports ProseMirror or a private engine package', () => {
    for (const forbidden of ['prosemirror', 'engine-binding', 'engine-layout', 'engine-core']) {
      expect(editorSource.toLowerCase()).not.toContain(forbidden);
    }
  });

  test('the facade is destroyed on cleanup', () => {
    expect(editorSource).toContain('instance.destroy()');
  });

  test('the container carries the shared style-scope and surface classes', () => {
    // ep-root scopes every --doc-* token; docx-paginated-surface carries the engine
    // surface's paper styling. Without either, pages paint unstyled.
    expect(editorSource).toContain('ep-root');
    expect(editorSource).toContain('docx-paginated-surface');
  });

  test('zoom flows through setZoom, never a remount', () => {
    // Remounting on zoom reopens the document from bytes and discards every edit,
    // the caret, and the undo history.
    expect(editorSource).toContain('setZoom');
  });

  test('document changes are forwarded from the facade change event', () => {
    expect(editorSource).toContain("on('change'");
  });
});
