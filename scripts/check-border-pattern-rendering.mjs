#!/usr/bin/env node
// Patterned borders must PAINT with gaps, in a real browser.
//
// `dashed`, `dotted` and their aliases are drawn as a repeating gradient whose transparent
// stops are the gaps. Both callers of `applyParagraphBorderStyle` fill the rule with the ink
// colour first; left under the gradient, that fill shows through every gap and the rule reads
// solid. A DOM assertion on `backgroundImage` passes either way, so this check looks at pixels:
// it lays out and paints a real document (paragraph rules AND a page frame) with the engine's
// own paint path, screenshots each rule in Chromium, and counts ink and paper along it.
//
// Usage: node scripts/check-border-pattern-rendering.mjs   (needs `bunx playwright install chromium`)

import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const INK = 'C00000';
const PATTERNED = ['dashed', 'dotted', 'dashSmallGap', 'dotDash', 'dotDotDash', 'dashDotStroked'];

/** One paragraph per patterned value with a thick bottom rule, and a page frame of each kind. */
function documentXml(frameVal) {
  const rule = (val) => `<w:bottom w:val="${val}" w:sz="24" w:space="4" w:color="${INK}"/>`;
  const paragraphs = [...PATTERNED, 'single']
    .map(
      (val) => `<w:p><w:pPr><w:pBdr>${rule(val)}</w:pBdr></w:pPr><w:r><w:t>${val}</w:t></w:r></w:p>`
    )
    .join('');
  const edge = `w:val="${frameVal}" w:sz="24" w:space="24" w:color="${INK}"`;
  return (
    `<w:document xmlns:w="${W}"><w:body>${paragraphs}` +
    `<w:sectPr><w:pgBorders w:offsetFrom="page"><w:top ${edge}/><w:left ${edge}/><w:bottom ${edge}/><w:right ${edge}/></w:pgBorders></w:sectPr>` +
    '</w:body></w:document>'
  );
}

// realpath: on macOS the temp dir is a symlink, and Vite resolves modules by real path.
const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'border-patterns-')));
let browser;
let server;
try {
  // The engine's real layout + paint, bundled for the browser. The fixed measurer keeps text
  // metrics out of it: this check is about how a rule is FILLED, not where text lands.
  const entry = path.join(dir, 'entry.ts');
  await writeFile(
    entry,
    `import { readOoxmlPart } from '${root}/packages/core/src/store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '${root}/packages/core/src/layout/semantic-layout.ts';
import { paintSemanticLayout } from '${root}/packages/core/src/output/semantic-paint.ts';
window.paintDocx = (xml) => {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14), producer: 'check' });
  const host = document.getElementById('host');
  host.replaceChildren();
  paintSemanticLayout(host, layout, { scale: 2 });
};
window.checkReady = true;
`
  );
  // A dev server, not a bundle: the engine's shaper uses top-level await, which Vite serves
  // to a module script as-is.
  await writeFile(
    path.join(dir, 'index.html'),
    '<!doctype html><body style="margin:0;background:#fff"><div id="host"></div>' +
      '<script type="module" src="/entry.ts"></script></body>'
  );
  server = await createServer({
    configFile: false,
    logLevel: 'error',
    root: dir,
    server: { port: 0, strictPort: false, open: false, fs: { allow: [root, dir] } },
    optimizeDeps: { noDiscovery: true },
    // The engine's own bare specifiers, resolved to SOURCE like `examples/vite` does, so the
    // page runs one copy of the code this branch changes.
    resolve: {
      alias: [
        {
          find: '@docx-editor.dev/core/collaboration/replication',
          replacement: path.join(root, 'packages/core/src/collaboration/replication.ts'),
        },
        {
          find: /^@docx-editor\.dev\/core\/(binding|collaboration|editor|layout|output|store|sync|clients|server)$/,
          replacement: path.join(root, 'packages/core/src/$1/index.ts'),
        },
        {
          find: /^@docx-editor\.dev\/core\/contracts\/(.+)$/,
          replacement: path.join(root, 'packages/core/src/contracts/$1.ts'),
        },
      ],
    },
  });
  await server.listen();

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://localhost:${server.httpServer.address().port}/`);
  await page.waitForFunction(() => window.checkReady === true, null, { timeout: 60_000 });

  /** Ink and paper runs along the middle of the rule's thickness, from its own screenshot. */
  async function runsAlong(selector) {
    const rule = page.locator(selector).first();
    const box = await rule.boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0, `${selector} is not painted`);
    const png = (await rule.screenshot()).toString('base64');
    return page.evaluate(
      async ({ png, horizontal }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, img.width, img.height);
        const length = horizontal ? img.width : img.height;
        const kinds = [];
        for (let i = 0; i < length; i += 1) {
          const x = horizontal ? i : Math.floor(img.width / 2);
          const y = horizontal ? Math.floor(img.height / 2) : i;
          const o = (y * img.width + x) * 4;
          const [r, g, b] = [data[o], data[o + 1], data[o + 2]];
          kinds.push(
            r > 230 && g > 230 && b > 230 ? 'paper' : r > 120 && g < 90 && b < 90 ? 'ink' : 'edge'
          );
        }
        const runs = { ink: 0, paper: 0 };
        let previous = null;
        for (const kind of kinds) {
          if (kind !== 'edge' && kind !== previous) runs[kind] += 1;
          if (kind !== 'edge') previous = kind;
        }
        return runs;
      },
      { png, horizontal: (await rule.boundingBox()).width >= (await rule.boundingBox()).height }
    );
  }

  const failures = [];
  const expectGaps = (label, runs) => {
    if (runs.ink < 5 || runs.paper < 5)
      failures.push(`${label}: ${JSON.stringify(runs)} — no visible gaps`);
  };

  for (const frameVal of ['dashed', 'dotted', 'single']) {
    await page.evaluate((xml) => window.paintDocx(xml), documentXml(frameVal));

    // Page frame: the top rule of the one sheet.
    const frame = await runsAlong('.docx-page-border-top');
    if (frameVal === 'single') {
      // The control: a solid rule has ink and no paper, which proves the counter can tell.
      if (frame.ink !== 1 || frame.paper !== 0)
        failures.push(`page frame single: ${JSON.stringify(frame)} — not solid`);
    } else {
      expectGaps(`page frame ${frameVal}`, frame);
    }
  }

  // Paragraph rules, in document order: one per patterned value, then the solid control.
  const rules = page.locator('.docx-paragraph-border-bottom');
  assert.equal(await rules.count(), PATTERNED.length + 1, 'one bottom rule per paragraph');
  for (const [index, val] of [...PATTERNED, 'single'].entries()) {
    const runs = await runsAlong(`.docx-paragraph-border-bottom >> nth=${index}`);
    if (val === 'single') {
      if (runs.ink !== 1 || runs.paper !== 0)
        failures.push(`paragraph single: ${JSON.stringify(runs)} — not solid`);
    } else {
      expectGaps(`paragraph ${val}`, runs);
    }
  }

  assert.deepEqual(errors, [], 'page errors');
  if (failures.length) {
    console.error(`✗ patterned borders paint solid:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `✓ patterned borders show gaps: page frame (dashed, dotted) and ${PATTERNED.length} paragraph values; solid controls stay solid`
    );
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(dir, { recursive: true, force: true });
}
