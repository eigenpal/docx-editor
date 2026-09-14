#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
let server;
let browser;
try {
  server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    server: { port: 0, strictPort: false, open: false },
    logLevel: 'error',
  });
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  page.setDefaultTimeout(15000);
  // Add a tracked insertion around existing comment text without changing its content.
  // The public sample has comments, but no tracked changes.
  const entries = unzipSync(await readFile(path.join(root, '../vite/public/sample.docx')));
  const original = strFromU8(entries['word/document.xml']);
  const revised = original.replace(
    /(<w:commentRangeStart[^>]*\/>)(<w:r>.*?<\/w:r>)/,
    '$1<w:ins w:id="9000" w:author="Preview test">$2</w:ins>'
  );
  assert.notEqual(revised, original);
  entries['word/document.xml'] = strToU8(revised);
  const sample = Buffer.from(zipSync(entries));
  await page.route('**/sample.docx', (route) =>
    route.fulfill({
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: sample,
    })
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://localhost:${address.port}/`);
  await page.waitForSelector('#markdown-page-28 .md-page-sheet', { timeout: 60000 });

  async function overflow() {
    return page.locator('.md-page-wrap').evaluateAll((pages) => {
      const failures = [];
      for (const [index, article] of pages.entries()) {
        const paper = article.querySelector('.md-page-sheet');
        const bounds = paper.getBoundingClientRect();
        if (bounds.width === 0) {
          failures.push(`page ${index + 1} is hidden`);
          continue;
        }
        if (paper.scrollHeight > paper.clientHeight + 2)
          failures.push(
            `page ${index + 1}: ${paper.scrollHeight} content > ${paper.clientHeight} paper`
          );
        for (const field of paper.querySelectorAll('.md-page-field'))
          if (field.getBoundingClientRect().bottom > bounds.bottom + 2)
            failures.push(`page ${index + 1}: field extends beyond paper`);
        if (
          index + 1 < pages.length &&
          bounds.bottom > pages[index + 1].getBoundingClientRect().top + 2
        )
          failures.push(`page ${index + 1} overlaps next page`);
      }
      if (document.documentElement.scrollWidth > innerWidth + 2)
        failures.push('viewport overflows horizontally');
      return failures;
    });
  }

  // Prove this check detects the original regression, not only the repaired layout.
  const broken = await page.addStyleTag({
    content: '.md-page-sheet { height: 798px !important; min-height: 0 !important; }',
  });
  assert.ok((await overflow()).some((failure) => failure.startsWith('page 2:')));
  await broken.evaluate((element) => element.remove());

  for (const width of [1800, 1440, 1280, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    if (width <= 900)
      await page
        .getByRole('group', { name: 'Demo view', exact: true })
        .getByRole('button', { name: 'Markdown', exact: true })
        .click();
    await page
      .getByRole('group', { name: 'Markdown view', exact: true })
      .getByRole('button', { name: 'Preview', exact: true })
      .click();
    // A mode switch must preserve the reader's page even when earlier pages change height.
    for (const [number, fraction] of [
      [2, 0.4],
      [11, 0],
      [27, 0.5],
    ]) {
      for (const mode of ['Source', 'Preview']) {
        await page.locator('.md-preview-scroll').evaluate(
          (scroller, { number, fraction }) => {
            const article = scroller.querySelector(`#markdown-page-${number}`);
            const bounds = article.getBoundingClientRect();
            scroller.scrollTo({
              top:
                scroller.scrollTop +
                bounds.top -
                scroller.getBoundingClientRect().top +
                bounds.height * fraction,
              behavior: 'instant',
            });
          },
          { number, fraction }
        );
        await page
          .getByRole('group', { name: 'Markdown view', exact: true })
          .getByRole('button', { name: mode, exact: true })
          .click();
        // Allow an erroneous scheduled smooth scroll to start before checking the position.
        await page.waitForTimeout(350);
        const position = await page.locator('.md-preview-scroll').evaluate((scroller) => {
          const top = scroller.getBoundingClientRect().top;
          const article = Array.from(scroller.querySelectorAll('.md-page-wrap')).find(
            (candidate) => candidate.getBoundingClientRect().bottom > top
          );
          const bounds = article.getBoundingClientRect();
          return { id: article.id, fraction: (top - bounds.top) / bounds.height };
        });
        assert.equal(
          position.id,
          `markdown-page-${number}`,
          `${width}px ${mode} retains the visible page`
        );
        assert.ok(
          Math.abs(position.fraction - fraction) < 0.02,
          `${width}px ${mode} retains the reading position`
        );
      }
    }
    for (const mode of ['Preview', 'Source']) {
      await page
        .getByRole('group', { name: 'Markdown view', exact: true })
        .getByRole('button', { name: mode, exact: true })
        .click();
      assert.deepEqual(await overflow(), [], `${width}px ${mode}`);
      const comments = page.locator('#markdown-page-11');
      const toggle = comments.getByRole('button', { name: /comments/ });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      const panel = comments.getByRole('region', { name: 'Page 11 comments' });
      assert.ok(await panel.isVisible());
      assert.ok((await panel.locator('.md-review-message').count()) >= 4);
      assert.equal(
        await panel.locator('pre').count(),
        0,
        'Source mode keeps readable review cards'
      );
      assert.equal(await comments.locator('.md-page-sheet .md-review-artifacts').count(), 0);
      assert.deepEqual(await overflow(), [], `${width}px ${mode} comments expanded`);
      const changes = comments.getByRole('button', { name: /tracked changes/ });
      const id = await changes.getAttribute('aria-controls');
      await changes.click();
      const changesPanel = page.locator(`[id="${id}"]`);
      assert.ok((await changesPanel.locator('.md-review-message--change').count()) > 0);
      assert.ok(await panel.isVisible(), 'Panels expand independently');
      assert.deepEqual(await overflow(), [], `${width}px ${mode} both panels expanded`);
      await toggle.focus();
      await page.keyboard.press('Enter');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await panel.isVisible(), false);
      assert.ok(await changesPanel.isVisible(), 'Closing comments keeps tracked changes open');
      await changes.click();
      assert.equal(await changesPanel.isVisible(), false);
    }
    console.log(
      `${width}px: all 28 pages contain their content; review controls and reading position pass in Preview and Source`
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server?.close();
}
