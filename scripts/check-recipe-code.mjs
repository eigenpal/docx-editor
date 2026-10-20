#!/usr/bin/env node
/**
 * Type-check the code in `docs/site/content/recipes/*.mdx` against the package sources.
 *
 * The recipes are copied into each package's `docs/` and named in the READMEs, so a coding
 * agent reads them as the way to use the API. `check:agent-docs` keeps those copies equal to
 * the source, but nothing compiled the code itself: a renamed hook member or command left a
 * recipe that still looked right and no longer worked.
 *
 * Each `ts` and `tsx` block is checked in a React program, and the `<script setup>` of each
 * `vue` block in a Vue program. Both programs reuse the compiler options and source `paths` of
 * `packages/pro`, so the recipes meet the same types the packages build against. Vue templates
 * are not checked here; `check:docs-vue-refs` covers their most common mistake.
 *
 * Recipes leave a few inputs to the reader, such as the document `bytes` and the search text.
 * `PLACEHOLDERS` declares them. Add a name there only for a value the reader supplies.
 *
 * Usage: node scripts/check-recipe-code.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const SOURCE_DIR = 'docs/site/content/recipes';
const PRO = join(root, 'packages/pro');
const OUT = join(PRO, 'node_modules/.cache/recipe-check');

const PLACEHOLDERS = {
  bytes: 'Uint8Array',
  term: 'string',
  from: 'string',
  to: 'string',
  callModel: '(prompt: string) => Promise<string>',
  runtime: "import('@docx-editor.dev/editor-api').DocxEditorRuntime",
};

/**
 * Every package entry a recipe may import, mapped to source relative to `packages/pro`. Without
 * an entry, an import resolves to `dist`: missing on a clean checkout, stale after a build.
 */
const RECIPE_PATHS = {
  '@docx-editor.dev/pro': 'src/index.ts',
  '@docx-editor.dev/pro/react': 'src/react/index.ts',
  '@docx-editor.dev/pro/vue': 'src/vue/index.ts',
  '@docx-editor.dev/react': '../react/src/index.ts',
  '@docx-editor.dev/vue': '../vue/src/index.ts',
  '@docx-editor.dev/editor-api': '../editor-api/src/index.ts',
  '@docx-editor.dev/editor-api/browser': '../editor-api/src/browser.ts',
  '@docx-editor.dev/editor-api/agent': '../editor-api/src/agent.ts',
  '@docx-editor.dev/i18n': '../i18n/src/index.ts',
};

const PROGRAMS = {
  react: { config: 'tsconfig.json', extraPaths: RECIPE_PATHS },
  vue: { config: 'tsconfig.vue.json', extraPaths: RECIPE_PATHS },
};

/** Block languages that hold no code to check. Any other language fails the check. */
const UNCHECKED_LANGS = new Set(['bash', 'sh', 'json', 'text', 'mermaid']);

/** Every fenced block in a recipe, with the line its code starts on. */
export function codeBlocks(text) {
  const blocks = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^\s*```(.*)$/.exec(lines[i]);
    if (!open) continue;
    const lang = open[1].trim();
    if (!['ts', 'tsx', 'vue'].includes(lang) && !UNCHECKED_LANGS.has(lang)) {
      throw new Error(`line ${i + 1}: code block language "${lang}" is not ts, tsx, or vue`);
    }
    const end = lines.findIndex((line, index) => index > i && /^\s*```\s*$/.test(line));
    if (end < 0) throw new Error(`line ${i + 1}: unclosed code block`);
    blocks.push({ lang, line: i + 2, code: lines.slice(i + 1, end).join('\n') });
    i = end;
  }
  return blocks;
}

/**
 * The `<script setup>` of a Vue block, padded with blank lines so its line numbers match the
 * block, and the file name its leading `<!-- Name.vue -->` comment gives it.
 */
export function vueScript(code) {
  const name = /^<!--\s*([\w-]+)\.vue\s*-->/.exec(code)?.[1];
  const match = /<script setup lang="ts">\n([\s\S]*?)<\/script>/.exec(code);
  if (!match) throw new Error('a vue block needs <script setup lang="ts">');
  const offset = code.slice(0, match.index).split('\n').length;
  return { name, script: '\n'.repeat(offset) + match[1] };
}

/**
 * Overrides on the base program's options. `paths` replaces the inherited map as a whole, so it
 * repeats that map with absolute targets and adds the entries the recipes import.
 */
function compilerOptions({ config, extraPaths }) {
  const file = join(PRO, config);
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PRO, undefined, file);
  const base = parsed.options.pathsBasePath ?? PRO;
  const paths = {};
  for (const [key, targets] of Object.entries(parsed.options.paths ?? {})) {
    paths[key] = targets.map((target) => resolve(base, target));
  }
  for (const [key, target] of Object.entries(extraPaths)) paths[key] = [resolve(PRO, target)];
  return {
    paths,
    // A recipe shows one piece of a host, so its values often feed code it does not show.
    noUnusedLocals: false,
    noUnusedParameters: false,
    declaration: false,
    declarationMap: false,
  };
}

