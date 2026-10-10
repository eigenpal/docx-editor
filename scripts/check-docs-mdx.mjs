/**
 * Gate `docs/site/content/**` against MDX that cannot render.
 *
 * MDX evaluates braces as JavaScript, so prose like `the "Edit {label}" row`
 * compiles to `ReferenceError: label is not defined`. Nothing in this repo
 * catches it: `docs/site/` is content with no app, and `docs:json` reads the
 * packages' d.ts rather than this prose. The typo therefore travels intact to
 * the docs site (`docx-editor-page`), which syncs this tree wholesale and dies
 * prerendering the page. That is a broken deploy on a repo that cannot fix its
 * own content, since an edit there is deleted at its next sync.
 *
 * Braces are literal inside fenced blocks, inline code spans, and frontmatter,
 * so those are skipped. Names the file binds itself (`export const x`, imports)
 * are legitimate references and pass.
 *
 * Fix a hit by backticking the braces or escaping them: `\{label\}`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contentRoot = resolve(root, 'docs/site/content');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.mdx')) out.push(full);
  }
  return out;
}

/** Names a file binds itself, so `{features}` beside `export const features` passes. */
function boundNames(raw) {
  const names = new Set();
  for (const m of raw.matchAll(
    /^\s*export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(m[1]);
  }
  for (const m of raw.matchAll(/^\s*import\s+([\s\S]*?)\s+from\s/gm)) {
    for (const part of m[1].replace(/[{}]/g, ' ').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

function findBareExpressions(raw) {
  const bound = boundNames(raw);
  const hits = [];
  let inFence = false;
  let inFrontmatter = false;
  raw.split('\n').forEach((line, i) => {
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      return;
    }
    if (inFrontmatter) {
      if (line.trim() === '---') inFrontmatter = false;
      return;
    }
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    // `\{` is an escaped brace and renders literally — that is one of the two
    // fixes this check asks for, so it must not flag its own remedy.
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/(?<!\\)\{([A-Za-z_$][\w$]*)\}/g)) {
      hits.push({ name: m[1], line: i + 1, text: line.trim() });
    }
  });
  return hits.filter((h) => !bound.has(h.name));
}

const files = walk(contentRoot);
if (files.length === 0) {
  console.error(`docs mdx: no MDX under ${relative(root, contentRoot)}/`);
  process.exit(1);
}

let hits = 0;
for (const file of files) {
  const bare = findBareExpressions(readFileSync(file, 'utf8'));
  if (bare.length === 0) continue;
  if (hits === 0) {
    console.error('docs mdx: bare {expression} in prose — these render as ReferenceError\n');
  }
  for (const h of bare) {
    console.error(`  ${relative(root, file)}:${h.line}  {${h.name}}  ${h.text.slice(0, 90)}`);
  }
  hits += bare.length;
}

if (hits > 0) {
  console.error('\nBacktick the braces, or escape them as \\{...\\}.');
  process.exit(1);
}

console.log(`docs mdx: OK — ${files.length} pages, no bare expressions`);
