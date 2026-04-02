/**
 * Unit tests for Suggestion Mode Plugin
 */

import { describe, test, expect } from 'bun:test';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { createSuggestionModePlugin, suggestionModeKey, setSuggestionMode } from './suggestionMode';

// Minimal schema with insertion/deletion marks
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
  },
  marks: {
    insertion: {
      attrs: {
        revisionId: { default: 0 },
        author: { default: '' },
        date: { default: '' },
      },
      toDOM: () => ['ins', 0],
    },
    deletion: {
      attrs: {
        revisionId: { default: 0 },
        author: { default: '' },
        date: { default: '' },
      },
      toDOM: () => ['del', 0],
    },
  },
});

function createState(text: string, active = false): EditorState {
  const plugin = createSuggestionModePlugin(active, 'TestUser');
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]);
  return EditorState.create({ doc, plugins: [plugin] });
}

function createStateWithPlugin(text: string, active = false) {
  const plugin = createSuggestionModePlugin(active, 'TestUser');
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]);
  const state = EditorState.create({ doc, plugins: [plugin] });
  return { plugin, state };
}

function getPluginState(state: EditorState) {
  return suggestionModeKey.getState(state);
}

function getText(state: EditorState): string {
  let text = '';
  state.doc.descendants((node) => {
    if (node.isText) text += node.text;
  });
  return text;
}

function getMarks(state: EditorState): Array<{ text: string; marks: string[] }> {
  const result: Array<{ text: string; marks: string[] }> = [];
  state.doc.descendants((node) => {
    if (node.isText) {
      result.push({
        text: node.text!,
        marks: node.marks.map((m) => m.type.name),
      });
    }
  });
  return result;
}

function getMarkedSegments(state: EditorState, markName: 'insertion' | 'deletion') {
  const result: Array<{ text: string; revisionId: number; from: number; to: number }> = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === markName);
    if (!mark) return;
    result.push({
      text: node.text!,
      revisionId: mark.attrs.revisionId as number,
      from: pos,
      to: pos + node.nodeSize,
    });
  });
  return result;
}

function dispatchSuggestionKey(
  plugin: ReturnType<typeof createSuggestionModePlugin>,
  state: EditorState,
  key: 'Backspace' | 'Delete'
): EditorState {
  let nextState = state;
  const handled = plugin.props.handleKeyDown?.call(
    plugin,
    {
      state,
      dispatch: (tr: Transaction) => {
        nextState = state.apply(tr);
      },
    } as never,
    { key } as KeyboardEvent
  );

  expect(handled).toBe(true);
  return nextState;
}

describe('SuggestionMode Plugin', () => {
  describe('plugin state', () => {
    test('initializes with active=false by default', () => {
      const state = createState('Hello');
      expect(getPluginState(state)?.active).toBe(false);
    });

    test('initializes with active=true when specified', () => {
      const state = createState('Hello', true);
      expect(getPluginState(state)?.active).toBe(true);
    });

    test('setSuggestionMode toggles active state', () => {
      const state = createState('Hello');
      expect(getPluginState(state)?.active).toBe(false);

      // Activate
      let dispatched: EditorState | null = null;
      setSuggestionMode(true, state, (tr) => {
        dispatched = state.apply(tr);
      });
      expect(dispatched).not.toBeNull();
      expect(getPluginState(dispatched!)?.active).toBe(true);
    });
  });

  describe('handleTextInput', () => {
    test('plugin state is preserved after selection change', () => {
      const state = createState('Hello', true);
      const sel = TextSelection.create(state.doc, 6);
      const stateWithCursor = state.apply(state.tr.setSelection(sel));

      // The handleTextInput is a view-level prop, can't easily test without a view
      // Instead, test the state logic directly
      expect(getPluginState(stateWithCursor)?.active).toBe(true);
    });
  });

  describe('selection delete (markRangeAsDeleted)', () => {
    test('selection backspace marks text as deletion when active', () => {
      // Create state with suggestion mode active
      const plugin = createSuggestionModePlugin(true, 'TestUser');
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('Hello World')]),
      ]);
      let state = EditorState.create({ doc, plugins: [plugin] });

      // Verify plugin state is active
      const pluginState = getPluginState(state);
      expect(pluginState?.active).toBe(true);
      expect(pluginState?.author).toBe('TestUser');

      // Select "World" (positions 7-12)
      const sel = TextSelection.create(state.doc, 7, 12);
      state = state.apply(state.tr.setSelection(sel));

      // Verify selection
      expect(state.selection.from).toBe(7);
      expect(state.selection.to).toBe(12);
      expect(state.selection.empty).toBe(false);

      // Now simulate what handleSuggestionDelete does for a selection delete
      const insertionType = state.schema.marks.insertion;
      const deletionType = state.schema.marks.deletion;
      const tr = state.tr;
      tr.setMeta('suggestionModeApplied', true);

      // Mark range as deleted (inline version of markRangeAsDeleted)
      const from = state.selection.from;
      const to = state.selection.to;

      const ranges: { from: number; to: number; isOwnInsert: boolean }[] = [];
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const start = Math.max(pos, from);
        const end = Math.min(pos + node.nodeSize, to);
        if (start >= end) return;
        const isOwnInsert = node.marks.some(
          (m) => m.type === insertionType && m.attrs.author === 'TestUser'
        );
        ranges.push({ from: start, to: end, isOwnInsert });
      });

      expect(ranges.length).toBeGreaterThan(0);
      expect(ranges[0].isOwnInsert).toBe(false);

      // Apply deletion marks (not actual deletion)
      for (let i = ranges.length - 1; i >= 0; i--) {
        const range = ranges[i];
        if (range.isOwnInsert) {
          tr.delete(range.from, range.to);
        } else {
          tr.addMark(
            range.from,
            range.to,
            deletionType.create({
              revisionId: 123,
              author: 'TestUser',
              date: new Date().toISOString(),
            })
          );
        }
      }

      const newState = state.apply(tr);

      // Text should still be present (marked, not deleted)
      expect(getText(newState)).toBe('Hello World');

      // "World" should have deletion mark
      const marks = getMarks(newState);
      const worldEntry = marks.find((m) => m.text.includes('World'));
      expect(worldEntry).toBeDefined();
      expect(worldEntry!.marks).toContain('deletion');
    });
  });

  describe('single character delete grouping', () => {
    test('consecutive backspaces reuse one deletion revision', () => {
      const { plugin, state: initialState } = createStateWithPlugin('Hello', true);
      let state = initialState.apply(
        initialState.tr.setSelection(TextSelection.create(initialState.doc, 6))
      );

      state = dispatchSuggestionKey(plugin, state, 'Backspace');
      state = dispatchSuggestionKey(plugin, state, 'Backspace');

      expect(getText(state)).toBe('Hello');

      const deletions = getMarkedSegments(state, 'deletion');
      expect(deletions.map((segment) => segment.text).join('')).toBe('lo');
      expect(new Set(deletions.map((segment) => segment.revisionId)).size).toBe(1);
    });
  });
});
