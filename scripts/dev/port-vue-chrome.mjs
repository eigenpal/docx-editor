#!/usr/bin/env node
/**
 * Copy React chrome sources into packages/vue with extension .tsx for JSX.
 * Skips files that already exist in vue. Run typecheck after and fix by hand.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REACT = join(ROOT, 'packages/react/src');
const VUE = join(ROOT, 'packages/vue/src');

const COPY_DIRS = [
  'components/ui',
  'components/DocxEditor',
  'editor/images',
  'editor/menu',
  'editor/contextmenu',
  'editor/navigation',
];

const COPY_FILES = [
  'components/DocxEditor.tsx',
  'components/PaginatedDocxEditor.tsx',
  'components/DocumentOutline.tsx',
  'components/ErrorBoundary.tsx',
  'lib/colorMode.ts',
  'components/DocxEditor/hooks/useDocxEditorRefApi.ts',
  'editor/DocxEditorLoading.tsx',
  'editor/DocxEditorRulers.tsx',
  'editor/DocxEditorOutline.tsx',
  'editor/DocxEditorPageSetup.tsx',
  'editor/DocxEditorPageNumber.tsx',
  'editor/DocxEditorFontNotice.tsx',
  'editor/DocxEditorHeaderFooter.tsx',
  'editor/DocxEditorHyperLink.tsx',
  'editor/DocxEditorNotes.tsx',
  'editor/DocxEditorContentControl.tsx',
  'editor/toolbar/DocxEditorToolbar.tsx',
  'editor/toolbar/ToolbarOverflow.tsx',
  'editor/toolbar/ToolbarAction.tsx',
  'editor/toolbar/Alignment.tsx',
  'editor/toolbar/ColorSplit.tsx',
  'editor/toolbar/LineSpacing.tsx',
  'editor/toolbar/FontFamily.tsx',
  'editor/toolbar/ParagraphStyle.tsx',
  'editor/toolbar/EditingMode.tsx',
  'editor/toolbar/TableControls.tsx',
  'editor/toolbar/useTableChrome.tsx',
  'editor/toolbar/ContentControlParts.tsx',
  'editor/toolbar/steppers.tsx',
  'editor/toolbar/toolbar-overflow.ts',
  'editor/toolbar/useToolbarOverflow.ts',
  'types.ts',
];

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function copyIfMissing(src, dest) {
  if (existsSync(dest)) {
    console.log('skip', relative(ROOT, dest));
    return;
  }
  ensureDir(dirname(dest));
  cpSync(src, dest);
  console.log('copy', relative(ROOT, dest));
}

for (const dir of COPY_DIRS) {
  const srcDir = join(REACT, dir);
  if (!existsSync(srcDir)) continue;
  for (const name of readdirSync(srcDir)) {
    const src = join(srcDir, name);
    if (!statSync(src).isFile()) continue;
    const ext = name.endsWith('.tsx') ? '.tsx' : name.endsWith('.ts') ? '.ts' : null;
    if (!ext) continue;
    copyIfMissing(src, join(VUE, dir, name));
  }
}

for (const rel of COPY_FILES) {
  const src = join(REACT, rel);
  if (!existsSync(src)) {
    console.warn('missing', rel);
    continue;
  }
  copyIfMissing(src, join(VUE, rel));
}

console.log('Chrome copy pass complete');
