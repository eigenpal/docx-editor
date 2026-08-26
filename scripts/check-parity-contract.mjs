#!/usr/bin/env node
// Cross-adapter parity check between @docx-editor.dev/react and
// @docx-editor.dev/vue. Reads each adapter's API Extractor snapshot
// (`docs/api/<adapter-slug>/index.api.md`), extracts the `DocxEditorProps`
// and `DocxEditorRef` field names, and applies `scripts/parity/parity.contract.json`.
//
// The contract's `pro` section extends the same bucket semantics to the pro
// package's paired entries (`docs/api/docx-editor-pro/{react,vue}.api.md`):
// top-level export names, the DocxEditorReview compound part names, and the
// extends-resolved member names of the pinned `memberCheckedInterfaces` list.
//
// Fails non-zero on any drift the contract does not acknowledge:
// - A prop/method exists in one adapter but the contract didn't classify it.
// - A "paired" entry is missing on one side.
// - A "deferredInVue" entry has shipped in Vue (contract should move it to paired).
// - A "vueExclusive" entry crept into React (contract should move it).
//
// The contract is the source of truth. Adding a prop to either adapter
// without updating the contract is the failure mode this check exists for.
//
// Dependency: this script reads committed snapshots. It does NOT check that
// the snapshots are up-to-date with the adapter source — that's `api:check`'s
// job. Run order locally and in CI: `bun run api:extract` (or `api:check`)
// first, then this script.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSnapshotText } from './lib/api-snapshot-parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const REACT_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-react/index.api.md');
const VUE_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-vue/index.api.md');
const PRO_REACT_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-pro/react.api.md');
const PRO_VUE_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-pro/vue.api.md');
// The WebRTC hook ships from its own subpath so a review-only bundle skips the network
// provider. That puts it outside the `{react,vue}.api.md` pair above, so without its own
// gate a React-only hook member would drift past every parity check in the repo.
const PRO_REACT_WEBRTC_SNAPSHOT = path.join(
  repoRoot,
  'docs/api/docx-editor-pro/react-webrtc.api.md'
);
const PRO_VUE_WEBRTC_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-pro/vue-webrtc.api.md');
const CONTRACT_PATH = path.join(repoRoot, 'scripts/parity/parity.contract.json');
const VUE_DOCX_EDITOR_SOURCE = path.join(repoRoot, 'packages/vue/src/components/DocxEditor.tsx');

