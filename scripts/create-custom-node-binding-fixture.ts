#!/usr/bin/env bun
//
// Writes a `.docx` carrying a bound custom node, for testing against Word by hand.
//
//   bun run scripts/create-custom-node-binding-fixture.ts [out.docx]
//
// WHY THIS EXISTS
//
// The store layer landed before the write path that fills it, so nothing in the product emits
// a `w:dataBinding` yet — and the one question the fixtures cannot answer is whether Word
// PRESERVES a binding across an open/edit/save. `sdt-custom-tag-word-roundtrip.docx` proves
// the data part survives; it contains no binding at all. This produces the file that settles
// it: open the output in Word (desktop and web), edit an unrelated paragraph, save, and unzip
// the result. What to look for is printed at the end.
//
// The payload is validated by a real zod schema on the way in, which is the shape a host
// declares with `defineCustomNode({ schema })`.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  customXmlLabelXPath,
  customXmlPrefixMappings,
  insertChildren,
  readOoxmlPackage,
  readOoxmlPart,
  storyParagraphs,
  withCustomXmlDataPart,
  withCustomXmlNode,
  withPart,
  writeOoxmlPackage,
  WML_NAMESPACE_URI,
} from '../packages/core/src/store/index.ts';

const STORY = '/word/document.xml';
const NS = 'https://docx-editor.dev/custom-nodes/test';
const ROOT = 'nodes';
const PREFIX = 'ns0';
const NODE_ID = 'cx1';
const LABEL = '(Smith 2024, p. 42)';

/** What the host says its citation carries. An ordinary zod schema. */
const Citation = z.object({
  sourceId: z.string().min(1),
  locator: z.string(),
  authors: z.array(z.string()).max(64),
  year: z.number().int().gte(0).lte(3000),
  url: z.url().optional(),
});

const payload = Citation.parse({
  sourceId: 'src_9f3',
  locator: 'p.42',
  authors: ['Smith, J.', 'Okonkwo, A.'],
  year: 2024,
  url: 'https://example.test/papers/9f3.pdf',
});

const source = resolve(
  import.meta.dirname,
  '../e2e/fixtures/comprehensive-word-element-test.docx'
);
const read = readOoxmlPackage(new Uint8Array(readFileSync(source)));
if (!read.ok) throw new Error(`could not open the source document: ${read.reason}`);

const authored = withCustomXmlDataPart(read.package, STORY, NS, ROOT);
if (!authored.part) throw new Error('the store could not be authored');

let pkg = withCustomXmlNode(authored.pkg, authored.part.partName, {
  id: NODE_ID,
  label: LABEL,
  data: JSON.stringify(payload),
});

const xpath = customXmlLabelXPath(PREFIX, ROOT, NODE_ID);
const mappings = customXmlPrefixMappings(PREFIX, NS);
if (xpath === null || mappings === null) throw new Error('the binding address is not addressable');

// The control, as a standalone part so the reader builds a real tree for it.
//
// CHILD ORDER IS LOAD BEARING. `CT_SdtPr` is an `xsd:sequence`, and `w:dataBinding` sits after
// `w:lock` (and after `placeholder`/`showingPlcHdr`, which this does not use), before `w:label`.
// Word rejects the document outright when a child appears out of order.
const sdtXml =
  `<w:sdt xmlns:w="${WML_NAMESPACE_URI}">` +
  `<w:sdtPr>` +
  `<w:alias w:val="Citation"/>` +
  `<w:tag w:val="acme:citation?id=${NODE_ID}"/>` +
  `<w:id w:val="424242"/>` +
  `<w:lock w:val="sdtLocked"/>` +
  `<w:dataBinding w:prefixMappings="${mappings.replace(/"/g, '&quot;')}" w:xpath="${xpath}" w:storeItemID="${authored.part.itemId}"/>` +
  `</w:sdtPr>` +
  `<w:sdtContent><w:r><w:t xml:space="preserve">${LABEL}</w:t></w:r></w:sdtContent>` +
  `</w:sdt>`;
const parsedSdt = readOoxmlPart(sdtXml, { name: '/sdt.xml', contentType: 'application/xml' });
if (!parsedSdt.ok) throw new Error('the control markup did not parse');

const story = pkg.parts.get(STORY);
if (!story) throw new Error('the document has no main part');
// The walk starts at the body, not at `w:document`.
const body = story.root.children.find((child) => child.kind === 'body');
if (!body) throw new Error('the document has no body');
const paragraph = storyParagraphs(body).find(
  (candidate) => candidate.kind === 'paragraph' && candidate.children.length > 0
);
if (!paragraph) throw new Error('the document has no paragraph to put the control in');

const spliced = insertChildren(story, paragraph.id, paragraph.children.length, [parsedSdt.part.root], {
  deferValidation: true,
});
if (!spliced.ok) throw new Error('the control could not be spliced into the body');
pkg = withPart(pkg, spliced.part);

const out = resolve(process.argv[2] ?? 'custom-node-binding.docx');
writeFileSync(out, writeOoxmlPackage(pkg));

console.log(`wrote ${out}`);
console.log(`  store        ${authored.part.partName} (${authored.part.itemId})`);
console.log(`  xpath        ${xpath}`);
console.log(`  payload      ${JSON.stringify(payload)}`);
console.log('');
console.log('Open it in Word, edit an unrelated paragraph, save, then unzip the result:');
console.log('  1. is customXml/item1.xml still there, with the <data> payload intact?');
console.log('  2. does word/document.xml still carry <w:dataBinding …>, or did Word drop it?');
console.log('  3. did Word rewrite the control text from <label>, or leave the run alone?');
console.log('  4. does the ds:itemID in customXml/itemProps1.xml still match w:storeItemID?');
