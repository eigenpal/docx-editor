// Vue tree-lane wiring contract (legacy-lane retirement, phase 3).
//
// The Vue mirror of `packages/react/test/docx-editor-one-surface.test.ts`. Both adapters
// are held to the SAME rules by the same assertions, so a divergence shows up as a
// failing test rather than as a behavioural surprise: thin host, composition-root
// facade, `Editor` contract only, no adapter geometry.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VUE_SRC = join(import.meta.dir, '..', 'src');
const REACT_SRC = join(import.meta.dir, '..', '..', 'react', 'src');
const editorSource = readFileSync(join(VUE_SRC, 'DocxEditor.ts'), 'utf8');
// The React host is sugar over its provider-first composition primitives, so the shared
// wiring (surface classes, setZoom) lives across the sugar component and those files.
const reactEditorSource = [
  join(REACT_SRC, 'components', 'DocxEditor.tsx'),
  join(REACT_SRC, 'editor', 'DocxEditorRoot.tsx'),
  join(REACT_SRC, 'editor', 'DocxEditorViewport.tsx'),
  join(REACT_SRC, 'editor', 'DocxEditorContent.tsx'),
]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

describe('Vue tree-lane wiring (phase 3)', () => {
  test('the editor is created through the composition root facade', () => {
    expect(editorSource).toContain('createDocxEditor');
    expect(editorSource).toContain("from '@docx-editor.dev/core/editor'");
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
    for (const forbidden of ['onPointerdown', 'onPointermove', 'onPointerup', 'onKeydown']) {
      expect(editorSource).not.toContain(forbidden);
    }
  });

  test('the adapter never imports ProseMirror or a private engine package', () => {
    for (const forbidden of ['prosemirror', 'engine-binding', 'engine-layout', 'engine-core']) {
      expect(editorSource.toLowerCase()).not.toContain(forbidden);
    }
  });

  test('the facade is destroyed on teardown', () => {
    expect(editorSource).toContain('destroy()');
  });

  test('both adapters mount the surface into the same shared container classes', () => {
    for (const source of [editorSource, reactEditorSource]) {
      expect(source).toContain('docx-editor');
      expect(source).toContain('docx-paginated-surface');
    }
  });

  test('zoom flows through setZoom on both adapters, never a remount', () => {
    for (const source of [editorSource, reactEditorSource]) {
      expect(source).toContain('setZoom');
    }
  });

  test('document changes are forwarded from the facade change event', () => {
    expect(editorSource).toContain("on('change'");
  });
});
