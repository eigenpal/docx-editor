import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

// Greenfield type locations. The pre-rebuild paths
// (`packages/react/src/components/DocxEditor.tsx`,
// `packages/vue/src/components/DocxEditor/types.ts`) were deleted by the strip
// at 701c1a9f, which left this gate throwing ENOENT on every run — a check that
// cannot pass reads as coverage while measuring nothing.
const reactSource = readFileSync(resolve(root, 'packages/react/src/types.ts'), 'utf8');
const vueSource = readFileSync(resolve(root, 'packages/vue/src/types.ts'), 'utf8');

const VUE_ONLY_PROPS = new Set([
  // Vue sugar host declares `class`; React names the same surface `className`.
  'class',
]);

// React props with framework-native Vue equivalents. check-parity-contract.mjs
// verifies each callback against an emit, each render prop against a slot, and
// className against class. This set does not exclude a capability from parity.
const REACT_FRAMEWORK_EQUIVALENTS = new Set([
  // Vue applies `class` as a declared prop; React names it `className`.
  'className',
  // Vue exposes these as EMITS (`@ready`, `@change`, `@fontError`), which never
  // appear in DocxEditorProps.
  'onReady',
  'onChange',
  'onFontError',
  'onSave',
  'onOpen',
  'onTitleChange',
  // React renders viewport-extras as children; Vue's equivalent is the default slot.
  'children',
  // Title-bar render props; Vue uses named slots with the same names.
  'renderTitleBarLeft',
  'renderTitleBarRight',
]);

function extractInterfaceBody(source, name) {
  const start = source.indexOf(`interface ${name}`);
  if (start === -1) throw new Error(`Could not find interface ${name}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index++) {
    const char = source[index];
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (depth === 0) return source.slice(braceStart + 1, index);
  }
  throw new Error(`Could not find end of interface ${name}`);
}

function extractPropKeys(source, name) {
  const body = extractInterfaceBody(source, name);
  const keys = new Set();
  const propRegex = /^\s+(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/gm;
  for (const match of body.matchAll(propRegex)) keys.add(match[1]);
  return keys;
}

const reactProps = extractPropKeys(reactSource, 'DocxEditorProps');
const vueProps = extractPropKeys(vueSource, 'DocxEditorProps');

const undocumentedMissing = [...reactProps]
  .filter((key) => !vueProps.has(key))
  .filter((key) => !REACT_FRAMEWORK_EQUIVALENTS.has(key))
  .sort();

const staleFrameworkEquivalents = [...REACT_FRAMEWORK_EQUIVALENTS]
  .filter((key) => vueProps.has(key))
  .sort();

const undocumentedVueOnly = [...vueProps]
  .filter((key) => !reactProps.has(key))
  .filter((key) => !VUE_ONLY_PROPS.has(key))
  .sort();

if (
  undocumentedMissing.length > 0 ||
  staleFrameworkEquivalents.length > 0 ||
  undocumentedVueOnly.length > 0
) {
  console.error('DocxEditor public prop contract drift detected.');
  if (undocumentedMissing.length > 0) {
    console.error(`\nReact props missing from Vue without an explicit staged divergence:`);
    for (const key of undocumentedMissing) console.error(`  - ${key}`);
  }
  if (staleFrameworkEquivalents.length > 0) {
    console.error(`\nProps now present in Vue but still mapped to framework equivalents:`);
    for (const key of staleFrameworkEquivalents) console.error(`  - ${key}`);
  }
  if (undocumentedVueOnly.length > 0) {
    console.error(`\nVue-only props without an explicit divergence:`);
    for (const key of undocumentedVueOnly) console.error(`  - ${key}`);
  }
  process.exit(1);
}

console.log(
  `✓ DocxEditor prop contract: ${vueProps.size} Vue props checked, ` +
    `${REACT_FRAMEWORK_EQUIVALENTS.size} React props have checked Vue framework equivalents`
);
