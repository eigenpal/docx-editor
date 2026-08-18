#!/usr/bin/env node
// Cross-adapter composable and public-interface parity between React and Vue.
// Reads committed API Extractor snapshots; run after `api:check`.
//
// DocxEditorProps / DocxEditorRef are owned by check-parity-contract.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composableParityInterfaces,
  extractFunctionExports,
  extractInterfaceFields,
  extractInterfaceMemberTypes,
  normalizeSnapshotText,
  normalizeType,
  normalizeParamSignature,
} from './lib/api-snapshot-parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const REACT_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-react/index.api.md');
const VUE_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-vue/index.api.md');

const EXCLUDED_INTERFACES = new Set(['DocxEditorProps', 'DocxEditorRef', 'DocxEditorRootProps']);

/** Enumerated composable return interfaces — no suffix pattern matching. */
const COMPOSABLE_RETURN_INTERFACES = new Set([
  'EditorCommandState',
  'EditorValueCommandState',
  'UseContentControlResult',
  'UseDocumentOutlineResult',
  'UseDocumentSearchResult',
  'UseDocxSourceOptions',
  'UseDocxSourceResult',
  'UseFontFamilyResult',
  'UseHyperlinkPopupResult',
  'UseNavigationPaneOptions',
  'UseNavigationPaneResult',
  'UsePageSetupReturn',
  'UseParagraphIndentReturn',
  'UseParagraphStyleResult',
  'UseZoomResult',
  'HyperlinkPopupState',
  'HyperlinkPopupAnchor',
  'EditorCaret',
  'ParagraphStyleOption',
  'OutlineHeading',
  'OutlineHeadingItem',
  'ContentControlInspectorState',
  'NavigationPartProps',
  'NavigationTabProps',
  'FontFamilyProps',
  'FontFamilyPartProps',
  'FontFamilyItemProps',
  'ParagraphStyleProps',
  'ParagraphStylePartProps',
  'ParagraphStyleItemProps',
  'ToolbarButtonProps',
  'MenuItemProps',
  'MenuRowProps',
  'MenuSubmenuProps',
  'ContextMenuAnchor',
  'ContextMenuContextValue',
  'PageSetupUpdate',
  'IndentUpdate',
]);

function isUseExport(name) {
  return name.startsWith('use') && name[3] === name[3]?.toUpperCase();
}

function isComposableReturnInterface(name) {
  if (name.endsWith('Props') || name.endsWith('PartProps') || name.endsWith('ItemProps')) {
    return false;
  }
  return (
    name.startsWith('Use') ||
    name.endsWith('Result') ||
    name.endsWith('Return') ||
    [
      'EditorCommandState',
      'EditorValueCommandState',
      'EditorCaret',
      'HyperlinkPopupState',
      'HyperlinkPopupAnchor',
      'ContentControlInspectorState',
      'OutlineHeading',
      'OutlineHeadingItem',
      'PageSetupUpdate',
      'IndentUpdate',
      'ContextMenuAnchor',
      'ContextMenuContextValue',
    ].includes(name)
  );
}
function returnInterfacesFromUseExports(reactFns, vueFns) {
  const names = new Set();
  for (const fns of [reactFns, vueFns].filter(Boolean)) {
    for (const overloads of fns.values()) {
      for (const { returnType } of overloads) {
        const plain = normalizeType(returnType);
        if (/^[A-Z]\w*$/.test(plain)) names.add(plain);
      }
    }
  }
  return names;
}

function compareInterface(name, reactSnap, vueSnap, issues, stats, typeCheckInterfaces) {
  if (EXCLUDED_INTERFACES.has(name)) return;
  const reactFields = extractInterfaceFields(reactSnap, name);
  const vueFields = extractInterfaceFields(vueSnap, name);
  if (!reactFields && !vueFields) return;
  if (!reactFields) {
    issues.push(`INTERFACE '${name}' missing from React snapshot`);
    return;
  }
  if (!vueFields) {
    issues.push(`INTERFACE '${name}' missing from Vue snapshot`);
    return;
  }
  for (const k of reactFields) {
    if (!vueFields.has(k)) issues.push(`INTERFACE '${name}': member '${k}' missing from Vue`);
  }
  for (const k of vueFields) {
    if (!reactFields.has(k)) issues.push(`INTERFACE '${name}': member '${k}' missing from React`);
  }

  const reactTypes = extractInterfaceMemberTypes(reactSnap, name);
  const vueTypes = extractInterfaceMemberTypes(vueSnap, name);
  if (!reactTypes || !vueTypes || !typeCheckInterfaces.has(name)) return;
  for (const k of reactFields) {
    if (!reactTypes.has(k) || !vueTypes.has(k)) continue;
    stats.memberTypeChecks += 1;
    const r = normalizeType(reactTypes.get(k));
    const v = normalizeType(vueTypes.get(k));
    if (r !== v) {
      issues.push(`INTERFACE '${name}.${k}': type mismatch React '${r}' vs Vue '${v}'`);
    }
  }
}

