// M6D.1 — the bare React root loads the canonical comprehensive fixture.
//
// The demo used to default to `editable-sample.docx`, a 953-byte three-paragraph stub.
// Every visual and interaction claim was therefore made against a document with none of
// the structures the product exists to handle.
//
// The fixture is served from ONE byte source: a vite plugin maps
// `/comprehensive-word-element-test.docx` onto `e2e/fixtures/` at request time, so the
// demo and the e2e suite read the same bytes and a second copy cannot drift. This spec
// asserts that identity rather than trusting it.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Editor } from '@docx-editor.dev/core-contract/editor';

declare global {
  interface Window {
    __docxAdapterEditor?: Editor;
  }
}

const FIXTURE = 'comprehensive-word-element-test.docx';
const CANONICAL = path.resolve(import.meta.dirname, 'fixtures', FIXTURE);

test.describe('M6D.1 default comprehensive fixture (React)', () => {
  test('the bare root serves bytes identical to the canonical fixture', async ({ request }) => {
    const served = await request.get(`http://localhost:5273/${FIXTURE}`);
    expect(served.ok()).toBe(true);
    const servedBytes = Buffer.from(await served.body());
    const canonicalBytes = await readFile(CANONICAL);
    // Byte identity, not just size: a same-length divergent copy is exactly the failure
    // a second checked-in DOCX would produce.
    expect(servedBytes.equals(canonicalBytes)).toBe(true);
  });

  test('the bare root renders the whole comprehensive document', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // No query parameters — the default route is the claim under test.
    await page.goto('http://localhost:5273/');
    await page.waitForFunction(() => !!window.__docxAdapterEditor);

    const state = await page.evaluate(() => ({
      pages: document.querySelectorAll('[data-page-index]').length,
      text: [...document.querySelectorAll('[data-page-index] .ep-one-surface__content > div')]
        .map((el) => el.textContent ?? '')
        .join(' '),
    }));

    // Nine pages is the fixture's real pagination; asserting the count catches a
    // silent truncation that "it renders" would not.
    expect(state.pages).toBe(9);
    expect(state.text).toContain('COMPREHENSIVE WORD ELEMENT TEST DOCUMENT');
  });

  test('an explicit ?fixture= override still wins', async ({ page }) => {
    await page.goto('http://localhost:5273/?fixture=editable-sample.docx');
    await page.waitForFunction(() => !!window.__docxAdapterEditor);
    const pages = await page.evaluate(() => document.querySelectorAll('[data-page-index]').length);
    // The stub is a single page; proving the override works proves the default is a
    // default rather than a hardcode.
    expect(pages).toBe(1);
  });
});
