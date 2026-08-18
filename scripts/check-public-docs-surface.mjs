import fs from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { collectNamedExports } from './lib/named-exports.mjs';
import {
  evaluatePublicDocsSurface,
  findRemovedSurfaceClaims,
  isCurrentPublicDoc,
} from './lib/public-docs-surface.mjs';

const root = resolve(import.meta.dirname, '..');
const docsRoot = resolve(root, 'docs/site/content');

function isUseExport(name) {
  return name.startsWith('use') && name[3] === name[3]?.toUpperCase();
}

function publicComposableExports(entry) {
  return [...collectNamedExports(resolve(root, `packages/${entry}/src/index.ts`))].filter(isUseExport);
}

function documentedComposables(mdxPath) {
  if (!fs.existsSync(mdxPath)) return new Set();
  const source = fs.readFileSync(mdxPath, 'utf8');
  const documented = new Set();
  for (const match of source.matchAll(/\buse[A-Z][A-Za-z0-9]*\b/g)) {
    documented.add(match[0]);
  }
  return documented;
}

const entries = {
  react: collectNamedExports(resolve(root, 'packages/react/src/index.ts')),
  vue: collectNamedExports(resolve(root, 'packages/vue/src/index.ts')),
  automation: collectNamedExports(resolve(root, 'packages/editor-api/src/index.ts')),
  automationBrowser: collectNamedExports(resolve(root, 'packages/editor-api/src/browser.ts')),
};

const required = {
  'shared adapter root contract': {
    entries: ['react', 'vue'],
    names: ['DocxEditor', 'DocxEditorProps', 'DocxEditorRef', 'EditorMode'],
  },
  'react provider and compound surface': {
    entries: ['react'],
    names: [
      'DocxEditorRoot',
      'DocxEditorViewport',
      'DocxEditorContent',
      'useDocxEditor',
      'useEditorState',
      'useEditorCommand',
      'useEditorEvent',
      'DocxEditorToolbar',
      'DocxEditorMenu',
      'DocxEditorNavigation',
      'DocxEditorPageSetupDialog',
    ],
  },
  'vue composition and composables surface': {
    entries: ['vue'],
    names: [
      'DocxEditorRoot',
      'DocxEditorViewport',
      'DocxEditorContent',
      'useDocxEditor',
      'useEditorState',
      'useEditorCommand',
      'useEditorEvent',
      'DocxEditorToolbar',
      'DocxEditorMenu',
      'DocxEditorNavigation',
      'DocxEditorPageSetupDialog',
      'HorizontalRuler',
      'VerticalRuler',
      'PageIndicator',
      'PaginatedDocxEditor',
    ],
  },
  // Both automation entries carry the whole documented vocabulary — the lifecycle types, the
  // object model and the error type — because a consumer's own code is written against those
  // names whichever entry constructed the runtime. The entries differ by ONE member,
  // `createBrowser`, and that difference is asserted in the package's own export tests rather
  // than here, where only presence can be stated.
  'document automation object model': {
    entries: ['automation', 'automationBrowser'],
    names: [
      'DocxEditor',
      'DocxEditorRuntime',
      'DocxEditorServerRuntime',
      'RequestContext',
      'RunCallback',
      'ClientObject',
      'ClientResult',
      'TrackedObjects',
      'LoadOption',
      'CreateServerOptions',
      'DocumentCapabilities',
      'DocumentLimits',
      'Paragraph',
      'Range',
      'ContentControl',
      'Section',
      'Comment',
      'Revision',
    ],
  },
};

function readMarkdownFiles(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...readMarkdownFiles(full));
      continue;
    }
    if (entry.isFile() && /\.mdx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

function documentedSubpaths(packageName, files) {
  const packageTail = packageName.replace('@docx-editor.dev/', '');
  const re = new RegExp(`@docx-editor\\.dev/${packageTail}(\\/[a-z0-9-]+)?(?=$|[^a-z0-9.-])`, 'g');
  const claims = new Set(['.']);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(re)) {
      const subpath = match[1];
      if (subpath) claims.add(`.${subpath}`);
    }
  }
  return Object.fromEntries([...claims].map((subpath) => [subpath, []]));
}

