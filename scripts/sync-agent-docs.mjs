#!/usr/bin/env node
// Keep the task recipes and the "Which API for which job" table in one place.
//
// Source: `docs/site/content/recipes/*.mdx`, in the order of that folder's `meta.json`.
// Copies:
//   - `packages/{core,react,pro,editor-api}/docs/*.md`, shipped in each npm package so a
//     coding agent reading `node_modules` finds the recipes beside the code;
//   - the `## Which API for which job` section of the root README, each package README listed
//     below, and the docs index page.
//
// Usage:
//   node scripts/sync-agent-docs.mjs          # write every copy
//   node scripts/sync-agent-docs.mjs --check  # fail when a copy differs from the source

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SOURCE_DIR = 'docs/site/content/recipes';
const SITE = 'https://www.docx-editor.dev';
const SECTION = '## Which API for which job';
const DOC_PACKAGES = ['core', 'react', 'pro', 'editor-api'];
const SITE_RECIPES = 'For worked examples, see [Task recipes](/docs/2.x/recipes).';
const PACKAGE_RECIPES =
  'This package ships the task recipes in [`docs/index.md`](./docs/index.md). They are also on the site: [Task recipes](/docs/2.x/recipes).';
const SECTION_TARGETS = [
  { file: 'README.md', links: 'absolute', suffix: SITE_RECIPES },
  { file: 'packages/core/README.md', links: 'absolute', suffix: PACKAGE_RECIPES },
  { file: 'packages/react/README.md', links: 'absolute', suffix: PACKAGE_RECIPES },
  { file: 'packages/pro/README.md', links: 'absolute', suffix: PACKAGE_RECIPES },
  { file: 'packages/editor-api/README.md', links: 'absolute', suffix: PACKAGE_RECIPES },
  { file: 'packages/vue/README.md', links: 'absolute', suffix: SITE_RECIPES },
  { file: 'docs/site/content/index.mdx', links: 'site', suffix: SITE_RECIPES },
];
const GENERATED_NOTE =
  '<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->';

const read = (file) => readFileSync(join(root, file), 'utf8');

/** Split frontmatter from body and read its `title`. */
export function parsePage(source, file) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const title = /^title:\s*'((?:[^']|'')*)'\s*$/m.exec(match[1])?.[1]?.replace(/''/g, "'");
  if (!title) throw new Error(`${file}: missing a quoted title in frontmatter`);
  return { title, body: source.slice(match[0].length).replace(/^\n+/, '') };
}

/** Rewrite site links for a copy that lives outside the site. */
export function rewriteLinks(text, mode) {
  if (mode === 'site') return text;
  return text.replace(/\]\(\/docs\/2\.x\/([^)\s]*)\)/g, (_, path) => {
    if (mode === 'package') {
      const recipe = /^recipes(?:\/([a-z0-9-]+))?(#[^)]*)?$/.exec(path);
      if (recipe) return `](./${recipe[1] ?? 'index'}.md${recipe[2] ?? ''})`;
    }
    return `](${SITE}/docs/2.x/${path})`;
  });
}

/** The body of a `## ` section, without its heading, up to the next `## ` heading. */
export function sectionBody(text, heading, file) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`${file}: missing the "${heading}" section`);
  let end = start + 1;
  while (end < lines.length && !/^##? /.test(lines[end])) end += 1;
  return { lines, start, end, body: lines.slice(start + 1, end).join('\n').trim() };
}

/** Replace a section body in place, keeping one blank line on each side. */
export function replaceSection(text, heading, body, file) {
  const { lines, start, end } = sectionBody(text, heading, file);
  const after = lines.slice(end);
  return [...lines.slice(0, start + 1), '', body, ...(after.length > 0 ? ['', ...after] : [''])]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function recipePages() {
  const meta = JSON.parse(read(join(SOURCE_DIR, 'meta.json')));
  const listed = new Set(meta.pages);
  for (const name of readdirSync(join(root, SOURCE_DIR))) {
    if (name.endsWith('.mdx') && !listed.has(name.slice(0, -4))) {
      throw new Error(`${SOURCE_DIR}/${name}: add it to ${SOURCE_DIR}/meta.json`);
    }
  }
  return meta.pages.map((slug) => {
    const file = join(SOURCE_DIR, `${slug}.mdx`);
    return { slug, file, ...parsePage(read(file), file) };
  });
}

/** Every generated file and its expected content. */
export function expectedOutputs() {
  const pages = recipePages();
  const outputs = new Map();
  for (const name of DOC_PACKAGES) {
    for (const page of pages) {
      const body = rewriteLinks(page.body, 'package').trimEnd();
      outputs.set(
        `packages/${name}/docs/${page.slug}.md`,
        `${GENERATED_NOTE}\n\n# ${page.title}\n\n${body}\n`
      );
    }
  }
  const index = pages.find((page) => page.slug === 'index');
  if (!index) throw new Error(`${SOURCE_DIR}/index.mdx is required`);
  const table = sectionBody(index.body, SECTION, index.file).body;
  for (const target of SECTION_TARGETS) {
    const current = read(target.file);
    outputs.set(
      target.file,
      replaceSection(
        current,
        SECTION,
        rewriteLinks(`${table}\n\n${target.suffix}`, target.links),
        target.file
      )
    );
  }
  return outputs;
}

function main() {
  const check = process.argv.includes('--check');
  const drifted = [];
  for (const [file, content] of expectedOutputs()) {
    const path = join(root, file);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === content) continue;
    if (check) {
      drifted.push(file);
      continue;
    }
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
    console.log(`wrote ${relative(root, path)}`);
  }
  for (const name of DOC_PACKAGES) {
    const dir = join(root, 'packages', name, 'docs');
    if (!existsSync(dir)) continue;
    const expected = new Set(recipePages().map((page) => `${page.slug}.md`));
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith('.md') && !expected.has(entry)) {
        drifted.push(`packages/${name}/docs/${entry} (no source page; delete it)`);
      }
    }
  }
  if (drifted.length > 0) {
    console.error('Agent docs differ from docs/site/content/recipes:');
    for (const file of drifted) console.error(`  - ${file}`);
    console.error('Fix: bun run docs:agent');
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) main();