function extractVueDocxEditorForms(source) {
  const start = source.indexOf('const DocxEditorImpl = defineComponent({');
  const end = source.indexOf('/** @public */\nexport const DocxEditor', start);
  if (start === -1 || end === -1) return null;
  const block = source.slice(start, end);
  const emitsBlock = /emits:\s*\[([\s\S]*?)\]\s*as const/.exec(block)?.[1] ?? '';
  const emits = new Set([...emitsBlock.matchAll(/['"](\w+)['"]/g)].map((match) => match[1]));
  const slots = new Set([...block.matchAll(/\bslots\.(\w+)/g)].map((match) => match[1]));
  return { emits, slots };
}

/**
 * Normalize one member line for cross-adapter TYPE comparison: drop `readonly`
 * (an adapter-idiom difference, not an API difference) and collapse whitespace.
 * The name stays in the string — paired members share it by definition.
 */
function normalizeMemberLine(line) {
  return line
    .trim()
    .replace(/^readonly\s+/, '')
    .replace(/\s+/g, ' ');
}

/**
 * Pull members out of an `export interface FooProps { ... }` block as a
 * Map(name → normalized member line). Lines beginning with whitespace +
 * identifier + optional `?` + colon are field declarations; nested object
 * lines (deeper indent) are ignored.
 */
function scanInterfaceMembers(snapshotText, interfaceName) {
  const lines = snapshotText.split('\n');
  const startMarker = `export interface ${interfaceName} `;
  const startIdx = lines.findIndex(
    (l) => l.startsWith(startMarker) || l.startsWith(`export interface ${interfaceName}{`)
  );
  if (startIdx === -1) return null;

  // Track brace depth from the interface declaration line forward. The
  // opening `{` on that line bumps depth to 1; once depth returns to 0 the
  // interface is closed. Inside the block, only lines at exactly 4-space
  // indent (top-level field declarations) are picked up — nested object
  // literals at deeper indent are skipped by the regex.
  const members = new Map();
  let depth = 0;
  let inBlockComment = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.trimStart().startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && i > startIdx) break;
    // Accept BOTH member forms: `name: Type;` and a method signature
    // `name(): Type;`. Matching only the former made method-style members such
    // as `getEditor(): Editor | null` invisible to the gate, so a ref method
    // could be added or dropped on one adapter without the check noticing.
    const match = /^ {4}(?:readonly\s+)?(\w+)\??[(:]/.exec(line);
    if (match) members.set(match[1], normalizeMemberLine(line));
  }
  return members;
}

function extractInterfaceFields(snapshotText, interfaceName) {
  const members = scanInterfaceMembers(snapshotText, interfaceName);
  return members ? new Set(members.keys()) : null;
}

/**
 * Extract method/prop names from an `export interface DocxEditorRef { ... }` block.
 * Same field grammar as extractInterfaceFields — methods are just field
 * declarations whose type is a function signature.
 */
function extractRefMembers(snapshotText) {
  return extractInterfaceFields(snapshotText, 'DocxEditorRef');
}

/**
 * Vue's DocxEditorRef has taken two shapes.
 *
 * Legacy: a type alias intersecting a shared base
 * (`type DocxEditorRef = EditorRefLike & { ... }`), whose members live in the
 * intersected object literal rather than a named interface.
 *
 * Greenfield: a plain `interface DocxEditorRef`, declaring every member
 * directly — the same shape React uses. That is BETTER parity, not worse, so
 * the checker accepts it instead of failing to find the alias.
 */
function scanVueRefMembers(snapshotText) {
  const lines = snapshotText.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith('export type DocxEditorRef '));
  if (startIdx === -1) {
    // No alias — fall back to the interface form and report null only if that
    // is missing too, so a genuinely absent DocxEditorRef still fails loudly.
    const asInterface = scanInterfaceMembers(snapshotText, 'DocxEditorRef');
    return asInterface && asInterface.size > 0 ? asInterface : null;
  }
  const members = new Map();
  let inBlock = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('{')) inBlock = true;
    if (inBlock && line.startsWith('};')) break;
    const match = /^ {4}(\w+)[\?\(:]/.exec(line);
    if (match) members.set(match[1], normalizeMemberLine(line));
  }
  return members;
}

function extractVueRefMembers(snapshotText) {
  const members = scanVueRefMembers(snapshotText);
  return members ? new Set(members.keys()) : null;
}

// ── Pro entry parity (docs/api/docx-editor-pro/{react,vue}.api.md) ──────────
// The pro package publishes one React and one Vue entry from the same package.
// The contract's `pro` section classifies:
//  - `exports`: every top-level export name of each snapshot
//  - `reviewParts`: the DocxEditorReview compound part names
//  - `memberCheckedInterfaces`: the pinned list of interfaces whose member
//    names compare extends-resolved across both entries. Exact-match
//    staleness: a listed interface that stops being comparable fails as
//    stale, and an interface comparable on both sides that is not listed
//    fails as unclassified — the set can never shrink silently.
//  - `interfaceMemberExceptions`: acknowledged per-member divergence on
//    member-checked interfaces

/** Top-level export names of an API Extractor snapshot. */
function extractTopLevelExportNames(snapshotText) {
  const names = new Set();
  for (const line of snapshotText.split('\n')) {
    const match =
      /^export (?:declare )?(?:abstract )?(?:function|const|let|var|interface|type|namespace|class|enum) (\w+)/.exec(
        line
      );
    if (match) names.add(match[1]);
  }
  return names;
}

/**
 * Vue's DocxEditorReview snapshot is one `export const DocxEditorReview: { ... };`
 * whose trailing intersection enumerates each compound part as a
 * `PartName: <component type>` member. The member match is type-agnostic
 * (DefineComponent, FunctionalComponent, anything): a part emitted under a new
 * component type must still surface, so the buckets classify it instead of the
 * scraper silently dropping it.
 *
 * Membership is start-of-line brace depth 1 plus either a PascalCase name
 * (parts are components and Object.assign keys keep their exported casing) or
 * a declared type that references a component form (`DefineComponent<`,
 * `FunctionalComponent<`, `Component<`) — so a camelCase key of component
 * type still surfaces as a part instead of being silently ignored. That
 * excludes the camelCase prop-literal keys inside the intersection's generic
 * segments (which also reach depth 1, because API Extractor restarts
 * indentation per intersection term — their value types are plain) and Vue's
 * underscore-prefixed `__isFragment`-style internal markers. A false match
 * fails loudly as unclassified; it cannot pass vacuously.
 */
function extractVueReviewParts(snapshotText) {
  const lines = snapshotText.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith('export const DocxEditorReview'));
  if (startIdx === -1) return null;
  const parts = new Set();
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (i > startIdx && (line.startsWith('};') || line.startsWith('export '))) break;
    if (i > startIdx && depth === 1) {
      const match = /^ {4}(\w+)\??: (\S.*)$/.exec(line);
      if (match && !match[1].startsWith('__')) {
        const [, name, type] = match;
        const componentTyped = /\b(?:DefineComponent|FunctionalComponent|Component)</.test(type);
        if (/^[A-Z]/.test(name) || componentTyped) parts.add(name);
      }
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }
  return parts;
}

/**
 * Map of member-comparable declarations for a snapshot:
 * name → { form: 'interface' | 'aliasObject', extendsClause: string | null }.
 * An interface API Extractor re-emits as an object-literal type alias
 * (`export type X = { ... };`) stays comparable instead of exiting the set.
 */
