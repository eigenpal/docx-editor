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
