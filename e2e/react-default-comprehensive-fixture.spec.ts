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
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';

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

    const state = await page.evaluate(() => {
      const frame = window.__docxAdapterEditor!.getInteractionFrame();
      const pageLines = frame.display.map((displayPage) => {
        const lines = new Map<number, string>();
        for (const item of displayPage.items) {
          if (item.kind !== 'text') continue;
          lines.set(
            item.box.y,
            (lines.get(item.box.y) ?? '') + item.runs.map((run) => run.text).join('')
          );
        }
        return [...lines.values()];
      });
      return {
        pages: document.querySelectorAll('[data-page-index]').length,
        text: [...document.querySelectorAll('[data-page-index] .ep-one-surface__content > div')]
          .map((el) => el.textContent ?? '')
          .join(' '),
        fontHashes: [
          ...new Set(
            frame.display.flatMap((displayPage) =>
              displayPage.items.flatMap((item) =>
                item.kind === 'text' ? item.runs.map((run) => run.font.hash) : []
              )
            )
          ),
        ].sort(),
        frontier: {
          page9Last: pageLines[8]?.at(-1),
          page10First: pageLines[9]?.at(0),
        },
      };
    });

    // Licensed DejaVu 2.37 shaping moves the reviewed page-9/page-10 frontier below.
    // The hashes pin the exact regular/bold bytes, so this cannot silently bless a
    // browser fallback or a different font's pagination.
    expect(state.pages).toBe(10);
    expect({ fontHashes: state.fontHashes, frontier: state.frontier }).toEqual({
      fontHashes: [
        'sha256:7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954',
        'sha256:e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724',
      ],
      frontier: {
        page9Last: '27Column BreaksExplicit column break in multi-col',
        page10First: '#Element CategoryDetails',
      },
    });
    expect(state.text.replace(/\s+/g, ' ')).toContain('COMPREHENSIVE WORD ELEMENT TEST DOCUMENT');
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
