// Verifies the PUBLISHED build, not just TypeScript source. Browser bundlers consume the
// ESM/import condition and need literal `new URL(..., import.meta.url)` expressions. The
// CJS/require condition is for Node and must still resolve every asset beside the package.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(packageRoot, 'assets');
const distDir = join(packageRoot, 'dist');
const assetFiles = readdirSync(assetsDir)
  .filter((file) => file.endsWith('.ttf') || file.endsWith('.otf'))
  .sort();

const esm = readdirSync(distDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(join(distDir, file), 'utf8'))
  .join('\n');
const emittedUrls = [
  ...esm.matchAll(
    /new URL\(\s*['"]\.\.\/assets\/([^'"]+\.(?:ttf|otf))['"]\s*,\s*import\.meta\.url\s*\)/g
  ),
]
  .map((match) => match[1])
  .sort();

assert.deepEqual(
  emittedUrls,
  assetFiles,
  'ESM build must preserve one literal import.meta.url expression per packaged face'
);

const require = createRequire(import.meta.url);
const cjs = require(join(distDir, 'index.cjs'));
const requestedUrls = [];
const fragment = await cjs.loadDefaultFonts({
  families: cjs.ALL_WORD_DEFAULT_FAMILIES,
  fetcher: async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url.href);
    return new Response(readFileSync(url));
  },
});
const requestedFiles = requestedUrls
  .map((url) => fileURLToPath(url))
  .map((file) => file.slice(assetsDir.length + 1))
  .sort();

assert.equal(fragment.failures.length, 0, 'CJS build must load every packaged face in Node');
assert.equal(fragment.sources.length, assetFiles.length);
assert.deepEqual(requestedFiles, assetFiles);
const expectedRoot = new URL('./', pathToFileURL(join(assetsDir, assetFiles[0])).href);
assert.equal(new URL('./', cjs.FONT_ASSET_ROOT).href, expectedRoot.href);
for (const url of requestedUrls) {
  assert.equal(new URL(url).protocol, pathToFileURL(assetsDir).protocol);
  assert.equal(new URL('./', url).href, expectedRoot.href);
}

// The ESM build must survive a bundler, and "survive" means IMPORTING AT ALL.
//
// webpack and Turbopack do not leave `new URL('../assets/x.ttf', import.meta.url)` alone.
// They emit the asset and replace the whole expression with a bare RELATIVE path string
// for it. Any module-scope code that then treats an entry as a `URL` throws while the
// module is still evaluating, which is uncatchable: it takes down the entire client
// bundle rather than degrading font loading.
//
// That shipped once. `@docx-editor.dev/fonts@2.15.0` derived an asset root with a
// single-argument `new URL()` and answered every page of a production site with
// "URL constructor: /_next/static/media/Caladea-Bold.d6e01b80.ttf is not a valid URL".
//
// So: rewrite the built ESM exactly the way those bundlers do, then import it.
const bundlerScratch = mkdtempSync(join(tmpdir(), 'docx-fonts-bundler-'));
try {
  // `dist/*.js` is ESM, and a directory with no `package.json` is CommonJS to Node.
  // Without this the import fails with "Cannot use import statement outside a module" on
  // any Node before 22.7, which reads as a broken check rather than a broken package.
  writeFileSync(join(bundlerScratch, 'package.json'), '{"type":"module"}\n');

  const rewritten = [];
  for (const file of readdirSync(distDir).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(join(distDir, file), 'utf8').replace(
      /new URL\(\s*['"]\.\.\/assets\/([^'"]+\.(?:ttf|otf))['"]\s*,\s*import\.meta\.url\s*\)/g,
      (_match, asset) => {
        rewritten.push(asset);
        return JSON.stringify(
          `/_next/static/media/${asset.replace(/\.(ttf|otf)$/, '.d6e01b80.$1')}`
        );
      }
    );
    writeFileSync(join(bundlerScratch, file), source);
  }
  assert.deepEqual(
    rewritten.sort(),
    assetFiles,
    'the bundler simulation must rewrite every packaged face, or it is testing nothing'
  );

  const bundled = await import(pathToFileURL(join(bundlerScratch, 'index.js')).href);

  // Importing without throwing IS the assertion. The rest pins why the value is safe to
  // hand to `createPackagedFileFetch`: a bundler moved the faces, so there is no trusted
  // LOCAL directory, and every consumer gates on exactly this.
  assert.notEqual(
    bundled.FONT_ASSET_ROOT.protocol,
    'file:',
    'a bundled build must not claim a local asset directory it cannot have'
  );
} finally {
  rmSync(bundlerScratch, { recursive: true, force: true });
}

console.log(
  `built font assets OK (${assetFiles.length} ESM URLs, ${requestedUrls.length} CJS reads, ` +
    `${assetFiles.length} bundler-rewritten URLs import cleanly)`
);
