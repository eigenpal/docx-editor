import { describe, it, expect } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { EditorContextMenuOverlay } from './EditorContextMenuOverlay';

describe('EditorContextMenuOverlay', () => {
  it('renders without throwing', () => {
    expect(() =>
      renderToString(
        <EditorContextMenuOverlay renderedDomContext={null} editorView={null} spellcheckState={null} />
      )
    ).not.toThrow();
  });
});
