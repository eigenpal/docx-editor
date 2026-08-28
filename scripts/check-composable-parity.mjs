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
  extractTypeAliasBodies,
  normalizeSnapshotText,
  normalizeType,
  normalizeParamSignature,
} from './lib/api-snapshot-parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const REACT_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-react/index.api.md');
const VUE_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-vue/index.api.md');
const PARITY_CONTRACT = path.join(repoRoot, 'scripts/parity/parity.contract.json');

const EXCLUDED_INTERFACES = new Set(['DocxEditorProps', 'DocxEditorRef']);

/** @returns {Record<string, { react: string, vue: string }>} */
function loadFrameworkSlotFormTypeAliases() {
  if (!fs.existsSync(PARITY_CONTRACT)) return {};
  const contract = JSON.parse(fs.readFileSync(PARITY_CONTRACT, 'utf8'));
  const entries = contract.composableParity?.frameworkSlotFormTypeAliases ?? {};
  for (const [name, pair] of Object.entries(entries)) {
    if (!pair || typeof pair.react !== 'string' || typeof pair.vue !== 'string') {
      throw new Error(
        `Invalid frameworkSlotFormTypeAliases entry for '${name}' in ${PARITY_CONTRACT}`
      );
    }
  }
  return entries;
}

function matchesFrameworkSlotFormAlias(name, reactBody, vueBody, slotFormAliases) {
  const pair = slotFormAliases[name];
  if (!pair) return false;
  const rn = normalizeType(reactBody);
  const vn = normalizeType(vueBody);
  return rn === normalizeType(pair.react) && vn === normalizeType(pair.vue);
}

