#!/usr/bin/env node
/**
 * Mirrors the Vue side of each React/Vue pair against its React twin:
 * every Vue source file must have a React twin at the same relative path,
 * unless it is skipped (deprecated shell paths) or listed as an acknowledged
 * Vue-only module. Framework-neutral twins listed per pair must also stay
 * byte-identical.
 *
 * Pairs:
 *  - the adapters: `packages/react/src` vs `packages/vue/src`
 *  - the pro entries: `packages/pro/src/react` vs `packages/pro/src/vue`
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PAIRS = [
  {
    label: 'adapter',
    reactSrc: join(ROOT, 'packages/react/src'),
    vueSrc: join(ROOT, 'packages/vue/src'),
    // Deprecated shell-only paths, excluded on both sides.
    skipPrefixes: [
      'components/Toolbar',
      'components/TitleBar',
      'components/EditorToolbar',
      'components/PaginatedDocxEditorShell',
      'components/DocxEditor/DocxEditorShell',
      'managers/',
      'hooks/',
    ],
    vueOnlyAllowed: [],
    byteIdentical: [
      'docx-editor-ref-callback.ts',
      'editor/contextmenu/contextmenu-icons.ts',
      'editor/deferred-notifier.ts',
      'editor/document-presence.ts',
      'editor/editor-scope.ts',
      'editor/header-footer-units.ts',
      'editor/images/normalizeImageFile.ts',
      'editor/loading-snapshot.ts',
      'editor/menu/download.ts',
      'editor/menu/menu-keyboard.ts',
      'editor/paragraph-dialog-fields.ts',
      'editor/scroller-geometry.ts',
      'editor/toolbar/toolbar-measure.ts',
      'editor/toolbar/toolbar-overflow.ts',
      'editor/zoom-levels.ts',
      'lib/colorMode.ts',
      'lib/colorResolver.ts',
      'lib/fontOptions.ts',
      'lib/highlightColors.ts',
      'lib/listState.ts',
      'lib/reportIssue.ts',
      'lib/sidebarConstants.ts',
      'lib/stylePreview.ts',
      'lib/units.ts',
      'rulerTicks.ts',
      'styles/zIndex.ts',
      'version.ts',
    ],
  },
  {
    label: 'pro',
    reactSrc: join(ROOT, 'packages/pro/src/react'),
    vueSrc: join(ROOT, 'packages/pro/src/vue'),
    skipPrefixes: [],
    // Vue-internal decomposition with no React twin. Every entry must still
    // exist and stay React-twin-less, or the list is stale and the check fails.
    vueOnlyAllowed: [
      'review-card-parts.tsx',
      'review-context.ts',
      'review-rail-parts.tsx',
      'review-shared.ts',
      'review-types.ts',
      'stable-id.ts',
      'useEditorRenderRevision.ts',
    ],
    byteIdentical: ['review-labels.ts'],
  },
];

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(base, abs);
    if (statSync(abs).isDirectory()) {
      out.push(...walk(abs, base));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    out.push(rel);
  }
  return out;
}

function reactTwin(reactSrc, vueRel) {
  const base = vueRel.replace(/\.tsx?$/, '');
  for (const ext of ['.tsx', '.ts']) {
    const candidate = join(reactSrc, `${base}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

let failed = false;

for (const pair of PAIRS) {
  const vueFiles = walk(pair.vueSrc).filter(
    (rel) => !pair.skipPrefixes.some((prefix) => rel.startsWith(prefix))
  );

  const vueOnlyAllowed = new Set(pair.vueOnlyAllowed);
  const missing = vueFiles.filter(
    (rel) => !vueOnlyAllowed.has(rel) && !reactTwin(pair.reactSrc, rel)
  );
  if (missing.length) {
    failed = true;
    console.error(
      `Adapter mirror drift (${pair.label}): ${missing.length} Vue file(s) without a React twin`
    );
    for (const rel of missing.slice(0, 40)) console.error(`  vue-only path: ${rel}`);
    if (missing.length > 40) console.error(`  … and ${missing.length - 40} more`);
  }

  const staleAllowed = pair.vueOnlyAllowed.filter(
    (rel) => !existsSync(join(pair.vueSrc, rel)) || reactTwin(pair.reactSrc, rel)
  );
  if (staleAllowed.length) {
    failed = true;
    console.error(
      `Adapter mirror drift (${pair.label}): ${staleAllowed.length} stale vueOnlyAllowed entr${staleAllowed.length === 1 ? 'y' : 'ies'} — remove from the list or drop the React twin`
    );
    for (const rel of staleAllowed) console.error(`  stale allowlist entry: ${rel}`);
  }

  const contentDrift = pair.byteIdentical.filter((rel) => {
    const react = join(pair.reactSrc, rel);
    const vue = join(pair.vueSrc, rel);
    return !existsSync(react) || !existsSync(vue) || !readFileSync(react).equals(readFileSync(vue));
  });
  if (contentDrift.length) {
    failed = true;
    console.error(
      `Adapter mirror drift (${pair.label}): ${contentDrift.length} shared pure module(s) are no longer byte-identical`
    );
    for (const rel of contentDrift) console.error(`  content drift: ${rel}`);
  }

  if (!missing.length && !staleAllowed.length && !contentDrift.length) {
    console.log(
      `✓ adapter mirror (${pair.label}): ${vueFiles.length} Vue paths matched (${vueOnlyAllowed.size} acknowledged Vue-only); ${pair.byteIdentical.length} shared pure modules matched byte-for-byte`
    );
  }
}

if (failed) process.exit(1);