function extractInterfaceDecls(snapshotText) {
  const decls = new Map();
  for (const line of snapshotText.split('\n')) {
    const iface = /^export interface (\w+)(?: extends (.+?))? \{/.exec(line);
    if (iface) {
      decls.set(iface[1], { form: 'interface', extendsClause: iface[2] ?? null });
      continue;
    }
    const alias = /^export type (\w+) = \{/.exec(line);
    if (alias && !decls.has(alias[1])) {
      decls.set(alias[1], { form: 'aliasObject', extendsClause: null });
    }
  }
  return decls;
}

/** Field names of an `export type X = { ... };` object-literal alias block. */
function extractAliasObjectFields(snapshotText, name) {
  const lines = snapshotText.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(`export type ${name} = {`));
  if (startIdx === -1) return null;
  const fields = new Set();
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth <= 0 && i > startIdx) break;
    const match = /^ {4}(?:readonly\s+)?(\w+)\??[(:]/.exec(line);
    if (match) fields.add(match[1]);
  }
  return fields;
}

/** Declared field names of a comparable declaration, whatever its form. */
function declaredProFields(snapshotText, decls, name) {
  if (decls.get(name)?.form === 'aliasObject') {
    return extractAliasObjectFields(snapshotText, name) ?? new Set();
  }
  return new Set(extractInterfaceFields(snapshotText, name) ?? []);
}

/** Parse `Base` / `Omit<Base, 'a' | 'b'>` terms from an extends clause. */
function parseExtendsClause(clause) {
  const bases = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= clause.length; i++) {
    const c = clause[i];
    if (c === '<' || c === '(') depth++;
    else if (c === '>' || c === ')') depth--;
    if ((c === ',' && depth === 0) || i === clause.length) {
      const part = clause.slice(start, i).trim();
      start = i + 1;
      if (!part) continue;
      const omit = /^Omit<(\w+),\s*(.+)>$/.exec(part);
      if (omit) {
        const omitted = new Set([...omit[2].matchAll(/'([^']+)'/g)].map((m) => m[1]));
        bases.push({ base: omit[1], omitted });
      } else if (/^\w+$/.test(part)) {
        bases.push({ base: part, omitted: new Set() });
      }
      // Anything else (generic bases from other packages) cannot be resolved
      // from the snapshot alone and is skipped.
    }
  }
  return bases;
}

/** Member names of an interface with same-snapshot `extends` chains folded in. */
function effectiveInterfaceFields(snapshotText, decls, name, seen = new Set()) {
  if (seen.has(name)) return new Set();
  seen.add(name);
  const fields = declaredProFields(snapshotText, decls, name);
  const extendsClause = decls.get(name)?.extendsClause;
  if (!extendsClause) return fields;
  for (const { base, omitted } of parseExtendsClause(extendsClause)) {
    if (!decls.has(base)) continue;
    for (const field of effectiveInterfaceFields(snapshotText, decls, base, seen)) {
      if (!omitted.has(field)) fields.add(field);
    }
  }
  return fields;
}

/** Apply the paired / deferredInVue / vueExclusive buckets to one name set pair. */
function applyProBuckets(kind, section, reactSet, vueSet, issues) {
  const paired = section.paired;
  const deferred = Object.keys(section.deferredInVue);
  const vueOnly = Object.keys(section.vueExclusive);
  for (const k of paired) {
    if (!reactSet.has(k)) issues.push(`${kind} paired '${k}' missing from React`);
    if (!vueSet.has(k)) issues.push(`${kind} paired '${k}' missing from Vue`);
  }
  for (const k of deferred) {
    if (!reactSet.has(k))
      issues.push(`${kind} deferred '${k}' missing from React (contract stale)`);
    if (vueSet.has(k))
      issues.push(`${kind} '${k}' has shipped in Vue — move from deferredInVue to paired`);
  }
  for (const k of vueOnly) {
    if (!vueSet.has(k))
      issues.push(`${kind} vueExclusive '${k}' missing from Vue (contract stale)`);
    if (reactSet.has(k))
      issues.push(`${kind} '${k}' has shipped in React — move from vueExclusive to paired`);
  }
  for (const k of reactSet) {
    if (!paired.includes(k) && !deferred.includes(k) && !vueOnly.includes(k)) {
      issues.push(`${kind} '${k}' in React is not declared in the parity contract`);
    }
  }
  for (const k of vueSet) {
    if (!paired.includes(k) && !deferred.includes(k) && !vueOnly.includes(k)) {
      issues.push(`${kind} '${k}' in Vue is not declared in the parity contract`);
    }
  }
}

const PRO_BUCKET_SCHEMA = { paired: 'array', deferredInVue: 'object', vueExclusive: 'object' };

