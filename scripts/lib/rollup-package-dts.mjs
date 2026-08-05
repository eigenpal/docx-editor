// API Extractor dtsRollup helper for published packages. Bundles private
// `@docx-editor.dev/core-contract` typings into adapter `dist/_contract/` and
// produces valid ambient declarations for `@docx-editor.dev/i18n`.

import { copyFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';
import path from 'node:path';
import {
  bundleContractDts,
  rewriteCoreContractImports,
  rewritePrivateCoreImports,
} from './bundle-contract-dts.mjs';

const PRIVATE_SPECIFIER =
  /@docx-editor\.dev\/core(?:-contract)?(?:\/[^'"]*)?/;
const WORKSPACE_CORE_PATH = /(?:\.\.\/)+core\/src\//;

function isPrivateDeclarationReference(line) {
  if (/^import\s/.test(line) && (PRIVATE_SPECIFIER.test(line) || WORKSPACE_CORE_PATH.test(line))) {
    return true;
  }
  if (
    /^export\s.*\sfrom\s['"]/.test(line) &&
    (PRIVATE_SPECIFIER.test(line) || WORKSPACE_CORE_PATH.test(line))
  ) {
    return true;
  }
  return false;
}

function withTemporaryDependency(packageJsonPath, dependencyName, dependencyVersion) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const savedDependencies = pkg.dependencies;
  pkg.dependencies = {
    ...(pkg.dependencies ?? {}),
    [dependencyName]: dependencyVersion,
  };
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return () => {
    pkg.dependencies = savedDependencies;
    writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  };
}

export function stripPrivateSpecifiers(content) {
  const kept = [];
  for (const line of content.split('\n')) {
    if (isPrivateDeclarationReference(line)) continue;
    kept.push(line);
  }
  let after = kept.join('\n');
  after = after.replace(/\b([A-Za-z][A-Za-z0-9]*)_2\b/g, '$1');
  after = after.replace(/\b([A-Za-z][A-Za-z0-9]*)_3\b/g, '$1');
  after = after.replace(/\b([A-Za-z][A-Za-z0-9]*)_4\b/g, '$1');
  after = after.replace(
    /^export declare type LocaleStrings = typeof enJson;\s*$/m,
    '// LocaleStrings is declared from the English locale shape below.'
  );
  return after;
}

function removeInlinedJsonVars(content) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => /^var _lang = /.test(line));
  if (start === -1) return content;
  let end = start;
  while (end < lines.length && !/^\/\*\*/.test(lines[end])) end += 1;
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

function fixLocaleStrings(content) {
  content = content.replace(/^export declare const en: LocaleStrings;\s*$/m, 'export declare const en: AnyRecord;');
  if (!/export declare const en:/.test(content) && !/export declare const en;/.test(content)) {
    return content;
  }
  return content.replace(
    /^export declare type LocaleStrings = .*;$/m,
    'export declare type LocaleStrings = typeof en;'
  );
}

function invokeRollup({ packageRoot, packageJsonPath, mainDtsPath, outputPath, bundledPackages, tsconfigPath }) {
  const restoreDependency = bundledPackages.includes('@docx-editor.dev/core-contract')
    ? withTemporaryDependency(packageJsonPath, '@docx-editor.dev/core-contract', 'workspace:*')
    : () => {};

  try {
    const configObject = {
      mainEntryPointFilePath: mainDtsPath,
      bundledPackages,
      apiReport: { enabled: false },
      docModel: { enabled: false },
      dtsRollup: {
        enabled: true,
        publicTrimmedFilePath: outputPath,
      },
      tsdocMetadata: { enabled: false },
      compiler: { tsconfigFilePath: tsconfigPath },
      projectFolder: packageRoot,
    };
    const extractorConfig = ExtractorConfig.prepare({
      configObject,
      configObjectFullPath: packageJsonPath,
      packageJsonFullPath: packageJsonPath,
    });
    const result = Extractor.invoke(extractorConfig, {
      localBuild: true,
      showVerboseMessages: false,
    });
    if (result.errorCount > 0) {
      throw new Error(`API Extractor dtsRollup failed for ${packageJsonPath}`);
    }
  } finally {
    restoreDependency();
  }
}

/**
 * @param {{
 *   repoRoot: string,
 *   packageRoot: string,
 *   entryDts?: string,
 *   bundledPackages?: string[],
 *   tsconfigPath?: string,
 *   mode?: 'adapter' | 'adapter-strip-only' | 'i18n' | 'plain',
 * }} options
 */
export function rollupPackageDts(options) {
  const {
    repoRoot,
    packageRoot,
    entryDts = 'dist/index.d.ts',
    bundledPackages = [],
    tsconfigPath = path.join(packageRoot, 'tsconfig.json'),
    mode = 'plain',
  } = options;

  const packageJsonPath = path.join(packageRoot, 'package.json');
  const mainDtsPath = path.join(packageRoot, entryDts);
  if (!existsSync(mainDtsPath)) {
    throw new Error(`Missing declaration entry ${mainDtsPath}`);
  }

  const tempPath = path.join(packageRoot, entryDts.replace(/\.d\.ts$/, '.rollup-temp.d.ts'));
  invokeRollup({
    packageRoot,
    packageJsonPath,
    mainDtsPath,
    outputPath: tempPath,
    bundledPackages,
    tsconfigPath,
  });

  let content = readFileSync(tempPath, 'utf8');
  if (mode === 'i18n') {
    content = removeInlinedJsonVars(content);
    content = fixLocaleStrings(content);
  } else if (mode === 'adapter' || mode === 'adapter-strip-only') {
    content = stripPrivateSpecifiers(content);
  } else {
    content = stripPrivateSpecifiers(content);
  }

  writeFileSync(mainDtsPath, content);
  if (existsSync(tempPath)) {
    unlinkSync(tempPath);
  }
  const mtsPath = mainDtsPath.replace(/\.d\.ts$/, '.d.mts');
  if (existsSync(mtsPath)) {
    copyFileSync(mainDtsPath, mtsPath);
  }
}

function dedupeDuplicateTypeLines(content, names) {
  const lines = content.split(/\r?\n/);
  const seen = new Set();
  const kept = [];
  for (const line of lines) {
    const match = line.match(/^(?:export declare |declare )?type ([A-Za-z0-9_]+) = /);
    if (match && names.includes(match[1])) {
      if (seen.has(match[1])) continue;
      seen.add(match[1]);
    }
    kept.push(line);
  }
  return `${kept.join('\n')}\n`;
}

function appendAdapterMissingTypeStubs(content) {
  const hasBinding = (name) =>
    new RegExp(
      `\\b(?:export declare |declare |import type \\{[^}]*|import \\{[^}]*)\\b${name}\\b`
    ).test(content);
  const hasDeclaration = (name) =>
    new RegExp(
      `\\b(?:export declare |declare )?(?:type|interface|const|class|enum) ${name}\\b`
    ).test(content);
  const stubs = [];
  const declareUnknown = (name) => {
    if (new RegExp(`\\b${name}\\b`).test(content) && !hasBinding(name) && !hasDeclaration(name)) {
      stubs.push(`export declare type ${name} = unknown;`);
    }
  };
  const declareInterface = (name, body) => {
    if (new RegExp(`\\b${name}\\b`).test(content) && !hasBinding(name) && !hasDeclaration(name)) {
      stubs.push(`export declare interface ${name} ${body}`);
    }
  };

  declareUnknown('OoxmlElement');
  declareUnknown('LayoutShapingOptions');
  declareUnknown('StoryScope');
  declareUnknown('BookmarkIndex');
  declareUnknown('SemanticPosition');
  if (/\bTreeDocxSession\b/.test(content) && !hasDeclaration('TreeDocxSession')) {
    stubs.push(
      'export declare interface TreeDocxSession { applyTreeOps(ops: readonly unknown[]): unknown; }'
    );
  }

  if (/\bTextMeasurer\b/.test(content) && !hasBinding('TextMeasurer') && !hasDeclaration('TextMeasurer')) {
    stubs.push(
      'export declare interface TextMeasurer { measureText(text: string, style: unknown): number; }'
    );
  }
  if (/\bNavigationCommand\b/.test(content) && !hasBinding('NavigationCommand') && !hasDeclaration('NavigationCommand')) {
    stubs.push(
      "export declare type NavigationCommand = 'left' | 'right' | 'up' | 'down' | 'wordLeft' | 'wordRight' | 'lineStart' | 'lineEnd' | 'documentStart' | 'documentEnd' | 'pageUp' | 'pageDown';"
    );
  }
  declareInterface('CellSelection', '{ readonly tableId: string; readonly rowIndex: number; readonly columnIndex: number; }');
  declareInterface('RevisionAddress', '{ readonly revisionRef: string; }');

  if (stubs.length === 0) return content;
  return `${content.trim()}\n\n${stubs.join('\n')}\n`;
}

function dedupeAdapterDeclarationConflicts(content) {
  let next = dedupeDuplicateTypeLines(content, [
    'ContentControlLock',
    'ContentControlType',
    'TableBorderEdgeTarget',
    'TableBorderStyle',
    'TableBorderTarget',
    'UseEditorStateOptions',
  ]);
  next = next.replace(/^type HeaderFooterState = Exclude<ReturnType<Editor\['getHeaderFooterState'\]>, null>;\r?\n/gm, '');
  next = next.replace(/^type NotePropertiesState = Exclude<ReturnType<Editor\['getNotePropertiesState'\]>, null>;\r?\n/gm, '');
  next = next.replace(
    /export \{([^}]*)\};\s*$/m,
    (_, exports) => {
      const cleaned = exports
        .split(',')
        .map((part) => part.trim())
        .filter(
          (part) =>
            part !== 'type ContentControlLock' &&
            part !== 'type HeaderFooterState' &&
            part !== 'type NotePropertiesState'
        )
        .join(', ');
      return `export { ${cleaned} };`;
    }
  );
  return next;
}

function syncDeclarationMirror(indexPath) {
  const mtsPath = indexPath.replace(/\.d\.ts$/, '.d.mts');
  if (existsSync(mtsPath)) {
    copyFileSync(indexPath, mtsPath);
  }
}

function ensureAdapterContractTypeImports(content) {
  const needsHeaderFooter = /\bHeaderFooterState\b/.test(content);
  const needsNoteProperties = /\bNotePropertiesState\b/.test(content);
  const missing = [];
  if (needsHeaderFooter && !/import type \{[^}]*HeaderFooterState/.test(content)) {
    missing.push('HeaderFooterState');
  }
  if (needsNoteProperties && !/import type \{[^}]*NotePropertiesState/.test(content)) {
    missing.push('NotePropertiesState');
  }
  if (missing.length === 0) return content;
  const importLine = `import type { ${missing.join(', ')} } from './_contract/contracts/editor-hf-notes';\n`;
  const anchor = content.indexOf("import { Translations } from '@docx-editor.dev/i18n';");
  if (anchor === -1) return `${importLine}${content}`;
  return `${content.slice(0, anchor)}${importLine}${content.slice(anchor)}`;
}

export function finalizeReactAdapterIndex({ repoRoot, packageRoot }) {
  const contractDir = path.join(packageRoot, 'dist/_contract');
  bundleContractDts(repoRoot, 'adapter', contractDir);

  const indexPath = path.join(packageRoot, 'dist/index.d.ts');
  let content = readFileSync(indexPath, 'utf8');
  if (!content.includes('reference path="./_contract/ambient.d.ts"')) {
    content = `/// <reference path="./_contract/ambient.d.ts" />\n${content}`;
  }
  content = rewriteCoreContractImports(content);
  content = stripPrivateSpecifiers(content);
  content = ensureAdapterContractTypeImports(content);
  content = dedupeAdapterDeclarationConflicts(content);
  content = appendAdapterMissingTypeStubs(content);
  writeFileSync(indexPath, content);
  syncDeclarationMirror(indexPath);
}

export function finalizeAdapterIndex({ repoRoot, packageRoot, tsconfigPath }) {
  rollupPackageDts({
    repoRoot,
    packageRoot,
    bundledPackages: ['@docx-editor.dev/core-contract'],
    tsconfigPath,
    mode: 'adapter-strip-only',
  });
  const indexPath = path.join(packageRoot, 'dist/index.d.ts');
  writeFileSync(indexPath, appendAdapterMissingTypeStubs(readFileSync(indexPath, 'utf8')));
}

function walkDistDtsFiles(distDir) {
  const files = [];
  for (const entry of readdirSync(distDir, { recursive: true })) {
    const relative = typeof entry === 'string' ? entry : String(entry);
    const entryPath = path.join(distDir, relative);
    if (!entryPath.endsWith('.d.ts')) continue;
    if (entryPath.includes('.rollup-temp.d.ts')) continue;
    files.push(entryPath);
  }
  return files;
}

export function finalizeVueAdapterIndex({ repoRoot, packageRoot }) {
  const distDir = path.join(packageRoot, 'dist');
  const contractDir = path.join(distDir, '_contract');
  bundleContractDts(repoRoot, 'adapter', contractDir);

  for (const file of walkDistDtsFiles(distDir)) {
    if (file.includes(`${path.sep}_contract${path.sep}`)) continue;
    let content = readFileSync(file, 'utf8');
    const before = content;
    if (file.endsWith(`${path.sep}index.d.ts`) && !content.includes('reference path="./_contract/ambient.d.ts"')) {
      content = `/// <reference path="./_contract/ambient.d.ts" />\n${content}`;
    }
    content = rewriteCoreContractImports(content);
    content = stripPrivateSpecifiers(content);
    if (file.endsWith(`${path.sep}index.d.ts`)) {
      content = ensureAdapterContractTypeImports(content);
      content = dedupeAdapterDeclarationConflicts(content);
      content = appendAdapterMissingTypeStubs(content);
    }
    if (content !== before) writeFileSync(file, content);
    syncDeclarationMirror(file);
  }
}

/**
 * Bundle headless contract declarations and rewrite agents dist imports.
 *
 * @param {string} distDir
 * @param {string} repoRoot
 */
export function stripAgentsDeclarationTree(distDir, repoRoot) {
  const contractDir = path.join(distDir, '_contract');
  bundleContractDts(repoRoot, 'agentsHeadless', contractDir);

  const serverChunk = readdirSync(distDir).find(
    (entry) => /^server-[A-Za-z0-9_-]+\.d\.ts$/.test(entry)
  );
  const agentTypesChunk = readdirSync(distDir).find(
    (entry) => /^agent-types-[A-Za-z0-9_-]+\.d\.ts$/.test(entry)
  );
  if (!serverChunk || !agentTypesChunk) {
    throw new Error('Missing agents declaration chunks in dist/');
  }

  const serverModule = `./${serverChunk.replace(/\.d\.ts$/, '')}`;
  const agentTypesModule = `./${agentTypesChunk.replace(/\.d\.ts$/, '')}`;

  writeFileSync(
    path.join(distDir, 'tools.d.ts'),
    `export type { j as AgentToolDefinition, k as AgentToolResult } from '${serverModule}';\n` +
      `export { n as agentTools, p as executeToolCall, q as getToolSchemas, t as getToolDisplayName } from '${serverModule}';\n`
  );
  writeFileSync(
    path.join(distDir, 'agent-types.d.ts'),
    readFileSync(path.join(distDir, agentTypesChunk), 'utf8')
      .replace(/^interface /gm, 'export interface ')
      .replace(/^export type \{ AgentMessage as A, AgentToolCall as a \};\s*$/m, '')
      .trim()
      .concat('\n')
  );
  writeFileSync(
    path.join(distDir, 'ai-sdk', 'shared.d.ts'),
    `import type { AgentMessage, AgentToolCall } from '../agent-types';\n\n` +
      `export interface AiSdkUIMessage {\n` +
      `  id: string;\n` +
      `  role: 'user' | 'assistant' | 'system';\n` +
      `  parts?: ReadonlyArray<{\n` +
      `    type: string;\n` +
      `    text?: string;\n` +
      `    toolCallId?: string;\n` +
      `    state?: string;\n` +
      `    input?: unknown;\n` +
      `    output?: unknown;\n` +
      `    errorText?: string;\n` +
      `  }>;\n` +
      `}\n\n` +
      `export declare function toAgentMessages(\n` +
      `  uiMessages: ReadonlyArray<AiSdkUIMessage>,\n` +
      `  status: string\n` +
      `): AgentMessage[];\n`
  );

  const rewriteSpecifiers = (content) => {
    let after = content.replace(
      new RegExp(`from '${serverModule}\\.js'`, 'g'),
      `from '${serverModule}'`
    );
    after = after.replace(
      new RegExp(`from '${agentTypesModule}\\.js'`, 'g'),
      `from '${agentTypesModule}'`
    );
    after = after.replace(/from '\.\/server-[A-Za-z0-9_-]+\.js'/g, `from '${serverModule}'`);
    after = after.replace(/from '\.\.\/agent-types-[A-Za-z0-9_-]+'/g, "from '../agent-types'");
    after = after.replace(
      /import \{ A as AgentMessage \} from '\.\.\/agent-types-[A-Za-z0-9_-]+'/g,
      "import type { AgentMessage } from '../agent-types'"
    );
    after = after.replace(
      /export \{ a as AgentToolCall \} from '\.\.\/agent-types-[A-Za-z0-9_-]+'/g,
      "export type { AgentToolCall } from '../agent-types'"
    );
    after = after.replace(
      /import \{ A as AgentMessage \} from '\.\.\/agent-types'/g,
      "import type { AgentMessage } from '../agent-types'"
    );
    after = after.replace(/from '\.\/tools'/g, "from './tools'");
    after = after.replace(/from '\.\/shared'/g, "from './shared'");
    after = after.replace(/from '\.\.\/agent-types'/g, "from '../agent-types'");
    return after;
  };

  for (const entry of readdirSync(distDir, { recursive: true })) {
    const relative = typeof entry === 'string' ? entry : String(entry);
    const entryPath = path.join(distDir, relative);
    if (!entryPath.endsWith('.d.ts')) continue;
    if (entryPath.includes('.rollup-temp.d.ts')) continue;
    if (entryPath.includes(`${path.sep}_contract${path.sep}`)) continue;

    const before = readFileSync(entryPath, 'utf8');
    let after = rewritePrivateCoreImports(before);
    after = stripPrivateSpecifiers(after);
    after = rewriteSpecifiers(after);
    after = after.replace(/^import '\.\/_contract\/headless';\s*\n/m, '');
    after = after.replace(/^export \{ \}\s*\n/m, '');

    if (after !== before) writeFileSync(entryPath, after);
  }
}

/**
 * Roll up one locale subpath declaration (`dist/<code>.d.ts`).
 *
 * @param {{ repoRoot: string, packageRoot: string, localeCode: string }} options
 */
export function rollupLocaleDts({ repoRoot, packageRoot, localeCode }) {
  const entry = `dist/${localeCode}.d.ts`;
  rollupPackageDts({
    repoRoot,
    packageRoot,
    entryDts: entry,
    bundledPackages: [],
    mode: 'plain',
  });
}
