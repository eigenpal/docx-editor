/**
 * Unit tests for ParagraphChangeTrackerExtension
 */

import { describe, test, expect } from 'bun:test';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { AddMarkStep, RemoveMarkStep } from 'prosemirror-transform';
import {
  getChangedParagraphIds,
  hasStructuralChanges,
  hasUntrackedChanges,
  clearTrackedChanges,
  ParagraphChangeTrackerExtension,
} from './ParagraphChangeTrackerExtension';

// Minimal schema with paraId support
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: {
        paraId: { default: null },
        textId: { default: null },
      },
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: {
      parseDOM: [{ tag: 'strong' }],
      toDOM() {
        return ['strong', 0];
      },
    },
  },
});

// Get the plugin from the extension
const ext = ParagraphChangeTrackerExtension();
const runtime = ext.onSchemaReady({ schema });
const plugin = runtime.plugins![0];

function createDoc(...paras: Array<{ text: string; paraId?: string }>) {
  return schema.node(
    'doc',
    null,
    paras.map((p) =>
      schema.node('paragraph', { paraId: p.paraId ?? null }, p.text ? [schema.text(p.text)] : [])
    )
  );
}

function createState(paras: Array<{ text: string; paraId?: string }>) {
  const doc = createDoc(...paras);
  return EditorState.create({ doc, plugins: [plugin] });
}

function typeText(state: EditorState, text: string, pos?: number): EditorState {
  const insertPos = pos ?? state.selection.from;
  const tr = state.tr.insertText(text, insertPos);
  return state.apply(tr);
}

function deleteRange(state: EditorState, from: number, to: number): EditorState {
  const tr = state.tr.delete(from, to);
  return state.apply(tr);
}

function setSelection(state: EditorState, pos: number): EditorState {
  const tr = state.tr.setSelection(TextSelection.create(state.doc, pos));
  return state.apply(tr);
}

// ============================================================================
// Tests
// ============================================================================

