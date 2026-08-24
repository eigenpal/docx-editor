/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
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
import * as model from '../model/index.ts';

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
  test('is the namespace with server and collaborative byte factories', () => {
    expect(Object.keys(root.DocxEditor).sort()).toEqual(['createCollaborative', 'createServer']);
    expect(typeof root.DocxEditor.createServer).toBe('function');
  });

  test('does not offer the editor-bound factory, at any spelling', () => {
    expect('createBrowser' in root.DocxEditor).toBe(false);
    expect((root as Record<string, unknown>).createBrowser).toBeUndefined();
  });

  test('carries the vocabulary a caller needs to name what they are handed', () => {
    const expected = [
      ...Object.keys(model),
      'ClientObject',
      'ClientResult',
      'RequestContext',
      'TrackedObjects',
      'DocxEditorError',
      'isDocxEditorError',
    ];
    for (const name of expected) {
      expect(root).toHaveProperty(name);
    }
    expect(expected.length).toBeGreaterThan(20);
  });

  test('exports model classes as runtime values from both entries', () => {
    const classes = Object.entries(model)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name);

    expect(classes.length).toBeGreaterThan(20);
    for (const name of classes) {
      expect(typeof (root as Record<string, unknown>)[name]).toBe('function');
      expect(typeof (browser as Record<string, unknown>)[name]).toBe('function');
    }
  });

  test('exports nothing that served a removed surface', () => {
    expect(REMOVED.filter((name) => name in root)).toEqual([]);
  });
});

describe('the browser entry', () => {
  test('is a superset: both factories, one namespace', () => {
    expect(Object.keys(browser.DocxEditor).sort()).toEqual([
      'createBrowser',
      'createCollaborative',
      'createServer',
    ]);
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