function compareFunction(name, reactOverloads, vueOverloads, issues) {
  if (!reactOverloads?.length) {
    issues.push(`FUNCTION '${name}' missing from React snapshot`);
    return;
  }
  if (!vueOverloads?.length) {
    issues.push(`FUNCTION '${name}' missing from Vue snapshot`);
    return;
  }
  if (reactOverloads.length !== vueOverloads.length) {
    issues.push(
      `FUNCTION '${name}': overload count React ${reactOverloads.length} vs Vue ${vueOverloads.length}`
    );
  }
  const count = Math.min(reactOverloads.length, vueOverloads.length);
  for (let i = 0; i < count; i++) {
    const r = reactOverloads[i];
    const v = vueOverloads[i];
    const rParams = normalizeParamSignature(r.params);
    const vParams = normalizeParamSignature(v.params);
    if (rParams !== vParams) {
      issues.push(
        `FUNCTION '${name}' overload ${i + 1}: param signature React '(${r.params})' vs Vue '(${v.params})'`
      );
    }
    const rRet = normalizeType(r.returnType);
    const vRet = normalizeType(v.returnType);
    if (rRet !== vRet) {
      issues.push(
        `FUNCTION '${name}' overload ${i + 1}: return type React '${rRet}' vs Vue '${vRet}'`
      );
    }
  }
}

export function runComposableParityCheck({ reactSnap, vueSnap } = {}) {
  const reactSnapshot = normalizeSnapshotText(
    reactSnap ?? fs.readFileSync(REACT_SNAPSHOT, 'utf8')
  );
  const vueSnapshot = normalizeSnapshotText(vueSnap ?? fs.readFileSync(VUE_SNAPSHOT, 'utf8'));
  const issues = [];
  const stats = { memberTypeChecks: 0 };

  const reactFns = extractFunctionExports(reactSnapshot);
  const vueFns = extractFunctionExports(vueSnapshot);

  const useExports = new Set([...reactFns.keys(), ...vueFns.keys()].filter(isUseExport));
  for (const name of [...useExports].sort()) {
    compareFunction(name, reactFns.get(name), vueFns.get(name), issues);
  }

  const interfaceNames = new Set([
    ...composableParityInterfaces(reactSnapshot),
    ...composableParityInterfaces(vueSnapshot),
    ...COMPOSABLE_RETURN_INTERFACES,
  ]);
  const typeCheckInterfaces = new Set([
    ...[...COMPOSABLE_RETURN_INTERFACES].filter(isComposableReturnInterface),
    ...returnInterfacesFromUseExports(reactFns, vueFns),
  ]);
  for (const name of [...interfaceNames].sort()) {
    compareInterface(name, reactSnapshot, vueSnapshot, issues, stats, typeCheckInterfaces);
  }

  return {
    issues,
    useExportCount: useExports.size,
    interfaceCount: interfaceNames.size,
    memberTypeChecks: stats.memberTypeChecks,
  };
}

