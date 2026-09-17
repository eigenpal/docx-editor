// Third-party notices for the compiled runtime.
//
// The executable inlines everything the entry reaches: the converter, core, fonts, and
// each of their npm dependencies, which stay external in the npm packages but travel
// inside this binary. MIT and Apache-2.0 both require the license text to travel with
// the copy, so this derives the list from Bun's build metafile the same way
// scripts/generate-third-party-notices.mjs derives the npm packages' notices from
// esbuild's, and adds what no metafile can see: the HarfBuzz shaper that core's ESM
// build inlines, the Bun runtime the binary embeds, and the font files.
//
// The run is all-or-nothing. A bundled package with no license text fails the build
// rather than shipping a notice that claims completeness it does not have.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const WORKSPACE_SCOPE = '@docx-editor.dev/';
const LICENSE_FILE =
  /^(?:licen[cs]e|copying|unlicen[cs]e)(?:[-_][a-z0-9._-]+)?(?:\.(?:md|txt|rst))?$/i;
const NOTICE_FILE = /^notice(?:\.(?:md|txt|rst))?$/i;

/** Nearest package.json above a bundled input, or null outside any package. */
function owningPackage(absoluteInput) {
  let dir = path.dirname(absoluteInput);
  while (dir !== path.dirname(dir)) {
    const manifestPath = path.join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.name && manifest.version) return { dir, manifest };
      } catch {
        // Keep climbing past a malformed manifest.
      }
    }
    if (path.basename(dir) === 'node_modules') return null;
    dir = path.dirname(dir);
  }
  return null;
}

function licenseTextsIn(dir, pattern) {
  return readdirSync(dir)
    .filter((entry) => pattern.test(entry) && statSync(path.join(dir, entry)).isFile())
    .sort()
    .map((filename) => ({ filename, text: readFileSync(path.join(dir, filename), 'utf8').trim() }))
    .filter(({ text }) => text.length > 0);
}

function licenseIdOf(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === 'string') return license;
  if (license && typeof license === 'object' && typeof license.type === 'string')
    return license.type;
  if (Array.isArray(licenses)) {
    const ids = licenses.map((e) => (typeof e === 'string' ? e : e?.type)).filter(Boolean);
    if (ids.length > 0) return ids.join(' OR ');
  }
  return null;
}

function homepageOf(manifest) {
  if (typeof manifest.homepage === 'string') return manifest.homepage;
  const repo = manifest.repository;
  const url = typeof repo === 'string' ? repo : repo?.url;
  return typeof url === 'string' ? url.replace(/^git\+/, '').replace(/\.git$/, '') : null;
}

/**
 * The standard text for a package that declares a permissive license in package.json
 * (and, for the ones seen so far, in its README) but ships no license file. The
 * declaration is the grant; this reproduces the terms it names so the notice is
 * complete. Only licenses whose text is fixed by SPDX qualify.
 */
