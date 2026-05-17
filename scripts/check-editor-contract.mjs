import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const reactSource = readFileSync(
  resolve(root, 'packages/react/src/components/DocxEditor.tsx'),
  'utf8'
);
const vueSource = readFileSync(resolve(root, 'packages/vue/src/docx-editor-props.ts'), 'utf8');

const VUE_ONLY_PROPS = new Set([
  // Vue chrome split that does not exist as a React prop.
  'showMenuBar',
]);

const REACT_PROPS_NOT_YET_IN_VUE = new Set([
  'onSave',
  'author',
  'onChange',
  'onSelectionChange',
  'onError',
  'onFontsLoaded',
  'externalContent',
  'onEditorViewReady',
  'showMarginGuides',
  'marginGuideColor',
  'rulerUnit',
  'placeholder',
  'loadingIndicator',
  'printOptions',
  'onCopy',
  'onCut',
  'onPaste',
  'onCommentAdd',
  'onCommentResolve',
  'onCommentDelete',
  'onCommentReply',
  'comments',
  'onCommentsChange',
  'onRenderedDomContextReady',
  'pluginOverlays',
  'pluginSidebarItems',
  'pluginRenderedDomContext',
  'agentPanel',
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
  const propRegex = /^\s{2}([A-Za-z_$][\w$]*)\??\s*:/gm;
  for (const match of body.matchAll(propRegex)) keys.add(match[1]);
  return keys;
}

const reactProps = extractPropKeys(reactSource, 'DocxEditorProps');
const vueProps = extractPropKeys(vueSource, 'DocxEditorProps');

const undocumentedMissing = [...reactProps]
  .filter((key) => !vueProps.has(key))
  .filter((key) => !REACT_PROPS_NOT_YET_IN_VUE.has(key))
  .sort();

const staleMissingAllowlist = [...REACT_PROPS_NOT_YET_IN_VUE]
  .filter((key) => vueProps.has(key))
  .sort();

const undocumentedVueOnly = [...vueProps]
  .filter((key) => !reactProps.has(key))
  .filter((key) => !VUE_ONLY_PROPS.has(key))
  .sort();

if (
  undocumentedMissing.length > 0 ||
  staleMissingAllowlist.length > 0 ||
  undocumentedVueOnly.length > 0
) {
  console.error('DocxEditor public prop contract drift detected.');
  if (undocumentedMissing.length > 0) {
    console.error(`\nReact props missing from Vue without an explicit staged divergence:`);
    for (const key of undocumentedMissing) console.error(`  - ${key}`);
  }
  if (staleMissingAllowlist.length > 0) {
    console.error(`\nProps now present in Vue but still listed as missing:`);
    for (const key of staleMissingAllowlist) console.error(`  - ${key}`);
  }
  if (undocumentedVueOnly.length > 0) {
    console.error(`\nVue-only props without an explicit divergence:`);
    for (const key of undocumentedVueOnly) console.error(`  - ${key}`);
  }
  process.exit(1);
}

console.log(
  `✓ DocxEditor prop contract: ${vueProps.size} Vue props checked, ` +
    `${REACT_PROPS_NOT_YET_IN_VUE.size} staged React props remain explicit divergences`
);
