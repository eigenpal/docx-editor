/**
 * Gate `docs/site/content/**` against Vue samples that read a ref without `.value`.
 *
 * A Vue template unwraps a ref only when the ref is a top-level setup binding.
 * Most composables here return a plain object whose members are refs, so
 * `bold.isEnabled` in a template is the `ComputedRef`, not the boolean. A
 * `ComputedRef` is always truthy, so `:disabled="!bold.isEnabled"` renders a
 * button that never disables, and `{{ font.value }}` prints an object. The
 * sample stays plausible, compiles to a working page, and is wrong.
 *
 * Nothing else catches it: `check:docs-mdx` looks at MDX braces, not sample
 * code, and no build type-checks this prose. The docs site (`docx-editor-page`)
 * syncs this tree wholesale, so a wrong sample ships as written and an edit
 * made there is deleted at its next sync.
 *
 * The ref members come from the API Extractor snapshots, so this file needs no
 * hand-kept list: a composable that gains a ref member is covered at the next
 * `bun run api:extract`. A composable that returns a ref directly (for example
 * `useEditorState`) is skipped, because a top-level binding does unwrap.
 *
 * Fix a hit by appending `.value` to the read.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contentRoot = resolve(root, 'docs/site/content');
const apiFiles = [
  resolve(root, 'docs/api/docx-editor-vue/index.api.md'),
  resolve(root, 'docs/api/docx-editor-pro/vue.api.md'),
];

/** A member type that IS a ref, rather than one that merely mentions one. */
const REF_TYPE = /^(?:Readonly<\s*)?(?:Computed|Shallow|WritableComputed)?Ref(?:_\d+)?\s*</;

/** Members of every `export interface`, keyed by interface name. */
function readInterfaces(raw) {
  const interfaces = new Map();
  const lines = raw.split('\n');
  let name = null;
  for (const line of lines) {
    if (name === null) {
      const open = /^export interface ([A-Za-z_$][\w$]*)(?:<[^>]*>)? \{$/.exec(line);
      if (open) {
        name = open[1];
        interfaces.set(name, new Set());
      }
      continue;
    }
    if (line === '}') {
      name = null;
      continue;
    }
    const member = /^\s+(?:readonly\s+)?([A-Za-z_$][\w$]*)\??:\s*(.+?);?$/.exec(line);
    if (member && REF_TYPE.test(member[2])) interfaces.get(name).add(member[1]);
  }
  return interfaces;
}

/** Return type of `export function name(...): Type;`, or null when it spans a construct we skip. */
function returnTypeOf(raw, start) {
  const open = raw.indexOf('(', start);
  if (open === -1) return null;
  let depth = 0;
  let i = open;
  for (; i < raw.length; i += 1) {
    if (raw[i] === '(') depth += 1;
    else if (raw[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const end = raw.indexOf(';', i);
  if (end === -1) return null;
  return raw.slice(i + 1, end).replace(/^\s*:\s*/, '').trim();
}

/** Composable name -> ref members on the plain object it returns. */
function readComposables() {
  const composables = new Map();
  for (const file of apiFiles) {
    const raw = readFileSync(file, 'utf8');
    const interfaces = readInterfaces(raw);
    for (const match of raw.matchAll(/^export function (use[A-Za-z_$][\w$]*)/gm)) {
      const returnType = returnTypeOf(raw, match.index + match[0].length);
      if (returnType === null) continue;
      const members = interfaces.get(returnType);
      if (members && members.size > 0) composables.set(match[1], members);
    }
  }
  return composables;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.mdx')) out.push(full);
  }
  return out;
}

/** Fenced `vue`, `ts`, and `tsx` blocks, as line arrays with their 1-based start line. */
function codeBlocks(raw) {
  const blocks = [];
  let current = null;
  raw.split('\n').forEach((line, index) => {
    const fence = /^\s*```(\w+)?/.exec(line);
    if (!fence) {
      if (current) current.lines.push({ line, number: index + 1 });
      return;
    }
    if (current) {
      blocks.push(current);
      current = null;
      return;
    }
    if (fence[1] === 'vue' || fence[1] === 'ts' || fence[1] === 'tsx')
      current = { language: fence[1], lines: [] };
  });
  return blocks;
}

/**
 * React and Vue share composable names, and the React hooks return plain values.
 * A `.value` on a React sample would be wrong, so only Vue samples are checked.
 */
function isVueSample(block, file) {
  if (block.language === 'vue') return true;
  const text = block.lines.map((entry) => entry.line).join('\n');
  if (/@docx-editor\.dev\/(?:vue|nuxt|pro\/vue)/.test(text)) return true;
  if (/@docx-editor\.dev\/(?:react|pro\/react)/.test(text)) return false;
  const path = relative(contentRoot, file);
  if (path.startsWith('vue/')) return true;
  return path === 'frameworks/nuxt.mdx' || path === 'frameworks/vite-vue.mdx';
}

function checkFile(file, composables) {
  const hits = [];
  for (const block of codeBlocks(readFileSync(file, 'utf8'))) {
    if (!isVueSample(block, file)) continue;
    const bindings = new Map();
    for (const { line } of block.lines) {
      const bind = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(use[A-Za-z_$][\w$]*)\s*\(/.exec(
        line,
      );
      if (bind && composables.has(bind[2])) bindings.set(bind[1], composables.get(bind[2]));
    }
    if (bindings.size === 0) continue;
    for (const { line, number } of block.lines) {
      for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b(\.value)?/g)) {
        const members = bindings.get(match[1]);
        if (!members || !members.has(match[2]) || match[3]) continue;
        hits.push({ number, read: `${match[1]}.${match[2]}`, line: line.trim() });
      }
    }
  }
  return hits;
}

const composables = readComposables();
if (composables.size === 0) {
  console.error('check:docs-vue-refs: no composables read from the API snapshots.');
  process.exit(1);
}

let failed = false;
for (const file of walk(contentRoot)) {
  for (const hit of checkFile(file, composables)) {
    failed = true;
    console.error(`${relative(root, file)}:${hit.number}  ${hit.read} needs .value`);
    console.error(`  ${hit.line}`);
  }
}

if (failed) {
  console.error('\nA template unwraps a ref only when the ref is a top-level binding.');
  console.error('These refs sit on a returned object, so read them with .value.');
  process.exit(1);
}

console.log(`check:docs-vue-refs: clean (${composables.size} composables checked).`);