function packageExports(packageRoot) {
  const pkg = JSON.parse(fs.readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  const exported = {};
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    if (key === './package.json') continue;
    if (typeof value !== 'object' || value === null || typeof value.types !== 'string') continue;
    const source = value.types
      .replace(/^\.\/dist\//, './src/')
      .replace(/\.d\.(m|c)?ts$/, '.ts')
      .replace(/\.d\.ts$/, '.ts');
    exported[key] = [...collectNamedExports(resolve(packageRoot, source))];
  }
  return exported;
}

let failed = false;

for (const [group, contract] of Object.entries(required)) {
  for (const entry of contract.entries) {
    const names = entries[entry];
    const missing = contract.names.filter((name) => !names.has(name));
    if (missing.length > 0) {
      failed = true;
      console.error(`Public docs surface drift: ${group} missing from ${entry}:`);
      for (const name of missing) console.error(`  - ${name}`);
    }
  }
}

const mdxFiles = readMarkdownFiles(docsRoot);
const docsSurface = evaluatePublicDocsSurface({
  docsByPackage: {
    '@docx-editor.dev/react': {
      rootClaims: required['react provider and compound surface'].names,
      subpathClaims: documentedSubpaths('@docx-editor.dev/react', mdxFiles),
    },
    '@docx-editor.dev/vue': {
      rootClaims: required['vue composition and composables surface'].names,
      subpathClaims: documentedSubpaths('@docx-editor.dev/vue', mdxFiles),
    },
  },
  packageExports: {
    '@docx-editor.dev/react': packageExports(resolve(root, 'packages/react')),
    '@docx-editor.dev/vue': packageExports(resolve(root, 'packages/vue')),
  },
});

const publicDocFiles = [
  resolve(root, 'README.md'),
  ...readMarkdownFiles(resolve(root, 'docs')),
  ...readMarkdownFiles(resolve(root, 'packages')),
  ...readMarkdownFiles(resolve(root, 'examples')),
]
  .filter((file, index, all) => all.indexOf(file) === index)
  .filter((file) => isCurrentPublicDoc(relative(root, file)));

const publicDocSources = Object.fromEntries(
  publicDocFiles.map((file) => [relative(root, file), fs.readFileSync(file, 'utf8')])
);
const removedClaims = findRemovedSurfaceClaims(publicDocSources);

if (docsSurface.invalidSubpaths.length > 0) {
  failed = true;
  console.error(`Public docs surface drift: removed package subpaths still documented:`);
  for (const claim of docsSurface.invalidSubpaths) {
    console.error(`  - ${claim.packageName}${claim.subpath === '.' ? '' : claim.subpath.slice(1)}`);
  }
}

if (removedClaims.length > 0) {
  failed = true;
  console.error(`Public docs surface drift: removed React/Vue surface claims still documented:`);
  for (const claim of removedClaims) {
    console.error(`  - ${claim.file}: ${claim.claim}`);
  }
}

if (docsSurface.missingRootExports.length > 0) {
  failed = true;
  console.error(
    `Public docs surface drift: documented root exports missing from the package root:`
  );
  for (const claim of docsSurface.missingRootExports) {
    console.error(`  - ${claim.packageName}: ${claim.exportName}`);
  }
}

const composableDocs = {
  react: {
    page: resolve(docsRoot, 'react/hooks.mdx'),
    exports: publicComposableExports('react'),
  },
  vue: {
    page: resolve(docsRoot, 'vue/composables.mdx'),
    exports: publicComposableExports('vue'),
  },
};

const reactDocumented = documentedComposables(composableDocs.react.page);
const vueDocumented = documentedComposables(composableDocs.vue.page);

for (const [adapter, { page, exports }] of Object.entries(composableDocs)) {
  const rel = relative(root, page);
  const missing = exports.filter((name) => !documentedComposables(page).has(name));
  if (missing.length > 0) {
    failed = true;
    console.error(`Public docs surface drift: composables missing from ${rel}:`);
    for (const name of missing) console.error(`  - ${name}`);
  }
}

const reactOnly = composableDocs.react.exports.filter((name) => !vueDocumented.has(name));
const vueOnly = composableDocs.vue.exports.filter((name) => !reactDocumented.has(name));
if (reactOnly.length > 0 || vueOnly.length > 0) {
  failed = true;
  console.error('Public docs surface drift: composable docs must cover the same names in both adapters:');
  for (const name of reactOnly) console.error(`  - missing from vue/composables.mdx: ${name}`);
  for (const name of vueOnly) console.error(`  - missing from react/hooks.mdx: ${name}`);
}

if (failed) process.exit(1);

console.log(
  `✓ public docs surface: ${Object.keys(required).length} documented contract groups exported`
);
