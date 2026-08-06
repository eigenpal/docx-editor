// Compiles the engine stylesheet into packages/core/dist.
//
// The source keeps a raw `@tailwind utilities;` so in-repo examples can expand
// it with their own dev Tailwind build — but the SHIPPED file must not: a host
// app's Tailwind would re-expand the directive against the HOST's config, and a
// host with no Tailwind would drop it, leaving the chrome unstyled. So the
// build expands it here, against packages/core/tailwind.dist.config.cjs, which
// scopes every utility under `.docx-editor` (Tailwind v3 `important` selector
// strategy — no `!important` emitted).
//
// `@tailwind base` is prepended with preflight DISABLED: that emits only the
// `--tw-*` custom-property defaults that translate/ring/zoom utilities read,
// and `optimizeUniversalDefaults` grafts them onto the scoped utility selectors
// instead of a global `*, ::before, ::after` rule. The output is asserted to
// contain no directive and no unscoped global selector before it is written.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { coreCssProblems } from './core-css-assertions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core');
const from = join(root, 'src', 'styles', 'editor.css');
const to = join(root, 'dist', 'editor.css');

const source = readFileSync(from, 'utf8');
const input = `@tailwind base;\n${source}`;

// `optimizeUniversalDefaults` grafts the `--tw-*` defaults onto the utility
// class names that read them (`.transform, .shadow-lg, ...`) — grouped, but NOT
// run through the `important: '.docx-editor'` selector rewrite, so they would still
// match host-app elements. Scope every rule that declares only `--tw-*` custom
// properties. `:is()` keeps each selector's own specificity semantics intact.
const scopeTailwindDefaults = {
  postcssPlugin: 'scope-tailwind-defaults',
  OnceExit(cssRoot) {
    cssRoot.walkRules((rule) => {
      if (rule.selector.includes('.docx-editor')) return;
      const nodes = rule.nodes ?? [];
      if (nodes.length === 0) return;
      const onlyTwVars = nodes.every(
        (node) => node.type === 'decl' && node.prop.startsWith('--tw-')
      );
      if (!onlyTwVars) return;
      rule.selectors = rule.selectors.map((selector) => `.docx-editor :is(${selector})`);
    });
  },
};

const result = await postcss([
  tailwindcss({ config: join(root, 'tailwind.dist.config.cjs') }),
  scopeTailwindDefaults,
  autoprefixer(),
]).process(input, { from, map: false });

const problems = coreCssProblems(result.css);
if (problems.length > 0) {
  console.error('core: refusing to emit dist/editor.css:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

mkdirSync(dirname(to), { recursive: true });
writeFileSync(to, result.css);
console.log(
  `core: compiled editor.css into dist (${(result.css.length / 1024).toFixed(0)} KiB, utilities scoped to .docx-editor)`
);
