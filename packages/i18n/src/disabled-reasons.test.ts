import { describe, expect, test } from 'bun:test';
import { createT, en, localizeDisabledReason } from './index';

describe('localizeDisabledReason', () => {
  test('translates known chrome refusals', () => {
    const t = createT({
      ...en,
      disabledReason: {
        ...en.disabledReason,
        editorNotReady: 'Localized editor state',
      },
    });

    expect(localizeDisabledReason('editor is not ready', t)).toBe('Localized editor state');
  });

  test('preserves unknown engine diagnostics', () => {
    expect(localizeDisabledReason('custom refusal detail', createT(en))).toBe(
      'custom refusal detail'
    );
  });

  // The table is a plain object, so it answers these from its PROTOTYPE — with a function,
  // which the lookup then handed to `t()`. This is a `@public` entry point and the reason
  // reaching it comes from the engine, so the guard is cheap insurance rather than a live
  // bug; without it these throw rather than passing through.
  test.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'passes %s through as an unknown diagnostic',
    (reason) => {
      expect(localizeDisabledReason(reason, createT(en))).toBe(reason);
    }
  );
});

describe('every refusal the section-break lane publishes is translatable', () => {
  // An engine `disabledReason` is text a user reads. English-in-the-engine is the pattern
  // here, but only paired with a `DISABLED_REASON_KEYS` entry — without one the string
  // reaches every locale raw, and nothing else catches that.
  const t = createT(en);

  test.each([
    'a section break can only be inserted in the editable document body',
    'a section break that changes where the next section starts cannot be suggested; turn off suggesting to insert it',
    'a section break cannot be inserted inside a table cell',
    'a section break cannot change a section that a locked or linked content control holds',
    'a section break cannot be inserted in locked or linked content',
  ])('%s', (reason) => {
    const localized = localizeDisabledReason(reason, t);
    expect(localized).not.toBe(reason);
    expect(localized?.length ?? 0).toBeGreaterThan(0);
  });
});

test('the empty reviewer roster refusal is translatable', () => {
  const reason = 'the document has no review authors';
  expect(localizeDisabledReason(reason, createT(en))).not.toBe(reason);
});