function validateProShape(pro) {
  const errors = [];
  if (!pro || typeof pro !== 'object') {
    errors.push('Missing or invalid top-level key: pro');
    return errors;
  }
  for (const sub of ['exports', 'reviewParts', 'webrtcExports']) {
    const section = pro[sub];
    if (!section || typeof section !== 'object') {
      errors.push(`contract.pro.${sub} is required`);
      continue;
    }
    const seen = new Set();
    for (const [bucket, type] of Object.entries(PRO_BUCKET_SCHEMA)) {
      const value = section[bucket];
      if (value === undefined) {
        errors.push(`contract.pro.${sub}.${bucket} is required`);
        continue;
      }
      const ok =
        type === 'array'
          ? Array.isArray(value)
          : typeof value === 'object' && !Array.isArray(value);
      if (!ok) {
        errors.push(
          `contract.pro.${sub}.${bucket} must be ${type === 'array' ? 'an array' : 'an object'}`
        );
        continue;
      }
      for (const k of Array.isArray(value) ? value : Object.keys(value)) {
        if (seen.has(k))
          errors.push(
            `contract.pro.${sub}: '${k}' appears in multiple buckets — must be in exactly one`
          );
        seen.add(k);
      }
    }
  }
  if (!Array.isArray(pro.memberCheckedInterfaces)) {
    errors.push('contract.pro.memberCheckedInterfaces must be an array');
  } else {
    const seen = new Set();
    for (const name of pro.memberCheckedInterfaces) {
      if (seen.has(name)) errors.push(`contract.pro.memberCheckedInterfaces lists '${name}' twice`);
      seen.add(name);
    }
  }
  const exceptions = pro.interfaceMemberExceptions ?? {};
  if (typeof exceptions !== 'object' || Array.isArray(exceptions)) {
    errors.push('contract.pro.interfaceMemberExceptions must be an object');
    return errors;
  }
  for (const [name, entry] of Object.entries(exceptions)) {
    if (!entry || typeof entry !== 'object' || typeof entry.reason !== 'string') {
      errors.push(`contract.pro.interfaceMemberExceptions.${name} needs a string 'reason'`);
      continue;
    }
    for (const side of ['reactOnly', 'vueOnly']) {
      if (entry[side] !== undefined && !Array.isArray(entry[side])) {
        errors.push(`contract.pro.interfaceMemberExceptions.${name}.${side} must be an array`);
      }
    }
    if (!entry.reactOnly?.length && !entry.vueOnly?.length) {
      errors.push(`contract.pro.interfaceMemberExceptions.${name} declares no members — remove it`);
    }
  }
  return errors;
}

/**
 * Twin gate for the `pro/{react,vue}/webrtc` subpath pair. Same bucket semantics as the
 * main pro entries, exports only: the hook publishes no compound parts and no interface
 * whose members are pinned.
 */
function checkProWebrtcParity(contract, reactSnapshot, vueSnapshot, issues) {
  const reactExports = extractTopLevelExportNames(reactSnapshot);
  const vueExports = extractTopLevelExportNames(vueSnapshot);
  // Freshness oracle: the hook plus its five types. A parse regression that emptied these
  // sets would otherwise let the gate pass while comparing nothing.
  const MIN_WEBRTC_EXPORTS = 5;
  if (reactExports.size < MIN_WEBRTC_EXPORTS || vueExports.size < MIN_WEBRTC_EXPORTS) {
    console.error(
      `Pro WebRTC parity gate misconfigured: expected at least ${MIN_WEBRTC_EXPORTS} exports per snapshot, got React ${reactExports.size} / Vue ${vueExports.size}.`
    );
    process.exit(1);
  }
  applyProBuckets(
    'PRO WEBRTC EXPORT',
    contract.pro.webrtcExports,
    reactExports,
    vueExports,
    issues
  );

  // Name parity alone would pass a React-only field added to a shared interface, which is the
  // likelier drift than a whole missing export. Every interface both entries declare is
  // compared by member name, derived rather than listed so this cannot go stale.
  const reactDecls = extractInterfaceDecls(reactSnapshot);
  const vueDecls = extractInterfaceDecls(vueSnapshot);
  let memberChecks = 0;
  let comparedInterfaces = 0;
  for (const name of [...reactDecls.keys()].sort()) {
    if (!vueDecls.has(name)) continue;
    const reactFields = effectiveInterfaceFields(reactSnapshot, reactDecls, name);
    const vueFields = effectiveInterfaceFields(vueSnapshot, vueDecls, name);
    if (reactFields.size === 0 || vueFields.size === 0) {
      const sides = [reactFields.size === 0 && 'React', vueFields.size === 0 && 'Vue']
        .filter(Boolean)
        .join(' and ');
      issues.push(
        `PRO WEBRTC INTERFACE '${name}' resolved to zero members in the ${sides} snapshot — declaration form is unparseable`
      );
      continue;
    }
    comparedInterfaces++;
    for (const k of reactFields) {
      memberChecks++;
      if (!vueFields.has(k)) {
        issues.push(`PRO WEBRTC INTERFACE '${name}': member '${k}' missing from Vue`);
      }
    }
    for (const k of vueFields) {
      if (!reactFields.has(k)) {
        issues.push(`PRO WEBRTC INTERFACE '${name}': member '${k}' missing from React`);
      }
    }
  }
  // Vacuity guard: ConnectOptions, Options, and Return must stay comparable.
  // The test room handle is internal and is not a public webrtc export.
  if (comparedInterfaces < 3) {
    console.error(
      `Pro WebRTC parity gate misconfigured: expected at least 3 comparable shared interfaces, compared ${comparedInterfaces}.`
    );
    process.exit(1);
  }
  return {
    reactExports: reactExports.size,
    vueExports: vueExports.size,
    comparedInterfaces,
    memberChecks,
  };
}

