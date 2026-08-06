// `editorScopeFor`: the instance scope, distinct from the styling scope.
//
// The chrome parts self-emit `.ep-root` (styling), so a bare `closest('.ep-root')` from
// inside the toolbar or menu bar matches the part's own root — which contains no pages —
// and Cmd+S scoping and focus-return silently broke. This pins the climb: past
// styling-only roots to the container that actually holds the painted pages.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { editorScopeFor } from '../src/editor/editor-scope';

function el(className: string, parent: Element): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  parent.appendChild(node);
  return node;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('editorScopeFor', () => {
  test('climbs past a self-scoped chrome root to the instance container', () => {
    // The packaged arrangement: wrapper(.ep-root) > [toolbar(.ep-root), viewport(.ep-root) > pages]
    const wrapper = el('ep-root', document.body);
    const toolbar = el('ep-root docx-toolbar', wrapper);
    const button = el('docx-toolbar__button', toolbar);
    const viewport = el('ep-root docx-editor-viewport', wrapper);
    el('docx-pages', viewport);

    // From inside the toolbar: NOT the toolbar's own styling root — the wrapper.
    expect(editorScopeFor(button)).toBe(wrapper);
    expect(editorScopeFor(toolbar)).toBe(wrapper);
    // From inside the viewport the viewport itself qualifies; it contains the pages.
    expect(editorScopeFor(viewport)).toBe(viewport);
  });

  test('a bare composition with no instance container resolves to null', () => {
    const toolbar = el('ep-root docx-toolbar', document.body);
    const button = el('docx-toolbar__button', toolbar);
    expect(editorScopeFor(button)).toBeNull();
    expect(editorScopeFor(null)).toBeNull();
  });
});
