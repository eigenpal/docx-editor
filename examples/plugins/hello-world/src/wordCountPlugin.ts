/**
 * Word Count Plugin — Hello World example
 *
 * A minimal EditorPlugin that tracks word and character counts
 * and displays them in a collapsible right-hand panel.
 */

import type { EditorPlugin, PluginPanelProps } from '@eigenpal/docx-js-editor';
import React from 'react';

// -- Plugin state -----------------------------------------------------------

interface WordCountState {
  words: number;
  characters: number;
  paragraphs: number;
}

// -- Panel component --------------------------------------------------------

function WordCountPanel({ pluginState }: PluginPanelProps<WordCountState>) {
  const { words, characters, paragraphs } = pluginState ?? {
    words: 0,
    characters: 0,
    paragraphs: 0,
  };

  return React.createElement(
    'div',
    { style: { padding: 16, fontFamily: 'system-ui, sans-serif', fontSize: 14 } },
    React.createElement('h3', { style: { margin: '0 0 12px', fontSize: 15 } }, 'Word Count'),
    React.createElement(
      'table',
      { style: { width: '100%', borderCollapse: 'collapse' } },
      React.createElement(
        'tbody',
        null,
        row('Words', words),
        row('Characters', characters),
        row('Paragraphs', paragraphs)
      )
    )
  );
}

function row(label: string, value: number) {
  const cellStyle = { padding: '6px 0', borderBottom: '1px solid #eee' };
  return React.createElement(
    'tr',
    { key: label },
    React.createElement('td', { style: { ...cellStyle, color: '#666' } }, label),
    React.createElement(
      'td',
      { style: { ...cellStyle, textAlign: 'right' as const, fontWeight: 600 } },
      value.toLocaleString()
    )
  );
}

// -- Plugin definition ------------------------------------------------------

export const wordCountPlugin: EditorPlugin<WordCountState> = {
  id: 'word-count',
  name: 'Word Count',

  Panel: WordCountPanel,

  panelConfig: {
    position: 'right',
    defaultSize: 220,
    minSize: 180,
    collapsible: true,
    defaultCollapsed: false,
  },

  initialize: () => ({ words: 0, characters: 0, paragraphs: 0 }),

  onStateChange(view) {
    const text = view.state.doc.textContent;
    return {
      words: text.split(/\s+/).filter(Boolean).length,
      characters: text.length,
      paragraphs: view.state.doc.childCount,
    };
  },
};