function checkProParity(contract, reactSnapshot, vueSnapshot, issues) {
  const reactExports = extractTopLevelExportNames(reactSnapshot);
  const vueExports = extractTopLevelExportNames(vueSnapshot);
  const reactParts = extractInterfaceFields(reactSnapshot, 'DocxEditorReviewNamespace');
  const vueParts = extractVueReviewParts(vueSnapshot);

  // Freshness oracle: a parse regression must fail loudly, never pass vacuously.
  const MIN_EXPORTS = 20;
  const MIN_PARTS = 15;
  if (reactExports.size < MIN_EXPORTS || vueExports.size < MIN_EXPORTS) {
    console.error(
      `Pro parity gate misconfigured: expected at least ${MIN_EXPORTS} exports per snapshot, got React ${reactExports.size} / Vue ${vueExports.size}.`
    );
    process.exit(1);
  }
  if (!reactParts || reactParts.size < MIN_PARTS) {
    console.error(
      `Pro parity gate misconfigured: could not parse DocxEditorReviewNamespace parts from ${PRO_REACT_SNAPSHOT} (got ${reactParts?.size ?? 0}).`
    );
    process.exit(1);
  }
  if (!vueParts || vueParts.size < MIN_PARTS) {
    console.error(
      `Pro parity gate misconfigured: could not parse DocxEditorReview parts from ${PRO_VUE_SNAPSHOT} (got ${vueParts?.size ?? 0}).`
    );
    process.exit(1);
  }

  applyProBuckets('PRO EXPORT', contract.pro.exports, reactExports, vueExports, issues);
  applyProBuckets('PRO REVIEW PART', contract.pro.reviewParts, reactParts, vueParts, issues);

  // Member-name parity for the pinned interface list. The list is exact-match
  // stale-checked in both directions, so the compared set can never shrink
  // silently: a listed name that stops being comparable (renamed, dropped, or
  // re-emitted in a form the parser cannot read) fails as stale, and a new
  // interface comparable on both sides fails as unclassified.
  const reactDecls = extractInterfaceDecls(reactSnapshot);
  const vueDecls = extractInterfaceDecls(vueSnapshot);
  const memberChecked = contract.pro.memberCheckedInterfaces;
  const exceptions = contract.pro.interfaceMemberExceptions ?? {};

  for (const name of memberChecked) {
    if (!reactDecls.has(name)) {
      issues.push(
        `PRO INTERFACE memberChecked '${name}' is no longer comparable in the React snapshot (contract stale, or the declaration form changed)`
      );
    }
    if (!vueDecls.has(name)) {
      issues.push(
        `PRO INTERFACE memberChecked '${name}' is no longer comparable in the Vue snapshot (contract stale, or the declaration form changed)`
      );
    }
  }
  for (const name of [...reactDecls.keys()].sort()) {
    if (vueDecls.has(name) && !memberChecked.includes(name)) {
      issues.push(
        `PRO INTERFACE '${name}' is exported by both entries but not listed in memberCheckedInterfaces`
      );
    }
  }

  let memberChecks = 0;
  for (const name of memberChecked) {
    if (!reactDecls.has(name) || !vueDecls.has(name)) continue; // reported stale above
    const reactFields = effectiveInterfaceFields(reactSnapshot, reactDecls, name);
    const vueFields = effectiveInterfaceFields(vueSnapshot, vueDecls, name);
    // A listed interface must resolve to at least one member on each side.
    // Every current entry does; an empty set means the emission changed to a
    // form the parser reads as a declaration but cannot extract fields from
    // (for example a single-line alias body), so the member comparison would
    // pass vacuously. Fail it as unparseable instead.
    if (reactFields.size === 0 || vueFields.size === 0) {
      const sides = [reactFields.size === 0 && 'React', vueFields.size === 0 && 'Vue']
        .filter(Boolean)
        .join(' and ');
      issues.push(
        `PRO INTERFACE memberChecked '${name}' resolved to zero members in the ${sides} snapshot — declaration form is unparseable (contract stale or emission changed)`
      );
      continue;
    }
    const exception = exceptions[name];
    const reactAllowed = new Set(exception?.reactOnly ?? []);
    const vueAllowed = new Set(exception?.vueOnly ?? []);
    for (const k of reactAllowed) {
      if (!reactFields.has(k) || vueFields.has(k)) {
        issues.push(
          `PRO INTERFACE '${name}': stale reactOnly exception '${k}' — remove it from the contract`
        );
      }
    }
    for (const k of vueAllowed) {
      if (!vueFields.has(k) || reactFields.has(k)) {
        issues.push(
          `PRO INTERFACE '${name}': stale vueOnly exception '${k}' — remove it from the contract`
        );
      }
    }
    for (const k of reactFields) {
      memberChecks++;
      if (!vueFields.has(k) && !reactAllowed.has(k)) {
        issues.push(`PRO INTERFACE '${name}': member '${k}' missing from Vue`);
      }
    }
    for (const k of vueFields) {
      if (!reactFields.has(k) && !vueAllowed.has(k)) {
        issues.push(`PRO INTERFACE '${name}': member '${k}' missing from React`);
      }
    }
  }
  for (const name of Object.keys(exceptions)) {
    if (!memberChecked.includes(name)) {
      issues.push(
        `PRO INTERFACE exception '${name}' does not match a member-checked interface — remove it`
      );
    }
  }

  return {
    reactExports: reactExports.size,
    vueExports: vueExports.size,
    reviewParts: reactParts.size,
    memberCheckedInterfaces: memberChecked.length,
    memberChecks,
  };
}