function templateLicense(manifest) {
  const id = licenseIdOf(manifest);
  const author =
    typeof manifest.author === 'string'
      ? manifest.author.replace(/\s*[<(].*$/, '')
      : manifest.author?.name;
  const holder = author
    ? `${manifest.name} contributors (${author})`
    : `${manifest.name} contributors`;
  if (id === 'MIT') {
    return {
      filename: 'MIT (declared in package.json; the package ships no license file)',
      text: [
        'MIT License',
        '',
        `Copyright (c) ${holder}`,
        '',
        'Permission is hereby granted, free of charge, to any person obtaining a copy',
        'of this software and associated documentation files (the "Software"), to deal',
        'in the Software without restriction, including without limitation the rights',
        'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
        'copies of the Software, and to permit persons to whom the Software is',
        'furnished to do so, subject to the following conditions:',
        '',
        'The above copyright notice and this permission notice shall be included in all',
        'copies or substantial portions of the Software.',
        '',
        'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
        'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
        'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
        'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
        'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
        'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
        'SOFTWARE.',
      ].join('\n'),
    };
  }
  return null;
}

/** A package as resolved from another package's directory, since it may not be hoisted. */
function packageAt(name, from) {
  const resolver = from ? createRequire(require.resolve(`${from}/package.json`)) : require;
  // Packages whose `exports` map hides package.json resolve through their entry instead.
  let entry;
  try {
    entry = resolver.resolve(`${name}/package.json`);
  } catch {
    entry = resolver.resolve(name);
  }
  const owner = owningPackage(entry);
  if (!owner || owner.manifest.name !== name) throw new Error(`cannot locate package ${name}`);
  return owner;
}

/**
 * Every non-workspace npm package the metafile shows inlined, plus the ones inlined
 * one level down that the metafile cannot show.
 */
export function bundledPackages(metafilePath, cwd) {
  const build = JSON.parse(readFileSync(metafilePath, 'utf8'));
  const found = new Map();
  const problems = [];
  const add = ({ dir, manifest }) =>
    found.set(`${manifest.name}@${manifest.version}`, { dir, manifest });
  for (const input of Object.keys(build.inputs)) {
    if (!input.includes('node_modules')) continue;
    const owner = owningPackage(path.resolve(cwd, input));
    if (!owner) {
      problems.push(`cannot resolve the package that owns bundled input ${input}`);
      continue;
    }
    if (owner.manifest.name.startsWith(WORKSPACE_SCOPE)) continue;
    add(owner);
  }
  // Core's ESM build inlines harfbuzzjs (see packages/core/tsup.config.ts), so the
  // metafile attributes those bytes to core's dist chunk, not to harfbuzzjs.
  add(packageAt('harfbuzzjs', '@docx-editor.dev/core'));
  return {
    packages: [...found.values()].sort((a, b) => (a.manifest.name < b.manifest.name ? -1 : 1)),
    problems,
  };
}

export function renderNotices({
  packages,
  problems,
  fontLicenses,
  bunLicense,
  bunVersion,
  harfbuzzLicense,
}) {
  const lines = [
    '# Third-party notices',
    '',
    'The `docx-to-markdown` Python package is distributed under the Apache License,',
    'Version 2.0 (see `LICENSE` in the wheel). Its `_vendor/docx-to-markdown` executable',
    'is a compiled bundle that contains the `@docx-editor.dev/core`,',
    '`@docx-editor.dev/fonts`, and `@docx-editor.dev/docx-to-markdown` packages',
    '(Apache-2.0, https://github.com/eigenpal/docx-editor) together with the',
    'third-party components below, each under its own license, reproduced in full.',
    '',
    '## Bun runtime',
    '',
    `The executable embeds the Bun JavaScript runtime, version ${bunVersion}, which is`,
    "MIT-licensed and statically links JavaScriptCore under the LGPL. Bun's own license",
    'file follows; it names every library Bun links and where each license lives.',
    'A copy is also installed as `bun-LICENSE.md` beside this file.',
    '',
    '```',
    bunLicense.trim(),
    '```',
    '',
    '## HarfBuzz',
    '',
    'The `harfbuzzjs` package below wraps the HarfBuzz text shaping library compiled to',
    'WebAssembly. HarfBuzz itself is distributed under its own MIT-style license, which',
    'is installed as `harfbuzz-COPYING.txt` beside this file and reproduced here.',
    '',
    '```',
    harfbuzzLicense.trim(),
    '```',
    '',
    '## Fonts',
    '',
    'The `fonts/` directory beside this file holds metric-compatible substitutes for',
    "Word's default fonts. Their licenses are installed alongside:",
    '',
    ...fontLicenses.map((file) => `- \`${file}\``),
    '',
    '## Bundled npm packages',
    '',
    ...packages.map(
      ({ manifest }) =>
        `- ${manifest.name} ${manifest.version} — ${licenseIdOf(manifest) ?? 'see below'}${
          homepageOf(manifest) ? ` — ${homepageOf(manifest)}` : ''
        }`
    ),
    '',
  ];
  for (const { dir, manifest } of packages) {
    let texts = licenseTextsIn(dir, LICENSE_FILE);
    if (texts.length === 0) {
      const template = templateLicense(manifest);
      if (!template) {
        problems.push(`${manifest.name}@${manifest.version}: no license text in ${dir}`);
        continue;
      }
      texts = [template];
    }
    lines.push(
      '---',
      '',
      `### ${manifest.name} ${manifest.version}`,
      '',
      `License: ${licenseIdOf(manifest) ?? 'see text below'}`,
      ...(homepageOf(manifest) ? [`Homepage: ${homepageOf(manifest)}`] : []),
      '',
      ...[...texts, ...licenseTextsIn(dir, NOTICE_FILE)].flatMap(({ filename, text }) => [
        `#### ${filename}`,
        '',
        '```',
        text,
        '```',
        '',
      ])
    );
  }
  return lines.join('\n');
}

export function writeNotices({ metafilePath, cwd, vendorLicensesDir, bunVersion }) {
  const { packages, problems } = bundledPackages(metafilePath, cwd);
  const fontLicenses = readdirSync(vendorLicensesDir)
    .filter((f) => /^(OFL|LICENSE-Liberation|GUST|LPPL)/i.test(f))
    .sort();
  const bunLicense = readFileSync(new URL('./licenses/bun-LICENSE.md', import.meta.url), 'utf8');
  const harfbuzzLicense = readFileSync(
    new URL('./licenses/harfbuzz-COPYING.txt', import.meta.url),
    'utf8'
  );
  const text = renderNotices({
    packages,
    problems,
    fontLicenses,
    bunLicense,
    bunVersion,
    harfbuzzLicense,
  });
  if (problems.length > 0) {
    throw new Error(`third-party notices incomplete:\n  - ${problems.join('\n  - ')}`);
  }
  writeFileSync(path.join(vendorLicensesDir, 'THIRD_PARTY_NOTICES.md'), text);
  writeFileSync(path.join(vendorLicensesDir, 'bun-LICENSE.md'), bunLicense);
  writeFileSync(path.join(vendorLicensesDir, 'harfbuzz-COPYING.txt'), harfbuzzLicense);
  return packages.map(({ manifest }) => `${manifest.name}@${manifest.version}`);
}
