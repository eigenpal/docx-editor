// The key a strict check skips an unchanged replica on: it changes with every edit to the
// shared state, a deletion alone included, and with a new editor tree.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { sameShownState, shownStateOf } from './scenario-shown-state.ts';

test('an unchanged replica keeps its key, and every change to its shared state or tree moves it', () => {
  const ydoc = new Y.Doc();
  const text = ydoc.getText('body');
  text.insert(0, 'Alpha');
  const tree = { revision: 1 };
  const passed = shownStateOf(ydoc, tree);
  expect(sameShownState(passed, shownStateOf(ydoc, tree))).toBe(true);

  // A new editor tree alone.
  expect(sameShownState(passed, shownStateOf(ydoc, { revision: 1 }))).toBe(false);

  // A deletion leaves the state vector as it was; the delete set moves.
  text.delete(0, 1);
  expect(sameShownState(passed, shownStateOf(ydoc, tree))).toBe(false);

  // An insertion from another replica.
  const before = shownStateOf(ydoc, tree);
  const peer = new Y.Doc();
  peer.getText('body').insert(0, 'Bravo');
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peer));
  expect(sameShownState(before, shownStateOf(ydoc, tree))).toBe(false);
});