function diffSets(name, contractList, actualSet) {
  const missing = contractList.filter((k) => !actualSet.has(k));
  const extra = [...actualSet].filter((k) => !contractList.includes(k));
  return { name, missing, extra };
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (e instanceof SyntaxError) {
      console.error(`Malformed JSON in ${p}:`);
      console.error(`  ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

// Per-section schema. Each bucket maps to its expected JS type ('array' or
// 'object'). Buckets marked optional may be absent. Adding a new bucket to
// the contract format means adding one line here.
const SECTION_SCHEMA = {
  props: {
    paired: 'array',
    deferredInVue: 'object',
    reactCallbacksAsVueEmits: 'object',
    reactRenderPropsAsVueSlots: 'object',
    reactClassNameAsVueClass: 'object',
    vueExclusive: 'object',
  },
  ref: {
    paired: 'array',
    pairedViaInheritance: { type: 'object', optional: true },
    vueExclusive: 'object',
  },
};

function validateContractShape(contract) {
  const errors = [];
  for (const [top, buckets] of Object.entries(SECTION_SCHEMA)) {
    const section = contract[top];
    if (!section || typeof section !== 'object') {
      errors.push(`Missing or invalid top-level key: ${top}`);
      continue;
    }
    for (const [bucket, spec] of Object.entries(buckets)) {
      const type = typeof spec === 'string' ? spec : spec.type;
      const optional = typeof spec === 'object' && spec.optional === true;
      const value = section[bucket];
      if (value === undefined) {
        if (!optional) errors.push(`contract.${top}.${bucket} is required`);
        continue;
      }
      const ok =
        type === 'array'
          ? Array.isArray(value)
          : typeof value === 'object' && !Array.isArray(value);
      if (!ok)
        errors.push(
          `contract.${top}.${bucket} must be ${type === 'array' ? 'an array' : 'an object'}`
        );
    }
    // Within each section, every member must appear in exactly one bucket.
    const seen = new Set();
    const dupes = new Set();
    for (const bucket of Object.keys(buckets)) {
      const value = section[bucket];
      if (value === undefined) continue;
      const keys = Array.isArray(value) ? value : Object.keys(value);
      for (const k of keys) {
        if (seen.has(k)) dupes.add(k);
        seen.add(k);
      }
    }
    for (const k of dupes) {
      errors.push(`contract.${top}: '${k}' appears in multiple buckets — must be in exactly one`);
    }
  }
  return errors;
}

function main() {
  for (const f of [
    REACT_SNAPSHOT,
    VUE_SNAPSHOT,
    PRO_REACT_SNAPSHOT,
    PRO_VUE_SNAPSHOT,
    CONTRACT_PATH,
    VUE_DOCX_EDITOR_SOURCE,
  ]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing required file: ${f}`);
      console.error('Run `bun run api:extract` first.');
      process.exit(1);
    }
  }

  const reactSnapshot = normalizeSnapshotText(fs.readFileSync(REACT_SNAPSHOT, 'utf8'));
  const vueSnapshot = normalizeSnapshotText(fs.readFileSync(VUE_SNAPSHOT, 'utf8'));
  const vueForms = extractVueDocxEditorForms(fs.readFileSync(VUE_DOCX_EDITOR_SOURCE, 'utf8'));
  const contract = readJson(CONTRACT_PATH);

  const shapeErrors = [...validateContractShape(contract), ...validateProShape(contract.pro)];
  if (shapeErrors.length > 0) {
    console.error('Parity contract has structural errors:');
    for (const e of shapeErrors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const reactProps = extractInterfaceFields(reactSnapshot, 'DocxEditorProps');
  const vueProps = extractInterfaceFields(vueSnapshot, 'DocxEditorProps');
  const reactRef = extractRefMembers(reactSnapshot);
  const vueRef = extractVueRefMembers(vueSnapshot);

  if (!reactProps) {
    console.error('Could not locate DocxEditorProps in docs/api/docx-editor-react/index.api.md');
    process.exit(1);
  }
  if (!vueProps) {
    console.error('Could not locate DocxEditorProps in docs/api/docx-editor-vue/index.api.md');
    process.exit(1);
  }
  if (!reactRef) {
    console.error('Could not locate DocxEditorRef in docs/api/docx-editor-react/index.api.md');
    process.exit(1);
  }
  if (!vueRef) {
    console.error('Could not locate DocxEditorRef in docs/api/docx-editor-vue/index.api.md');
    process.exit(1);
  }

  const issues = [];
  if (!vueForms) issues.push('Could not locate the exported Vue DocxEditor implementation');

  // ── Props ────────────────────────────────────────────────────────────────
  const paired = contract.props.paired;
  const deferred = Object.keys(contract.props.deferredInVue);
  const callbackEmits = Object.keys(contract.props.reactCallbacksAsVueEmits ?? {});
  const renderSlots = Object.keys(contract.props.reactRenderPropsAsVueSlots ?? {});
  const classFallthrough = Object.keys(contract.props.reactClassNameAsVueClass ?? {});
  const vueOnly = Object.keys(contract.props.vueExclusive);
  const reactFormProps = [...callbackEmits, ...renderSlots, ...classFallthrough];

  const reactPropTypes = scanInterfaceMembers(reactSnapshot, 'DocxEditorProps');
  const vuePropTypes = scanInterfaceMembers(vueSnapshot, 'DocxEditorProps');
  for (const k of paired) {
    if (!reactProps.has(k)) issues.push(`PROP paired '${k}' missing from React`);
    if (!vueProps.has(k)) issues.push(`PROP paired '${k}' missing from Vue`);
    // Paired means the SAME member, not two members with one name: compare the
    // snapshot member text (normalized), so a type that drifts on one adapter fails.
    const reactType = reactPropTypes?.get(k);
    const vueType = vuePropTypes?.get(k);
    if (reactType !== undefined && vueType !== undefined && reactType !== vueType) {
      issues.push(`PROP paired '${k}' type drift — React: \`${reactType}\` Vue: \`${vueType}\``);
    }
  }
  for (const k of deferred) {
    if (!reactProps.has(k)) issues.push(`PROP deferred '${k}' missing from React (contract stale)`);
    if (vueProps.has(k))
      issues.push(`PROP '${k}' has shipped in Vue — move from deferredInVue to paired`);
  }
  for (const k of callbackEmits) {
    if (!reactProps.has(k)) issues.push(`PROP reactCallbacksAsVueEmits '${k}' missing from React`);
    if (vueProps.has(k)) issues.push(`PROP '${k}' must be a Vue emit, not a DocxEditorProps field`);
    const emitName = contract.props.reactCallbacksAsVueEmits[k];
    if (vueForms && !vueForms.emits.has(emitName)) {
      issues.push(`PROP '${k}' maps to missing Vue emit '${emitName}'`);
    }
  }
  if (vueForms) {
    const declaredEmits = new Set(Object.values(contract.props.reactCallbacksAsVueEmits ?? {}));
    for (const emitName of vueForms.emits) {
      if (!declaredEmits.has(emitName)) {
        issues.push(`Vue emit '${emitName}' is not declared in reactCallbacksAsVueEmits`);
      }
    }
  }
  for (const k of renderSlots) {
    if (!reactProps.has(k))
      issues.push(`PROP reactRenderPropsAsVueSlots '${k}' missing from React`);
    if (vueProps.has(k)) issues.push(`PROP '${k}' must be a Vue slot, not a DocxEditorProps field`);
    const slotName = contract.props.reactRenderPropsAsVueSlots[k];
    if (vueForms && !vueForms.slots.has(slotName)) {
      issues.push(`PROP '${k}' maps to missing Vue slot '${slotName}'`);
    }
  }
  if (vueForms) {
    const declaredSlots = new Set(Object.values(contract.props.reactRenderPropsAsVueSlots ?? {}));
    for (const slotName of vueForms.slots) {
      if (!declaredSlots.has(slotName)) {
        issues.push(`Vue slot '${slotName}' is not declared in reactRenderPropsAsVueSlots`);
      }
    }
  }
  for (const k of classFallthrough) {
    if (!reactProps.has(k)) issues.push(`PROP reactClassNameAsVueClass '${k}' missing from React`);
    if (vueProps.has(k))
      issues.push(
        `PROP '${k}' must fall through as Vue \`class\`, not appear under the React name`
      );
  }
  for (const k of vueOnly) {
    if (!vueProps.has(k)) issues.push(`PROP vueExclusive '${k}' missing from Vue (contract stale)`);
    if (reactProps.has(k))
      issues.push(`PROP '${k}' has shipped in React — move from vueExclusive to paired`);
  }
  for (const k of reactProps) {
    if (
      !paired.includes(k) &&
      !deferred.includes(k) &&
      !reactFormProps.includes(k) &&
      !vueOnly.includes(k)
    ) {
      issues.push(`PROP '${k}' in React is not declared in the parity contract`);
    }
  }
  for (const k of vueProps) {
    if (!paired.includes(k) && !deferred.includes(k) && !vueOnly.includes(k)) {
      issues.push(`PROP '${k}' in Vue is not declared in the parity contract`);
    }
  }

  // ── Ref ──────────────────────────────────────────────────────────────────
  // Ref uses three buckets:
  //  - paired: explicit on both DocxEditorRef declarations
  //  - pairedViaInheritance: explicit on React, inherited via EditorRefLike on Vue
  //    (so it MUST be absent from Vue's enumerated DocxEditorRef snapshot)
  //  - vueExclusive: explicit on Vue only
  const refPaired = contract.ref.paired;
  const refInherited = Object.keys(contract.ref.pairedViaInheritance || {});
  const refVueOnly = Object.keys(contract.ref.vueExclusive);

  const reactRefTypes = scanInterfaceMembers(reactSnapshot, 'DocxEditorRef');
  const vueRefTypes = scanVueRefMembers(vueSnapshot);
  for (const k of refPaired) {
    if (!reactRef.has(k)) issues.push(`REF paired '${k}' missing from React`);
    if (!vueRef.has(k)) issues.push(`REF paired '${k}' missing from Vue`);
    const reactType = reactRefTypes?.get(k);
    const vueType = vueRefTypes?.get(k);
    if (reactType !== undefined && vueType !== undefined && reactType !== vueType) {
      issues.push(`REF paired '${k}' type drift — React: \`${reactType}\` Vue: \`${vueType}\``);
    }
  }
  for (const k of refInherited) {
    if (!reactRef.has(k))
      issues.push(`REF pairedViaInheritance '${k}' missing from React (contract stale)`);
    if (vueRef.has(k))
      issues.push(
        `REF '${k}' is now explicit on Vue's DocxEditorRef — move from pairedViaInheritance to paired`
      );
  }
  for (const k of refVueOnly) {
    if (!vueRef.has(k)) issues.push(`REF vueExclusive '${k}' missing from Vue (contract stale)`);
    if (reactRef.has(k))
      issues.push(`REF '${k}' has shipped in React — move from vueExclusive to paired`);
  }
  for (const k of reactRef) {
    if (!refPaired.includes(k) && !refInherited.includes(k) && !refVueOnly.includes(k)) {
      issues.push(`REF '${k}' in React is not declared in the parity contract`);
    }
  }
  for (const k of vueRef) {
    if (!refPaired.includes(k) && !refVueOnly.includes(k)) {
      // pairedViaInheritance members must NOT appear explicitly on Vue's snapshot
      // (caught above). Any explicit Vue ref member must be either paired or
      // vueExclusive.
      issues.push(`REF '${k}' in Vue is not declared in the parity contract`);
    }
  }

  // ── Pro entries ──────────────────────────────────────────────────────────
  const proReactSnapshot = normalizeSnapshotText(fs.readFileSync(PRO_REACT_SNAPSHOT, 'utf8'));
  const proVueSnapshot = normalizeSnapshotText(fs.readFileSync(PRO_VUE_SNAPSHOT, 'utf8'));
  const proStats = checkProParity(contract, proReactSnapshot, proVueSnapshot, issues);
  const webrtcStats = checkProWebrtcParity(
    contract,
    normalizeSnapshotText(fs.readFileSync(PRO_REACT_WEBRTC_SNAPSHOT, 'utf8')),
    normalizeSnapshotText(fs.readFileSync(PRO_VUE_WEBRTC_SNAPSHOT, 'utf8')),
    issues
  );

  // ── Report ───────────────────────────────────────────────────────────────
  const reactPropsCount = reactProps.size;
  const vuePropsCount = vueProps.size;
  const reactRefCount = reactRef.size;
  const vueRefCount = vueRef.size;
  console.log(`Parity contract: scripts/parity/parity.contract.json (v${contract.version})`);
  console.log(`  React DocxEditorProps: ${reactPropsCount} fields`);
  console.log(`  Vue   DocxEditorProps: ${vuePropsCount} fields`);
  console.log(`  React DocxEditorRef:   ${reactRefCount} members`);
  console.log(`  Vue   DocxEditorRef:   ${vueRefCount} members`);
  console.log(`  Paired props:          ${paired.length}`);
  console.log(`  Deferred in Vue props: ${deferred.length}`);
  console.log(`  React callbacks as Vue emits: ${callbackEmits.length}`);
  console.log(`  React render props as Vue slots: ${renderSlots.length}`);
  console.log(`  React className fallthrough: ${classFallthrough.length}`);
  console.log(`  Vue-exclusive props:   ${vueOnly.length}`);
  console.log(`  Paired ref members:    ${refPaired.length}`);
  console.log(`  Inherited via EditorRefLike: ${refInherited.length}`);
  console.log(`  Vue-exclusive refs:    ${refVueOnly.length}`);
  console.log(
    `  Pro exports:           React ${proStats.reactExports} / Vue ${proStats.vueExports}`
  );
  console.log(
    `  Pro webrtc exports:    React ${webrtcStats.reactExports} / Vue ${webrtcStats.vueExports}`
  );
  console.log(
    `  Pro webrtc interfaces: ${webrtcStats.comparedInterfaces} (${webrtcStats.memberChecks} member checks)`
  );
  console.log(`  Pro review parts:      ${proStats.reviewParts}`);
  console.log(
    `  Pro member-checked interfaces: ${proStats.memberCheckedInterfaces} (${proStats.memberChecks} member checks)`
  );

  if (issues.length > 0) {
    console.error(`\nParity drift: ${issues.length} issue${issues.length === 1 ? '' : 's'}`);
    for (const issue of issues) console.error(`  - ${issue}`);
    console.error(`\nFix: update scripts/parity/parity.contract.json to acknowledge the change,`);
    console.error(`then commit the contract alongside the adapter change.`);
    process.exit(1);
  }

  console.log(`\nParity check passed.`);
}

main();