function writeProgram(name, files) {
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  const declarations = Object.entries(PLACEHOLDERS)
    .map(([id, type]) => `declare const ${id}: ${type};`)
    .join('\n');
  writeFileSync(join(dir, 'placeholders.d.ts'), `${declarations}\n`);
  const names = ['placeholders.d.ts'];
  if (name === 'vue') {
    writeFileSync(
      join(dir, 'shims.d.ts'),
      "declare module '*.vue' {\n  const component: import('vue').DefineComponent;\n  export default component;\n}\n"
    );
    names.push('shims.d.ts');
  }
  for (const file of files) {
    // A module even without imports, so blocks never share top-level names.
    writeFileSync(join(dir, file.name), `${file.code}\nexport {};\n`);
    names.push(file.name);
  }
  const config = {
    extends: join(PRO, PROGRAMS[name].config),
    compilerOptions: compilerOptions(PROGRAMS[name]),
    files: names,
  };
  writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify(config, null, 2)}\n`);
  return dir;
}

/**
 * Report each error at its recipe line rather than at the generated file: the `file` and `line`
 * attributes, and the line numbers of its source excerpt.
 */
export function toRecipeLines(output, origins) {
  return output
    .split(/(?=<error )/)
    .map((chunk) => {
      const at = /file="[^"]*recipe-check\/(react|vue)\/([\w.-]+)" line="(\d+)"/.exec(chunk);
      const origin = at && origins.get(`${at[1]}/${at[2]}`);
      if (!origin) return chunk;
      const shift = origin.line - 1;
      return chunk
        .replace(at[0], `file="${origin.file}" line="${shift + Number(at[3])}"`)
        .replace(/^(\s*)(\d+) \|/gm, (_, indent, line) => `${indent}${shift + Number(line)} |`);
    })
    .join('')
    .replace(
      /[^\s<>"]*recipe-check\/(react|vue)\/([\w.-]+):(\d+)/g,
      (whole, program, file, line) => {
        const origin = origins.get(`${program}/${file}`);
        return origin ? `${origin.file}:${origin.line - 1 + Number(line)}` : whole;
      }
    );
}

function main() {
  rmSync(OUT, { recursive: true, force: true });
  const programs = { react: [], vue: [] };
  /** Generated file name to the recipe line its first line came from. */
  const origins = new Map();
  for (const entry of readdirSync(join(root, SOURCE_DIR)).sort()) {
    if (!entry.endsWith('.mdx')) continue;
    const file = join(SOURCE_DIR, entry);
    const slug = entry.slice(0, -4);
    let blocks;
    try {
      blocks = codeBlocks(readFileSync(join(root, file), 'utf8'));
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
    blocks.forEach((block, index) => {
      if (block.lang === 'ts' || block.lang === 'tsx') {
        const name = `${slug}-${index + 1}.${block.lang}`;
        programs.react.push({ name, code: block.code });
        origins.set(`react/${name}`, { file, line: block.line });
      } else if (block.lang === 'vue') {
        const { name: component, script } = vueScript(block.code);
        // A named component is imported by the next block, so it keeps its own name.
        // Its file is not `Name.vue.ts`, which `./Name.vue` would resolve to before the shim.
        const name = component ? `${component}.ts` : `${slug}-${index + 1}.vue.ts`;
        if (origins.has(`vue/${name}`)) {
          throw new Error(`${file}:${block.line}: a recipe already defines ${component}.vue`);
        }
        programs.vue.push({ name, code: script });
        origins.set(`vue/${name}`, { file, line: block.line });
      }
    });
  }
  let failed = false;
  for (const [name, files] of Object.entries(programs)) {
    if (files.length === 0) continue;
    const dir = writeProgram(name, files);
    const run = spawnSync('bun', ['check', '-p', join(dir, 'tsconfig.json')], {
      cwd: root,
      encoding: 'utf8',
    });
    if (run.error) throw run.error;
    if (run.status === 0) continue;
    failed = true;
    // Report each error at its recipe line rather than at the generated file.
    process.stderr.write(toRecipeLines(`${run.stdout}${run.stderr}`, origins));
  }
  if (failed) {
    console.error(`Recipe code in ${SOURCE_DIR} does not type-check against the packages.`);
    console.error(`Generated programs: ${relative(root, OUT)}`);
    process.exit(1);
  }
  const count = programs.react.length + programs.vue.length;
  console.log(`Type-checked ${count} recipe code blocks.`);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) main();
