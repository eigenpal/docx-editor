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
});

describe('every refusal the section-break lane publishes is translatable', () => {
  // An engine `disabledReason` is text a user reads. English-in-the-engine is the pattern
  // here, but only paired with a `DISABLED_REASON_KEYS` entry — without one the string
  // reaches every locale raw, and nothing else catches that.
  const t = createT(en);

  test.each([
    'a section break can only be inserted in the editable document body',
    'a section break that changes where the next section starts cannot be suggested; turn off suggesting to insert it',
  ])('%s', (reason) => {
    const localized = localizeDisabledReason(reason, t);
    expect(localized).not.toBe(reason);
    expect(localized?.length ?? 0).toBeGreaterThan(0);
  });
});
