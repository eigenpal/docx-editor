// Verifies the PUBLISHED build, not just TypeScript source. Browser bundlers consume the
// ESM/import condition and need literal `new URL(..., import.meta.url)` expressions. The
// CJS/require condition is for Node and must still resolve every asset beside the package.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
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

console.log(
  `built font assets OK (${assetFiles.length} ESM URLs, ${requestedUrls.length} CJS reads)`
);
