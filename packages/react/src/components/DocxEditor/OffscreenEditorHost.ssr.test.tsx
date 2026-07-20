/**
 * SSR regression: createPortal must not dereference `document` when there is
 * no DOM (Next/Remix/Nuxt server pass).
 *
 * Keep this file free of happy-dom — registering a DOM here would hide the
 * regression. Client portal-to-body coverage lives in
 * `OffscreenEditorHost.portal.test.tsx`.
 */
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { OffscreenEditorHost } from './OffscreenEditorHost';

describe('OffscreenEditorHost SSR safety', () => {
  test('renderToString does not dereference document.body', () => {
    expect(typeof document).toBe('undefined');

    expect(() =>
      renderToString(createElement(OffscreenEditorHost, { document: null }))
    ).not.toThrow();

    expect(renderToString(createElement(OffscreenEditorHost, { document: null }))).toBe('');
  });
});
