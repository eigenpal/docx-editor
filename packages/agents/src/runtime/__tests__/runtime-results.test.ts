// The box a method's value arrives in.
//
// `ClientResult` is the runtime primitive for "a method promised you a value, and the sync that
// fills it has not happened yet". No member of the object model in this slice returns one — the
// reads here are properties, filled by `load` — so it is tested directly rather than through a
// model object written only to have something to call. The behaviour worth pinning is the empty
// state: reading it early is a typed refusal, never `undefined` flowing onwards.

import { describe, expect, test } from 'bun:test';
import { clientResult } from '../client-result.ts';
import { isDocxEditorError } from '../errors.ts';

describe('a value a method promised', () => {
  test('is not readable before the sync that fills it, and says which call it was', () => {
    const { result } = clientResult<string>('document.body.getText');
    expect(result.isLoaded).toBe(false);
    try {
      void result.value;
      throw new Error('reading an unfilled result should have been refused');
    } catch (error) {
      expect(isDocxEditorError(error)).toBe(true);
      if (isDocxEditorError(error)) {
        expect(error.code).toBe('ValueNotLoaded');
        expect(error.target).toBe('document.body.getText');
      }
    }
  });

  test('reads back exactly what filled it, once', () => {
    const { result, fill } = clientResult<string>('some.call');
    fill('answered');
    expect([result.isLoaded, result.value]).toEqual([true, 'answered']);
  });

  test('holds a falsy value as a value, not as absence', () => {
    const { result, fill } = clientResult<string>('some.call');
    fill('');
    expect(result.isLoaded).toBe(true);
    expect(result.value).toBe('');
  });

  test('cannot be filled by whoever is holding it', () => {
    const { result } = clientResult<string>('some.call');
    // The filling half is a separate value the action keeps; nothing on the box itself sets it.
    expect(Object.keys(result)).toEqual([]);
    expect((result as unknown as Record<string, unknown>)['fill']).toBeUndefined();
  });
});