describe('ParagraphChangeTrackerExtension', () => {
  describe('mark-only edits (selective save)', () => {
    test('tracks paraId when bold is added (AddMarkStep has empty step map)', () => {
      let state = createState([
        { text: 'Hello', paraId: 'P1' },
        { text: 'World', paraId: 'P2' },
      ]);

      const bold = schema.marks.bold.create();
      const tr = state.tr.step(new AddMarkStep(1, 6, bold));
      state = state.apply(tr);

      const changed = getChangedParagraphIds(state);
      expect(changed.has('P1')).toBe(true);
      expect(changed.has('P2')).toBe(false);
    });

    test('tracks paraId when bold is removed (RemoveMarkStep)', () => {
      let state = createState([{ text: 'Hello', paraId: 'P1' }]);
      const bold = schema.marks.bold.create();
      state = state.apply(state.tr.step(new AddMarkStep(1, 6, bold)));
      expect(state.doc.textBetween(1, 6)).toBe('Hello');

      const tr = state.tr.step(new RemoveMarkStep(1, 6, bold));
      state = state.apply(tr);

      expect(getChangedParagraphIds(state).has('P1')).toBe(true);
    });
  });

  describe('single paragraph edit', () => {
    test('tracks changed paraId when text is inserted', () => {
      let state = createState([
        { text: 'Hello', paraId: 'P1' },
        { text: 'World', paraId: 'P2' },
      ]);

      // Type in the first paragraph (position 1 = inside first para)
      state = typeText(state, ' there', 6); // After "Hello"

      const changed = getChangedParagraphIds(state);
      expect(changed.has('P1')).toBe(true);
      expect(changed.has('P2')).toBe(false);
    });

    test('tracks changed paraId when text is deleted', () => {
      let state = createState([
        { text: 'Hello', paraId: 'P1' },
        { text: 'World', paraId: 'P2' },
      ]);

      // Delete "lo" from "Hello" (positions 4-6 in doc)
      state = deleteRange(state, 4, 6);

      const changed = getChangedParagraphIds(state);
      expect(changed.has('P1')).toBe(true);
      expect(changed.has('P2')).toBe(false);
    });
  });

  describe('multi-paragraph formatting', () => {
    test('tracks multiple paraIds when editing different paragraphs', () => {
      let state = createState([
        { text: 'First', paraId: 'P1' },
        { text: 'Second', paraId: 'P2' },
        { text: 'Third', paraId: 'P3' },
      ]);

      // Insert inside P1 (pos 2 = inside first paragraph)
      state = typeText(state, 'X', 2);
      expect(getChangedParagraphIds(state).has('P1')).toBe(true);

      // Find P3 start position dynamically and insert there
      let p3Start = 0;
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.attrs.paraId === 'P3') {
          p3Start = pos + 1; // Inside the paragraph
        }
      });
      state = typeText(state, 'Y', p3Start);

      const changed = getChangedParagraphIds(state);
      expect(changed.has('P1')).toBe(true);
      expect(changed.has('P3')).toBe(true);
    });
  });

  describe('structural changes', () => {
    test('detects paragraph split (Enter key creates new paragraph)', () => {
      let state = createState([{ text: 'Hello World', paraId: 'P1' }]);

      // Split the paragraph: replace text from pos 6 to 6 with a new paragraph node
      const tr = state.tr.split(6);
      state = state.apply(tr);

      expect(hasStructuralChanges(state)).toBe(true);
    });

    test('detects paragraph merge (join)', () => {
      let state = createState([
        { text: 'First', paraId: 'P1' },
        { text: 'Second', paraId: 'P2' },
      ]);

      // Join at the boundary between the two paragraphs
      // End of P1 is at position 6, start of P2 is at position 7
      const tr = state.tr.join(7);
      state = state.apply(tr);

      expect(hasStructuralChanges(state)).toBe(true);
    });
  });

  describe('no-edit scenario', () => {
    test('has empty changed set when no edits are made', () => {
      const state = createState([
        { text: 'Hello', paraId: 'P1' },
        { text: 'World', paraId: 'P2' },
      ]);

      expect(getChangedParagraphIds(state).size).toBe(0);
      expect(hasStructuralChanges(state)).toBe(false);
    });

    test('has empty changed set after selection-only change', () => {
      let state = createState([
        { text: 'Hello', paraId: 'P1' },
        { text: 'World', paraId: 'P2' },
      ]);

      // Just move the cursor — no content change
      state = setSelection(state, 3);

      expect(getChangedParagraphIds(state).size).toBe(0);
      expect(hasStructuralChanges(state)).toBe(false);
    });
  });

  describe('paragraphs without paraId', () => {
    test('sets hasUntrackedChanges when editing paragraph with no paraId', () => {
      let state = createState([
        { text: 'Hello', paraId: undefined },
        { text: 'World', paraId: 'P2' },
      ]);

      // Edit the first paragraph which has no paraId
      state = typeText(state, 'X', 1);

      expect(hasUntrackedChanges(state)).toBe(true);
    });

    test('does not set hasUntrackedChanges when editing tracked paragraphs', () => {
      let state = createState([
        { text: 'Hello', paraId: 'P1' },
        { text: 'World', paraId: 'P2' },
      ]);

      state = typeText(state, 'X', 1);
      expect(hasUntrackedChanges(state)).toBe(false);
    });
  });

  describe('clear after save', () => {
    test('clears all tracked state', () => {
      let state = createState([
        { text: 'Hello', paraId: 'P1' },
        { text: 'World', paraId: 'P2' },
      ]);

      // Make some edits
      state = typeText(state, 'X', 1);

      expect(getChangedParagraphIds(state).size).toBeGreaterThan(0);

      // Clear tracked changes
      const clearTr = clearTrackedChanges(state);
      state = state.apply(clearTr);

      expect(getChangedParagraphIds(state).size).toBe(0);
      expect(hasStructuralChanges(state)).toBe(false);
      expect(hasUntrackedChanges(state)).toBe(false);
    });

    test('tracks new changes after clear', () => {
      let state = createState([
        { text: 'Hello', paraId: 'P1' },
        { text: 'World', paraId: 'P2' },
      ]);

      // Edit P1
      state = typeText(state, 'X', 1);

      // Clear
      state = state.apply(clearTrackedChanges(state));

      // Edit P2 (position after P1: doc[0]=p1(6 chars), doc[1]=p2 starts at 8)
      state = typeText(state, 'Y', 9);

      const changed = getChangedParagraphIds(state);
      expect(changed.has('P1')).toBe(false);
      expect(changed.has('P2')).toBe(true);
    });
  });

  describe('accumulation across multiple transactions', () => {
    test('accumulates changes across multiple edits', () => {
      let state = createState([
        { text: 'A', paraId: 'P1' },
        { text: 'B', paraId: 'P2' },
        { text: 'C', paraId: 'P3' },
      ]);

      // Edit P1
      state = typeText(state, 'X', 2);
      expect(getChangedParagraphIds(state).has('P1')).toBe(true);

      // Find P3 position dynamically
      let p3Start = 0;
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.attrs.paraId === 'P3') {
          p3Start = pos + 1;
        }
      });
      state = typeText(state, 'Y', p3Start);

      const changed = getChangedParagraphIds(state);
      expect(changed.has('P1')).toBe(true);
      expect(changed.has('P3')).toBe(true);
      expect(changed.has('P2')).toBe(false);
    });
  });
});
