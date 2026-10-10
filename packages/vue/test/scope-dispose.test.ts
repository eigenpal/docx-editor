import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { mountSugarAsync } from './helpers/mount';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Vue scope disposal on packaged mount', () => {
  test('mounting DocxEditor does not warn about onScopeDispose outside scope', async () => {
    const warnings: string[] = [];
    const previous = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
      previous.apply(console, args);
    };
    try {
      const view = await mountSugarAsync({});
      await view.flush();
      view.unmount();
      const scopeWarnings = warnings.filter((message) =>
        /onScopeDispose|getCurrentScope|outside the active effect scope/i.test(message)
      );
      expect(scopeWarnings).toEqual([]);
    } finally {
      console.warn = previous;
    }
  });
});