function isUseExport(name) {
  return name.startsWith('use') && name[3] === name[3]?.toUpperCase();
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

function compareInterface(name, reactSnap, vueSnap, issues, stats) {
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
  const comparedVueFields = new Set(vueFields);
  if (reactFields.has('className')) comparedVueFields.delete('class');
  for (const k of reactFields) {
    if (!comparedVueFields.has(k)) {
      issues.push(`INTERFACE '${name}': member '${k}' missing from Vue`);
    }
  }
  for (const k of comparedVueFields) {
    if (!reactFields.has(k)) issues.push(`INTERFACE '${name}': member '${k}' missing from React`);
  }

  const reactTypes = extractInterfaceMemberTypes(reactSnap, name);
  const vueTypes = extractInterfaceMemberTypes(vueSnap, name);
  if (!reactTypes || !vueTypes) return;
  for (const k of reactFields) {
    if (!reactTypes.has(k)) {
      issues.push(`INTERFACE '${name}.${k}': React member type was not parsed`);
      continue;
    }
    if (!vueTypes.has(k)) {
      issues.push(`INTERFACE '${name}.${k}': Vue member type was not parsed`);
      continue;
    }
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

function compareTypeAliases(reactSnap, vueSnap, issues, stats, slotFormAliases) {
  const reactAliases = extractTypeAliasBodies(reactSnap);
  const vueAliases = extractTypeAliasBodies(vueSnap);
  const names = new Set([...reactAliases.keys(), ...vueAliases.keys()]);
  for (const name of [...names].sort()) {
    const r = reactAliases.get(name);
    const v = vueAliases.get(name);
    if (!r) {
      issues.push(`TYPE ALIAS '${name}' missing from React snapshot`);
      continue;
    }
    if (!v) {
      issues.push(`TYPE ALIAS '${name}' missing from Vue snapshot`);
      continue;
    }
    stats.aliasChecks += 1;
    const rn = normalizeType(r);
    const vn = normalizeType(v);
    if (rn === vn) continue;
    if (matchesFrameworkSlotFormAlias(name, r, v, slotFormAliases)) {
      stats.slotFormAliasChecks += 1;
      continue;
    }
    issues.push(`TYPE ALIAS '${name}': body mismatch React '${rn}' vs Vue '${vn}'`);
  }
}

export function runComposableParityCheck({ reactSnap, vueSnap, slotFormAliases } = {}) {
  const reactSnapshot = normalizeSnapshotText(
    reactSnap ?? fs.readFileSync(REACT_SNAPSHOT, 'utf8')
  );
  const vueSnapshot = normalizeSnapshotText(vueSnap ?? fs.readFileSync(VUE_SNAPSHOT, 'utf8'));
  const issues = [];
  const stats = { memberTypeChecks: 0, aliasChecks: 0, slotFormAliasChecks: 0 };
  const slotForm = slotFormAliases ?? loadFrameworkSlotFormTypeAliases();

  const reactFns = extractFunctionExports(reactSnapshot);
  const vueFns = extractFunctionExports(vueSnapshot);

  const useExports = new Set([...reactFns.keys(), ...vueFns.keys()].filter(isUseExport));
  for (const name of [...useExports].sort()) {
    compareFunction(name, reactFns.get(name), vueFns.get(name), issues);
  }

  const interfaceNames = new Set([
    ...composableParityInterfaces(reactSnapshot),
    ...composableParityInterfaces(vueSnapshot),
    ...returnInterfacesFromUseExports(reactFns, vueFns),
  ]);
  for (const name of [...interfaceNames].sort()) {
    compareInterface(name, reactSnapshot, vueSnapshot, issues, stats);
  }

  compareTypeAliases(reactSnapshot, vueSnapshot, issues, stats, slotForm);

  return {
    issues,
    useExportCount: useExports.size,
    interfaceCount: interfaceNames.size,
    memberTypeChecks: stats.memberTypeChecks,
    aliasChecks: stats.aliasChecks,
    slotFormAliasChecks: stats.slotFormAliasChecks,
    slotFormAliasNames: Object.keys(slotForm),
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

  const { issues, useExportCount, interfaceCount, memberTypeChecks, aliasChecks, slotFormAliasChecks, slotFormAliasNames } =
    runComposableParityCheck();
  console.log('Composable parity: docs/api/docx-editor-{react,vue}/index.api.md');
  console.log(`  use* exports checked: ${useExportCount}`);
  console.log(`  interfaces checked:   ${interfaceCount}`);
  console.log(`  member types checked: ${memberTypeChecks}`);
  console.log(`  type aliases checked: ${aliasChecks}`);
  console.log('  normalizations:       Ref unwrap, MaybeRefOrGetter param, Vue class alias');
  console.log(
    `  slot-form aliases:    ${slotFormAliasNames.length > 0 ? slotFormAliasNames.join(', ') : '(none)'} (${slotFormAliasChecks} reconciled)`
  );
  console.log('  alias allowlists:     0');

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

export interface SampleProps {
    readonly children?: DocxEditorChildren;
    readonly onReady?: (editor: Editor) => void;
}

export interface Editor {}
`;

  const okVue = base
    .replace('string', 'ShallowRef<string>')
    .replace('number', 'ComputedRef<number>');

  let { issues } = runComposableParityCheck({ reactSnap: base, vueSnap: okVue });
  if (issues.length !== 0) {
    console.error('Self-test FAIL: normalized match should pass');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  const classAliasVue = okVue.replace(
    'export interface SampleProps {',
    'export interface SampleProps {\n    readonly class?: string;\n    readonly className?: string;'
  );
  const classAliasReact = base.replace(
    'export interface SampleProps {',
    'export interface SampleProps {\n    readonly className?: string;'
  );
  ({ issues } = runComposableParityCheck({
    reactSnap: classAliasReact,
    vueSnap: classAliasVue,
  }));
  if (issues.length !== 0) {
    console.error('Self-test FAIL: Vue class alias should normalize');
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

  const maybeRefOk = `
export function useSample(source: Editor | null): SampleResult;
export interface SampleResult { readonly value: string; }
export interface Editor {}
`;
  const maybeRefVue = `
export function useSample(source: MaybeRefOrGetter<Editor | null>): SampleResult;
export interface SampleResult { readonly value: string; }
export interface Editor {}
`;
  ({ issues } = runComposableParityCheck({ reactSnap: maybeRefOk, vueSnap: maybeRefVue }));
  if (issues.length !== 0) {
    console.error('Self-test FAIL: MaybeRefOrGetter param should normalize');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  // A rest parameter of wrapped values. `MaybeRefOrGetter<T>[]` unwraps to `T[]` when `T`
  // is a bare identifier; parenthesizing it unconditionally reported drift against an
  // identical React signature.
  const restOk = `
export function useSample(...origins: readonly FontsInput[]): FontResolver;
export type FontsInput = string;
export interface FontResolver {}
`;
  const restVue = `
export function useSample(...origins: readonly MaybeRefOrGetter<FontsInput>[]): FontResolver;
export type FontsInput = string;
export interface FontResolver {}
`;
  ({ issues } = runComposableParityCheck({ reactSnap: restOk, vueSnap: restVue }));
  if (issues.length !== 0) {
    console.error('Self-test FAIL: wrapped rest parameter should normalize');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  // …and anything that is not a plain type reference still needs its parentheses, or
  // `A | B[]` would compare equal to `(A | B)[]`. A union, a conditional and a `keyof`
  // all bind looser than `[]`; a generic reference does not.
  for (const [inner, parenthesized] of [
    ['A | B', '(A | B)'],
    ['A & B', '(A & B)'],
    ['keyof A', '(keyof A)'],
    ['A extends B ? C : D', '(A extends B ? C : D)'],
    ['Map<A, B>', 'Map<A, B>'],
  ]) {
    const reactSnap = `
export function useSample(...origins: readonly ${parenthesized}[]): FontResolver;
export interface FontResolver {}
`;
    const vueSnap = `
export function useSample(...origins: readonly MaybeRefOrGetter<${inner}>[]): FontResolver;
export interface FontResolver {}
`;
    ({ issues } = runComposableParityCheck({ reactSnap, vueSnap }));
    if (issues.length !== 0) {
      console.error(`Self-test FAIL: wrapped rest parameter '${inner}' should normalize`);
      for (const i of issues) console.error(`  - ${i}`);
      process.exit(1);
    }
  }

  const functionReturn = `
export function useToolbarLabel(): (key: string) => string;
`;
  const functionReturnDrift = `
export function useToolbarLabel(): (key: number) => string;
`;
  ({ issues } = runComposableParityCheck({
    reactSnap: functionReturn,
    vueSnap: functionReturnDrift,
  }));
  if (!issues.some((i) => i.includes("FUNCTION 'useToolbarLabel'"))) {
    console.error('Self-test FAIL: expected function return signature mismatch');
    process.exit(1);
  }

  const functionMember = `
export interface SampleResult {
    beginEdit: () => void;
    onReady?: (editor: Editor) => void;
}
export interface Editor {}
`;
  const functionMemberDrift = functionMember
    .replace('beginEdit: () => void', 'beginEdit: () => number')
    .replace('(editor: Editor) => void', '(editor: string) => void');
  ({ issues } = runComposableParityCheck({
    reactSnap: functionMember,
    vueSnap: functionMemberDrift,
  }));
  if (issues.filter((i) => i.includes('type mismatch')).length !== 2) {
    console.error('Self-test FAIL: expected function-property type mismatches');
    process.exit(1);
  }

  const aliasOk = `
export type SharedAlias = string;
export interface SampleResult { readonly value: SharedAlias; }
`;
  const aliasDrift = aliasOk.replace('string', 'number');
  ({ issues } = runComposableParityCheck({ reactSnap: aliasOk, vueSnap: aliasDrift }));
  if (!issues.some((i) => i.includes("TYPE ALIAS 'SharedAlias'"))) {
    console.error('Self-test FAIL: expected type alias body mismatch');
    process.exit(1);
  }

  const slotFormAliases = {
    DocxEditorChildren: { react: 'ReactNode', vue: 'VNode' },
  };
  const slotFormReact = `
export type DocxEditorChildren = ReactNode;
export interface SampleResult { readonly value: string; }
`;
  const slotFormVue = `
export type DocxEditorChildren = VNode;
export interface SampleResult { readonly value: string; }
`;
  ({ issues } = runComposableParityCheck({
    reactSnap: slotFormReact,
    vueSnap: slotFormVue,
    slotFormAliases,
  }));
  if (issues.length !== 0) {
    console.error('Self-test FAIL: framework slot-form alias should reconcile');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  const slotFormWrongVue = slotFormVue.replace('VNode', 'string');
  ({ issues } = runComposableParityCheck({
    reactSnap: slotFormReact,
    vueSnap: slotFormWrongVue,
    slotFormAliases,
  }));
  if (!issues.some((i) => i.includes("TYPE ALIAS 'DocxEditorChildren'"))) {
    console.error('Self-test FAIL: unrelated slot-form alias body should fail');
    process.exit(1);
  }

  const dispatchReact = `
export function useCounter(setRevision: Dispatch<SetStateAction<number>>): void;

export interface SampleResult {
    readonly value: string;
}
`;
  const dispatchVue = `
export function useCounter(setRevision: (value: number) => void): void;

export interface SampleResult {
    readonly value: string;
}
`;
  ({ issues } = runComposableParityCheck({ reactSnap: dispatchReact, vueSnap: dispatchVue }));
  if (!issues.some((i) => i.includes('useCounter') || i.includes('param signature'))) {
    console.error('Self-test FAIL: Dispatch vs setter must not normalize');
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

  console.log('Composable parity self-test passed.');
}

main();
