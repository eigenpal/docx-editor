/**
 * Keep the authored chrome-slot reference aligned with the public core union and
 * the adapter toolbar namespace. Generated API pages expose the types, but they do
 * not explain where a control appears or which compound part drives it.
 */
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const corePath = resolve(root, 'packages/core/src/editor/chrome-controls.ts');
const reactPath = resolve(root, 'packages/react/src/editor/toolbar/DocxEditorToolbar.tsx');
const vuePath = resolve(root, 'packages/vue/src/editor/toolbar/DocxEditorToolbar.tsx');
const docsPath = resolve(root, 'docs/site/content/guides/chrome-slots.mdx');
const guideMetaPath = resolve(root, 'docs/site/content/guides/meta.json');
const rootMetaPath = resolve(root, 'docs/site/content/meta.json');

function publicSlots(source) {
  const declaration = source.match(/export type ChromeSlotId =([\s\S]*?);/);
  if (!declaration) throw new Error('Could not find the ChromeSlotId declaration.');
  return [...declaration[1].matchAll(/\|\s*'([^']+)'/g)].map((match) => match[1]);
}

function toolbarParts(source, adapter) {
  const start = source.indexOf('Object.assign(DocxEditorToolbarRoot, {');
  if (start === -1) throw new Error(`Could not find the ${adapter} toolbar namespace.`);
  const end = source.indexOf('\n})', start);
  if (end === -1) throw new Error(`Could not find the end of the ${adapter} toolbar namespace.`);
  return [...source.slice(start, end).matchAll(/^\s{2}([A-Z][A-Za-z0-9]*)(?=:|,)/gm)].map(
    (match) => match[1]
  );
}

function difference(left, right) {
  return left.filter((value) => !right.has(value));
}

const core = readFileSync(corePath, 'utf8');
const react = readFileSync(reactPath, 'utf8');
const vue = readFileSync(vuePath, 'utf8');
const docs = readFileSync(docsPath, 'utf8');
const guidePages = JSON.parse(readFileSync(guideMetaPath, 'utf8')).pages;
const rootPages = JSON.parse(readFileSync(rootMetaPath, 'utf8')).pages;

const expectedSlots = publicSlots(core);
const documentedSlots = [...docs.matchAll(/^\|\s*`([a-z][A-Za-z0-9]*\.[A-Za-z0-9]+)`\s*\|/gm)].map(
  (match) => match[1]
);
const expectedSlotSet = new Set(expectedSlots);
const documentedSlotSet = new Set(documentedSlots);

const helpers = new Set(['Button', 'Action', 'Separator']);
const reactParts = toolbarParts(react, 'React').filter((part) => !helpers.has(part));
const vueParts = toolbarParts(vue, 'Vue').filter((part) => !helpers.has(part));
const documentedPartCells = [
  ...docs.matchAll(/^\|\s*`[a-z][A-Za-z0-9]*\.[A-Za-z0-9]+`\s*\|\s*[^|]*\|\s*([^|]*)\|/gm),
].map((match) => match[1]);
const documentedParts = new Set(
  documentedPartCells.flatMap((cell) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]))
);

const errors = [];
if (!guidePages.includes('chrome-slots')) errors.push('missing from guides/meta.json');
if (!rootPages.includes('guides/chrome-slots')) errors.push('missing from root meta.json');
const missingSlots = difference(expectedSlots, documentedSlotSet);
const unknownSlots = difference(documentedSlots, expectedSlotSet);
const duplicateSlots = documentedSlots.filter(
  (slot, index) => documentedSlots.indexOf(slot) !== index
);
if (missingSlots.length > 0) errors.push(`missing slots: ${missingSlots.join(', ')}`);
if (unknownSlots.length > 0) errors.push(`unknown slots: ${unknownSlots.join(', ')}`);
if (duplicateSlots.length > 0)
  errors.push(`duplicate slots: ${[...new Set(duplicateSlots)].join(', ')}`);

const reactPartSet = new Set(reactParts);
const vuePartSet = new Set(vueParts);
const onlyReact = difference(reactParts, vuePartSet);
const onlyVue = difference(vueParts, reactPartSet);
if (onlyReact.length > 0) errors.push(`toolbar parts missing from Vue: ${onlyReact.join(', ')}`);
if (onlyVue.length > 0) errors.push(`toolbar parts missing from React: ${onlyVue.join(', ')}`);

const missingParts = difference(reactParts, documentedParts);
if (missingParts.length > 0) errors.push(`undocumented toolbar parts: ${missingParts.join(', ')}`);

if (errors.length > 0) {
  console.error(`${relative(root, docsPath)} is out of sync:\n`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `docs chrome slots: OK — ${expectedSlots.length} slots and ${reactParts.length} named toolbar parts`
);
