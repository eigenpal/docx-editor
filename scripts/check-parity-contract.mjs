#!/usr/bin/env node
// Cross-adapter parity check between @eigenpal/docx-editor-react and
// @eigenpal/docx-editor-vue. Reads each adapter's API Extractor snapshot
// (`docs/api/<adapter-slug>/index.api.md`), extracts the `DocxEditorProps`
// and `DocxEditorRef` field names, and applies `scripts/parity/parity.contract.json`.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const REACT_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-react/index.api.md');
const VUE_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-vue/index.api.md');
const CONTRACT_PATH = path.join(repoRoot, 'scripts/parity/parity.contract.json');

/**
 * Pull field names out of an `export interface FooProps { ... }` block.
 * Lines beginning with whitespace + identifier + optional `?` + colon
 * are field declarations; nested object lines (deeper indent) are ignored.
 */
function extractInterfaceFields(snapshotText, interfaceName) {
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
  const fields = new Set();
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && i > startIdx) break;
    const match = /^ {4}(\w+)\??:/.exec(line);
    if (match) fields.add(match[1]);
  }
  return fields;
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
 * Vue's DocxEditorRef is a type alias (`type DocxEditorRef = EditorRefLike & { ... }`).
 * The members live inside the intersected object literal, not a named interface.
 */
function extractVueRefMembers(snapshotText) {
  const lines = snapshotText.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith('export type DocxEditorRef '));
  if (startIdx === -1) return null;
  const fields = new Set();
  let inBlock = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('{')) inBlock = true;
    if (inBlock && line.startsWith('};')) break;
    const match = /^ {4}(\w+)[\?\(:]/.exec(line);
    if (match) fields.add(match[1]);
  }
  return fields;
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
    vueExclusive: 'object',
  },
  ref: {
    paired: 'array',
    pairedViaInheritance: { type: 'object', optional: true },
    deferredInVue: { type: 'object', optional: true },
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
      const ok = type === 'array' ? Array.isArray(value) : typeof value === 'object' && !Array.isArray(value);
      if (!ok) errors.push(`contract.${top}.${bucket} must be ${type === 'array' ? 'an array' : 'an object'}`);
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
  for (const f of [REACT_SNAPSHOT, VUE_SNAPSHOT, CONTRACT_PATH]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing required file: ${f}`);
      console.error('Run `bun run api:extract` first.');
      process.exit(1);
    }
  }

  const reactSnapshot = fs.readFileSync(REACT_SNAPSHOT, 'utf8');
  const vueSnapshot = fs.readFileSync(VUE_SNAPSHOT, 'utf8');
  const contract = readJson(CONTRACT_PATH);

  const shapeErrors = validateContractShape(contract);
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

  // ── Props ────────────────────────────────────────────────────────────────
  const paired = contract.props.paired;
  const deferred = Object.keys(contract.props.deferredInVue);
  const vueOnly = Object.keys(contract.props.vueExclusive);

  // Paired must exist on both sides.
  for (const k of paired) {
    if (!reactProps.has(k)) issues.push(`PROP paired '${k}' missing from React`);
    if (!vueProps.has(k)) issues.push(`PROP paired '${k}' missing from Vue`);
  }
  // Deferred must exist on React, must NOT exist on Vue (else contract is stale).
  for (const k of deferred) {
    if (!reactProps.has(k)) issues.push(`PROP deferred '${k}' missing from React (contract stale)`);
    if (vueProps.has(k))
      issues.push(`PROP '${k}' has shipped in Vue — move from deferredInVue to paired`);
  }
  // Vue-exclusive must exist on Vue, must NOT exist on React.
  for (const k of vueOnly) {
    if (!vueProps.has(k)) issues.push(`PROP vueExclusive '${k}' missing from Vue (contract stale)`);
    if (reactProps.has(k))
      issues.push(`PROP '${k}' has shipped in React — move from vueExclusive to paired`);
  }
  // Any React prop not in contract = drift.
  for (const k of reactProps) {
    if (!paired.includes(k) && !deferred.includes(k) && !vueOnly.includes(k)) {
      issues.push(`PROP '${k}' in React is not declared in the parity contract`);
    }
  }
  // Any Vue prop not in contract = drift.
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
  const refDeferred = Object.keys(contract.ref.deferredInVue || {});
  const refVueOnly = Object.keys(contract.ref.vueExclusive);

  for (const k of refPaired) {
    if (!reactRef.has(k)) issues.push(`REF paired '${k}' missing from React`);
    if (!vueRef.has(k)) issues.push(`REF paired '${k}' missing from Vue`);
  }
  for (const k of refInherited) {
    if (!reactRef.has(k))
      issues.push(`REF pairedViaInheritance '${k}' missing from React (contract stale)`);
    if (vueRef.has(k))
      issues.push(
        `REF '${k}' is now explicit on Vue's DocxEditorRef — move from pairedViaInheritance to paired`
      );
  }
  // Deferred ref members: React-only by design (Vue mirror deferred to a
  // tracked follow-up). Must exist on React; must NOT exist on Vue's snapshot
  // (if it did, Vue caught up — move to paired).
  for (const k of refDeferred) {
    if (!reactRef.has(k))
      issues.push(`REF deferredInVue '${k}' missing from React (contract stale)`);
    if (vueRef.has(k))
      issues.push(`REF '${k}' has shipped in Vue — move from deferredInVue to paired`);
  }
  for (const k of refVueOnly) {
    if (!vueRef.has(k)) issues.push(`REF vueExclusive '${k}' missing from Vue (contract stale)`);
    if (reactRef.has(k))
      issues.push(`REF '${k}' has shipped in React — move from vueExclusive to paired`);
  }
  for (const k of reactRef) {
    if (
      !refPaired.includes(k) &&
      !refInherited.includes(k) &&
      !refDeferred.includes(k) &&
      !refVueOnly.includes(k)
    ) {
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
  console.log(`  Vue-exclusive props:   ${vueOnly.length}`);
  console.log(`  Paired ref members:    ${refPaired.length}`);
  console.log(`  Inherited via EditorRefLike: ${refInherited.length}`);
  console.log(`  Deferred in Vue refs:  ${refDeferred.length}`);
  console.log(`  Vue-exclusive refs:    ${refVueOnly.length}`);

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
