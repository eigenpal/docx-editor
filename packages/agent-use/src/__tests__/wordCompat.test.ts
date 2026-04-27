import { describe, test, expect } from 'bun:test';
import type { WordCompatBridge } from '../wordCompat';
import { createEditorBridge, type EditorRefLike } from '../bridge';

/**
 * Runtime parity tests. These verify that an EditorBridge instance, when
 * narrowed to the WordCompatBridge interface, has every method present and
 * callable. The compile-time assertion in `wordCompat.ts` already proves
 * structural compatibility; these tests prove the runtime instance does too.
 */

function makeRef(): EditorRefLike {
  let nextId = 1;
  return {
    getDocument: () => null,
    getEditorRef: () => null,
    addComment: () => nextId++,
    replyToComment: () => nextId++,
    resolveComment: () => {},
    proposeChange: () => true,
    scrollToParaId: () => true,
    findInDocument: () => [],
    getSelectionInfo: () => null,
    getComments: () => [],
    onContentChange: () => () => undefined,
    onSelectionChange: () => () => undefined,
  };
}

describe('WordCompatBridge — runtime parity', () => {
  const bridge = createEditorBridge(makeRef(), 'TestAgent');
  // The compile-time assertion is the formal proof. The runtime cast verifies
  // the real bridge instance satisfies the contract at the call-site level.
  const wordy: WordCompatBridge = bridge;

  test('every documented method is present', () => {
    const expectedMethods: Array<keyof WordCompatBridge> = [
      'getContentAsText',
      'getContent',
      'getComments',
      'getChanges',
      'findText',
      'getSelection',
      'addComment',
      'replyTo',
      'resolveComment',
      'proposeChange',
      'scrollTo',
      'onContentChange',
      'onSelectionChange',
    ];
    for (const name of expectedMethods) {
      expect(typeof wordy[name]).toBe('function');
    }
  });

  test('getContentAsText / getContent return without throwing on an empty doc', () => {
    expect(typeof wordy.getContentAsText()).toBe('string');
    expect(Array.isArray(wordy.getContent())).toBe(true);
  });

  test('findText returns an array', () => {
    expect(Array.isArray(wordy.findText('whatever'))).toBe(true);
  });

  test('getSelection returns null when nothing is selected', () => {
    expect(wordy.getSelection()).toBeNull();
  });

  test('addComment returns null or a number id', () => {
    const id = wordy.addComment({ paraId: 'p_a3f', text: 'note' });
    expect(id === null || typeof id === 'number').toBe(true);
  });

  test('proposeChange returns boolean', () => {
    expect(typeof wordy.proposeChange({ paraId: 'p_a3f', search: 'x', replaceWith: 'y' })).toBe(
      'boolean'
    );
  });

  test('scrollTo returns boolean', () => {
    expect(typeof wordy.scrollTo('p_a3f')).toBe('boolean');
  });

  test('onContentChange returns an unsubscribe function', () => {
    const off = wordy.onContentChange(() => undefined);
    expect(typeof off).toBe('function');
    off();
  });

  test('onSelectionChange returns an unsubscribe function', () => {
    const off = wordy.onSelectionChange(() => undefined);
    expect(typeof off).toBe('function');
    off();
  });

  test('replyTo returns null or a number id', () => {
    const id = wordy.replyTo(1, { text: 'reply' });
    expect(id === null || typeof id === 'number').toBe(true);
  });
});
