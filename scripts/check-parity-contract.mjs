#!/usr/bin/env node
// Cross-adapter parity check between @docx-editor.dev/react and
// @docx-editor.dev/vue. Reads each adapter's API Extractor snapshot
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
import { normalizeSnapshotText } from './lib/api-snapshot-parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const REACT_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-react/index.api.md');
const VUE_SNAPSHOT = path.join(repoRoot, 'docs/api/docx-editor-vue/index.api.md');
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
  return line.trim().replace(/^readonly\s+/, '').replace(/\s+/g, ' ');
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
  for (const f of [REACT_SNAPSHOT, VUE_SNAPSHOT, CONTRACT_PATH, VUE_DOCX_EDITOR_SOURCE]) {
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
    if (vueProps.has(k))
      issues.push(`PROP '${k}' must be a Vue emit, not a DocxEditorProps field`);
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
    if (!reactProps.has(k)) issues.push(`PROP reactRenderPropsAsVueSlots '${k}' missing from React`);
    if (vueProps.has(k))
      issues.push(`PROP '${k}' must be a Vue slot, not a DocxEditorProps field`);
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
      issues.push(`PROP '${k}' must fall through as Vue \`class\`, not appear under the React name`);
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
