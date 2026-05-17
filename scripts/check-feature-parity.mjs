#!/usr/bin/env node
// Tree-walk the React adapter's src and the Vue adapter's src; emit a
// component-by-component report so we can spot React behaviours
// (commands, dialogs, sidebar kinds, plugin hooks, agent bridges) that
// haven't crossed over to Vue yet.
//
// Designed to land alongside check-export-parity.mjs and
// check-i18n-parity.mjs as a third parity tier — informational while
// the Vue adapter is hardening, strict once the matrix flips.
//
// Run: node scripts/check-feature-parity.mjs
// Output: structured Markdown report on stdout, JSON to
//   openspec/changes/vue-editor-robust-implementation/notes/feature-parity-report.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REACT_ROOT = path.join(ROOT, 'packages/react/src');
const VUE_ROOT = path.join(ROOT, 'packages/vue/src');
const REPORT_PATH = path.join(
  ROOT,
  'openspec/changes/vue-editor-robust-implementation/notes/feature-parity-report.json'
);
const RENDER_PATH_DIVERGENCE = path.join(
  ROOT,
  'openspec/changes/vue-editor-robust-implementation/notes/intentional-render-path-divergence.md'
);

// Files whose React-only-ness is documented as intentional in the
// render-path divergence note. They share their behaviour with Vue
// via packages/core/src/layout-painter/, so the parity counter
// shouldn't penalise them.
function loadIntentionalRenderPathSet() {
  if (!fs.existsSync(RENDER_PATH_DIVERGENCE)) return new Set();
  const md = fs.readFileSync(RENDER_PATH_DIVERGENCE, 'utf8');
  const out = new Set();
  for (const line of md.split('\n')) {
    const m = line.match(/`(packages\/react\/src\/[^`]+)`/);
    if (m) {
      const base = path.basename(m[1]).replace(/\.(tsx?|ts)$/, '');
      out.add(base);
    }
  }
  return out;
}
const INTENTIONAL_RENDER_PATH = loadIntentionalRenderPathSet();

// Categories of behaviour we care about. Each pattern tags a string
// match in the file body. Cheap regex extraction — good enough to
// surface drift without parsing every TS file.
const PATTERNS = {
  commands: /\b(?:commands|getCommands\(\))\.([a-zA-Z][a-zA-Z0-9_]*)\s*\(/g,
  shortcuts: /['"`](?:Mod-|Cmd[+-]|Ctrl[+-])[A-Za-z0-9+\-]+['"`]/g,
  sidebarKinds: /\bkind:\s*['"]([a-z][a-z0-9-]*)['"]/g,
  pluginHooks: /\b(getSidebarItems|getCommands|getKeymap|onMount|onUnmount|getOverlays)\b/g,
};

function walkFiles(rootDir, accept) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, accept));
    } else if (accept(entry.name)) {
      // Skip test/spec files — they're not part of the public surface.
      if (/\.(test|spec)\.(t|j)sx?$/.test(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

function readSfcScript(src) {
  // Pull the `<script setup ...>` block out of a .vue SFC. Returns
  // both the inner contents (for body extraction) and a mock
  // "TS-like" surface so the regexes below find the same patterns
  // in Vue files as in React .tsx files.
  const m = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  return m ? m[1] : '';
}

function extractFromFile(absPath) {
  const src = fs.readFileSync(absPath, 'utf8');
  const body = absPath.endsWith('.vue') ? readSfcScript(src) : src;
  const componentName = path
    .basename(absPath)
    .replace(/\.(tsx?|vue|jsx?)$/, '');

  // Tag files that are pure core re-exports — they don't add surface
  // (the canonical implementation lives in @eigenpal/docx-editor-core)
  // so the parity counter shouldn't penalise them as react-only.
  // Only consider .ts/.tsx; Vue SFCs always have a <template>, so
  // they're never pure shims.
  const isVue = absPath.endsWith('.vue');
  const isCoreReexport =
    !isVue &&
    /\bfrom\s+['"]@eigenpal\/docx-editor-core/.test(body) &&
    !/\b(function|class|const\s+\w+\s*=\s*[^/])\b/.test(
      body.replace(/from\s+['"][^'"]+['"]/g, '')
    );

  // Props: best-effort regex over `XxxProps` interface bodies and
  // `defineProps<{...}>()` literals.
  const props = [];
  const propsBlock = body.match(
    /(?:interface\s+[A-Za-z]+Props\s*(?:extends\s+[^{]+)?\s*\{|defineProps<\s*\{)([\s\S]*?)\}\s*[)>;]/
  );
  if (propsBlock) {
    for (const line of propsBlock[1].split('\n')) {
      const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)(\??):\s*([^;]+);?/);
      if (m) props.push({ name: m[1], required: m[2] !== '?', type: m[3].trim() });
    }
  }

  // Emits: React → onXxx prop names already captured above; we tag
  // them here for direct comparison. Vue → defineEmits or $emit calls.
  const emits = new Set();
  for (const p of props) if (/^on[A-Z]/.test(p.name)) emits.add(p.name);
  for (const m of body.matchAll(/\$emit\s*\(\s*['"]([a-zA-Z][a-zA-Z0-9-]*)['"]/g)) {
    emits.add(m[1]);
  }
  for (const m of body.matchAll(/\(\s*e:\s*['"]([a-zA-Z][a-zA-Z0-9-]*)['"]/g)) {
    emits.add(m[1]);
  }

  // Categorical sets — dump every regex hit into the right bucket.
  const buckets = {
    commands: new Set(),
    shortcuts: new Set(),
    sidebarKinds: new Set(),
    pluginHooks: new Set(),
  };
  for (const [key, re] of Object.entries(PATTERNS)) {
    for (const m of body.matchAll(re)) buckets[key].add(m[1] ?? m[0]);
  }

  return {
    componentName,
    filePath: path.relative(ROOT, absPath),
    isCoreReexport,
    props,
    emits: [...emits].sort(),
    commands: [...buckets.commands].sort(),
    shortcuts: [...buckets.shortcuts].sort(),
    sidebarKinds: [...buckets.sidebarKinds].sort(),
    pluginHooks: [...buckets.pluginHooks].sort(),
  };
}

// React → emit name normalisation: 'onAddComment' ↔ 'add-comment'.
function normaliseEmitName(s) {
  if (/^on[A-Z]/.test(s)) {
    return s
      .slice(2)
      .replace(/[A-Z]/g, (c, i) => (i === 0 ? c.toLowerCase() : `-${c.toLowerCase()}`));
  }
  return s.toLowerCase();
}

function diffSets(reactSet, vueSet) {
  const a = new Set(reactSet);
  const b = new Set(vueSet);
  return {
    both: [...a].filter((x) => b.has(x)).sort(),
    reactOnly: [...a].filter((x) => !b.has(x)).sort(),
    vueOnly: [...b].filter((x) => !a.has(x)).sort(),
  };
}

function buildReport() {
  const reactFiles = walkFiles(REACT_ROOT, (n) => n.endsWith('.tsx') || n.endsWith('.ts'));
  const vueFiles = walkFiles(VUE_ROOT, (n) => n.endsWith('.vue') || n.endsWith('.ts'));
  // Drop pure core re-exports — the surface lives in core, not in
  // the adapter, so they shouldn't count as adapter-specific drift.
  // Also drop files documented as intentional render-path divergence
  // (Vue ships the same behaviour via core's layout-painter).
  const reactComponents = reactFiles
    .map(extractFromFile)
    .filter((f) => !f.isCoreReexport && !INTENTIONAL_RENDER_PATH.has(f.componentName));
  const vueComponents = vueFiles.map(extractFromFile).filter((f) => !f.isCoreReexport);

  const byName = new Map();
  for (const r of reactComponents) {
    byName.set(r.componentName, { name: r.componentName, react: r });
  }
  for (const v of vueComponents) {
    const row = byName.get(v.componentName) ?? { name: v.componentName };
    row.vue = v;
    byName.set(v.componentName, row);
  }

  const components = [];
  for (const row of byName.values()) {
    const status = !row.react
      ? 'vue-only'
      : !row.vue
        ? 'react-only'
        : 'present-in-both';
    if (status === 'present-in-both') {
      const reactEmits = new Set(row.react.emits.map(normaliseEmitName));
      const vueEmits = new Set(row.vue.emits.map(normaliseEmitName));
      row.divergence = {
        propsAddedInReact: row.react.props.filter(
          (p) => !row.vue.props.find((q) => q.name === p.name)
        ),
        propsAddedInVue: row.vue.props.filter(
          (p) => !row.react.props.find((q) => q.name === p.name)
        ),
        emitsAddedInReact: [...reactEmits].filter((e) => !vueEmits.has(e)),
        emitsAddedInVue: [...vueEmits].filter((e) => !reactEmits.has(e)),
      };
      const hasDiff =
        row.divergence.propsAddedInReact.length +
          row.divergence.propsAddedInVue.length +
          row.divergence.emitsAddedInReact.length +
          row.divergence.emitsAddedInVue.length >
        0;
      row.status = hasDiff ? 'signature-divergence' : 'present-in-both';
    } else {
      row.status = status;
    }
    components.push(row);
  }
  components.sort((a, b) => a.name.localeCompare(b.name));

  // Aggregate global category sets across the whole adapter.
  const aggregate = (xs, key) => {
    const out = new Set();
    for (const x of xs) for (const v of x[key]) out.add(v);
    return [...out];
  };

  const summary = components.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    { 'present-in-both': 0, 'react-only': 0, 'vue-only': 0, 'signature-divergence': 0 }
  );

  return {
    generatedAt: new Date().toISOString(),
    reactRoot: path.relative(ROOT, REACT_ROOT),
    vueRoot: path.relative(ROOT, VUE_ROOT),
    summary,
    components,
    commands: diffSets(
      aggregate(reactComponents, 'commands'),
      aggregate(vueComponents, 'commands')
    ),
    shortcuts: diffSets(
      aggregate(reactComponents, 'shortcuts'),
      aggregate(vueComponents, 'shortcuts')
    ),
    sidebarKinds: diffSets(
      aggregate(reactComponents, 'sidebarKinds'),
      aggregate(vueComponents, 'sidebarKinds')
    ),
    pluginHooks: diffSets(
      aggregate(reactComponents, 'pluginHooks'),
      aggregate(vueComponents, 'pluginHooks')
    ),
  };
}

function formatMarkdown(report) {
  const out = [];
  out.push(`# Feature parity report — ${report.generatedAt}`);
  out.push('');
  out.push(
    `Comparing \`${report.reactRoot}\` vs \`${report.vueRoot}\`. Counts: ` +
      `${report.summary['react-only']} react-only, ` +
      `${report.summary['vue-only']} vue-only, ` +
      `${report.summary['signature-divergence']} divergent, ` +
      `${report.summary['present-in-both']} matched.`
  );
  out.push('');
  out.push('## React-only components');
  out.push('');
  for (const row of report.components.filter((r) => r.status === 'react-only')) {
    out.push(`- **${row.name}** — \`${row.react.filePath}\``);
  }
  out.push('');
  out.push('## Vue-only components');
  out.push('');
  for (const row of report.components.filter((r) => r.status === 'vue-only')) {
    out.push(`- **${row.name}** — \`${row.vue.filePath}\``);
  }
  out.push('');
  out.push('## Signature divergence');
  out.push('');
  for (const row of report.components.filter((r) => r.status === 'signature-divergence')) {
    const d = row.divergence;
    const bits = [];
    if (d.propsAddedInReact.length)
      bits.push(`+react props: ${d.propsAddedInReact.map((p) => p.name).join(', ')}`);
    if (d.propsAddedInVue.length)
      bits.push(`+vue props: ${d.propsAddedInVue.map((p) => p.name).join(', ')}`);
    if (d.emitsAddedInReact.length)
      bits.push(`+react emits: ${d.emitsAddedInReact.join(', ')}`);
    if (d.emitsAddedInVue.length)
      bits.push(`+vue emits: ${d.emitsAddedInVue.join(', ')}`);
    out.push(`- **${row.name}** — ${bits.join('; ')}`);
  }
  out.push('');
  for (const cat of ['commands', 'shortcuts', 'sidebarKinds', 'pluginHooks']) {
    const d = report[cat];
    if (!d.reactOnly.length && !d.vueOnly.length) continue;
    out.push(`## ${cat}`);
    out.push('');
    if (d.reactOnly.length)
      out.push(`- React-only: ${d.reactOnly.map((s) => `\`${s}\``).join(', ')}`);
    if (d.vueOnly.length)
      out.push(`- Vue-only: ${d.vueOnly.map((s) => `\`${s}\``).join(', ')}`);
    out.push('');
  }
  return out.join('\n');
}

const report = buildReport();
process.stdout.write(formatMarkdown(report) + '\n');

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
process.stderr.write(`\nJSON report written to ${path.relative(ROOT, REPORT_PATH)}\n`);