function main() {
  const selfTest = process.argv.includes('--self-test');
  if (selfTest) {
    runSelfTest();
    return;
  }

  for (const f of [REACT_SNAPSHOT, VUE_SNAPSHOT]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing required file: ${f}`);
      console.error('Run `bun run api:extract` first.');
      process.exit(1);
    }
  }

  const { issues, useExportCount, interfaceCount, memberTypeChecks } = runComposableParityCheck();
  console.log('Composable parity: docs/api/docx-editor-{react,vue}/index.api.md');
  console.log(`  use* exports checked: ${useExportCount}`);
  console.log(`  interfaces checked:   ${interfaceCount}`);
  console.log(`  member types checked: ${memberTypeChecks}`);

  const MIN_USE_EXPORTS = 20;
  const MIN_MEMBER_TYPE_CHECKS = 100;
  if (useExportCount < MIN_USE_EXPORTS) {
    console.error(
      `\nComposable parity gate misconfigured: expected at least ${MIN_USE_EXPORTS} use* exports, got ${useExportCount}.`
    );
    console.error('Check snapshot parsing (CRLF) or committed API snapshots.');
    process.exit(1);
  }
  if (memberTypeChecks < MIN_MEMBER_TYPE_CHECKS) {
    console.error(
      `\nComposable parity gate misconfigured: expected at least ${MIN_MEMBER_TYPE_CHECKS} member type checks, got ${memberTypeChecks}.`
    );
    console.error('Check member-type parsing or committed API snapshots.');
    process.exit(1);
  }

  if (issues.length > 0) {
    console.error(`\nComposable parity drift: ${issues.length} issue${issues.length === 1 ? '' : 's'}`);
    for (const issue of issues) issues.length <= 50 ? console.error(`  - ${issue}`) : null;
    if (issues.length > 50) {
      for (const issue of issues.slice(0, 50)) console.error(`  - ${issue}`);
      console.error(`  … and ${issues.length - 50} more`);
    }
    process.exit(1);
  }

  console.log('\nComposable parity check passed.');
}

function runSelfTest() {
  const base = `
export function useSample(slot: 'a'): SampleResult;
export function useSample(slot: 'b'): SampleResult;
export function useSample(slot: 'a' | 'b'): SampleResult;

export interface SampleResult {
    readonly value: string;
    readonly count: number;
    readonly run: () => void;
}
`;

  const okVue = base.replace('string', 'ShallowRef<string>').replace('number', 'ComputedRef<number>');

  let { issues } = runComposableParityCheck({ reactSnap: base, vueSnap: okVue });
  if (issues.length !== 0) {
    console.error('Self-test FAIL: normalized match should pass');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  const missingMember = okVue.replace('    readonly count: ComputedRef<number>;\n', '');
  ({ issues } = runComposableParityCheck({ reactSnap: base, vueSnap: missingMember }));
  if (!issues.some((i) => i.includes("member 'count'"))) {
    console.error('Self-test FAIL: expected missing member detection');
    process.exit(1);
  }

  const renamed = okVue.replace('readonly count:', 'readonly total:');
  ({ issues } = runComposableParityCheck({ reactSnap: base, vueSnap: renamed }));
  if (!issues.some((i) => i.includes("'count'"))) {
    console.error('Self-test FAIL: expected renamed member detection');
    process.exit(1);
  }

  const wrongType = okVue.replace('ShallowRef<string>', 'ShallowRef<number>');
  ({ issues } = runComposableParityCheck({ reactSnap: base, vueSnap: wrongType }));
  if (!issues.some((i) => i.includes('type mismatch'))) {
    console.error('Self-test FAIL: expected type mismatch detection');
    process.exit(1);
  }

  const droppedParam = base.replace("(slot: 'a' | 'b')", '(slot: string)');
  ({ issues } = runComposableParityCheck({ reactSnap: base, vueSnap: droppedParam }));
  if (!issues.some((i) => i.includes('param signature'))) {
    console.error('Self-test FAIL: expected param signature detection');
    process.exit(1);
  }

  const droppedOverload = base.replace("export function useSample(slot: 'b'): SampleResult;\n", '');
  ({ issues } = runComposableParityCheck({ reactSnap: base, vueSnap: droppedOverload }));
  if (!issues.some((i) => i.includes('overload count'))) {
    console.error('Self-test FAIL: expected overload count detection');
    process.exit(1);
  }

  const getterOk = `
export function useLive(editor: Editor | null): number;

export interface Editor {}
`;
  const getterVue = `
export function useLive(editor: MaybeRefOrGetter<Editor | null>): Ref<number>;

export interface Editor {}
`;
  ({ issues } = runComposableParityCheck({ reactSnap: getterOk, vueSnap: getterVue }));
  if (issues.length !== 0) {
    console.error('Self-test FAIL: MaybeRefOrGetter param should normalize');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  const crlfFixture = base.replace(/\n/g, '\r\n');
  ({ issues } = runComposableParityCheck({
    reactSnap: crlfFixture,
    vueSnap: crlfFixture.replace('string', 'ShallowRef<string>'),
  }));
  if (issues.length !== 0) {
    console.error('Self-test FAIL: CRLF snapshots should parse');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  const nestedParams = `
export function useNested(options?: { scope?: EditorScope }): SampleResult;

export interface SampleResult {
    readonly value: string;
}
`;
  const nestedVue = nestedParams.replace(
    'options?: { scope?: EditorScope }',
    'options?: MaybeRefOrGetter<{ scope?: EditorScope }>'
  );
  ({ issues } = runComposableParityCheck({ reactSnap: nestedParams, vueSnap: nestedVue }));
  if (issues.length !== 0) {
    console.error('Self-test FAIL: nested parameter objects should normalize');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  console.log('Composable parity self-test passed.');
}

main();
