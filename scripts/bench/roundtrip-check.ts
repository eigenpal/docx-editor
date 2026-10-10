// Save/reopen stability oracle for the bench fixture: opening the saved bytes and saving
// again must be byte-identical, and the reopened main part must fingerprint identically.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  normalizeParagraphIdentity,
  canonicalOoxmlFingerprint,
} from '../../packages/core/src/store/index.ts';

const fixture = resolve(process.argv[2] ?? 'examples/vite/public/sample-20x.docx');
const bytes = new Uint8Array(readFileSync(fixture));

const first = readOoxmlPackage(bytes);
if (!first.ok) throw new Error(`open failed: ${first.reason}`);
const main1 = normalizeParagraphIdentity(first.package.parts.get(first.package.mainDocumentPart)!);
const parts1 = new Map(first.package.parts);
parts1.set(main1.name, main1);
const saved1 = writeOoxmlPackage({ ...first.package, parts: parts1 });

const second = readOoxmlPackage(saved1);
if (!second.ok) throw new Error(`reopen failed: ${second.reason}`);
const main2 = normalizeParagraphIdentity(
  second.package.parts.get(second.package.mainDocumentPart)!
);
const parts2 = new Map(second.package.parts);
parts2.set(main2.name, main2);
const saved2 = writeOoxmlPackage({ ...second.package, parts: parts2 });

const fp1 = canonicalOoxmlFingerprint(main1);
const fp2 = canonicalOoxmlFingerprint(main2);
console.log('fingerprint stable:', fp1 === fp2);
console.log(
  'bytes stable:',
  saved1.length === saved2.length && saved1.every((b, i) => b === saved2[i])
);
if (fp1 !== fp2 || saved1.length !== saved2.length) process.exit(1);
