// What a consumer gets when they import the package.
//
// The manifest test next door says which files ship. This one says what is IN them, because an
// exports map can be correct while the module behind it still re-exports a reviewer.
//
// The two entries are deliberately asymmetric: the root offers `createServer` only, the browser
// subpath offers both. That asymmetry is the whole reason there are two, so it is asserted rather
// than described.

import { describe, expect, test } from 'bun:test';
import * as root from '../index.ts';
import * as browser from '../browser.ts';

/** Names the legacy package exported. None of them has an equivalent; all of them are gone. */
const REMOVED = [
  'DocxReviewer',
  'createReviewerBridge',
  'agentTools',
  'executeToolCall',
  'getToolSchemas',
  'createMcpServer',
  'createEditorBridge',
  'useAgentChat',
  'useDocxAgentTools',
  'AgentPanel',
  'AgentChatLog',
  'AgentComposer',
  'AgentTimeline',
  'getToolDisplayName',
  'TextNotFoundError',
  'ChangeNotFoundError',
  'CommentNotFoundError',
];

describe('the root entry', () => {
  test('is the namespace, with the byte factory only', () => {
    expect(Object.keys(root.DocxEditor).sort()).toEqual(['createServer']);
    expect(typeof root.DocxEditor.createServer).toBe('function');
  });

  test('does not offer the editor-bound factory, at any spelling', () => {
    expect('createBrowser' in root.DocxEditor).toBe(false);
    expect((root as Record<string, unknown>).createBrowser).toBeUndefined();
  });

  test('carries the vocabulary a caller needs to name what they are handed', () => {
    for (const name of [
      'Body',
      'Document',
      'Font',
      'Paragraph',
      'ParagraphCollection',
      'Range',
      'RangeCollection',
      'ClientObject',
      'ClientResult',
      'RequestContext',
      'TrackedObjects',
      'DocxEditorError',
      'isDocxEditorError',
    ]) {
      expect(root).toHaveProperty(name);
    }
  });

  test('exports nothing that served a removed surface', () => {
    expect(REMOVED.filter((name) => name in root)).toEqual([]);
  });
});

describe('the browser entry', () => {
  test('is a superset: both factories, one namespace', () => {
    expect(Object.keys(browser.DocxEditor).sort()).toEqual(['createBrowser', 'createServer']);
    expect(typeof browser.DocxEditor.createBrowser).toBe('function');
  });

  test('offers the same vocabulary as the root, so the two cannot drift', () => {
    const named = (module: object): string[] =>
      Object.keys(module)
        .filter((name) => name !== 'DocxEditor')
        .sort();
    expect(named(browser)).toEqual(named(root));
  });

  test('exports nothing that served a removed surface either', () => {
    expect(REMOVED.filter((name) => name in browser)).toEqual([]);
  });
});
