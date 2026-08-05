// Builds a 20x-length copy of examples/vite/public/sample.docx for pipeline profiling.
//
// The body content (everything before the trailing <w:sectPr>) is repeated N times.
// Copies after the first are uniquified so the result is still a valid document:
//   - bookmark ids and drawing docPr ids are offset per copy
//   - bookmark names and hyperlink anchors get a per-copy suffix (kept consistent so
//     internal links still resolve within their own copy)
//   - comment ranges/references are stripped from copies (a comment is one range in
//     the review model, not twenty)
//
// Usage: node scripts/create-sample-20x-fixture.mjs [multiplier] [outPath]
// Default: 20x -> examples/vite/public/sample-20x.docx

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const multiplier = Number(process.argv[2] ?? 20);
const outPath = resolve(root, process.argv[3] ?? 'examples/vite/public/sample-20x.docx');
const srcPath = resolve(root, 'examples/vite/public/sample.docx');

const zip = unzipSync(readFileSync(srcPath));
const doc = strFromU8(zip['word/document.xml']);

const bodyOpen = doc.indexOf('<w:body>');
const bodyClose = doc.lastIndexOf('</w:body>');
if (bodyOpen === -1 || bodyClose === -1) throw new Error('no w:body');
const prefix = doc.slice(0, bodyOpen + '<w:body>'.length);
const body = doc.slice(bodyOpen + '<w:body>'.length, bodyClose);
const suffix = doc.slice(bodyClose);

// The final <w:sectPr> is a direct child of <w:body>; everything before it repeats.
const sectPrStart = body.lastIndexOf('<w:sectPr');
if (sectPrStart === -1) throw new Error('no trailing sectPr');
const content = body.slice(0, sectPrStart);
const finalSectPr = body.slice(sectPrStart);

function uniquify(chunk, copy) {
  const offset = copy * 100000;
  let out = chunk
    .replace(/(<w:bookmark(?:Start|End)[^>]*w:id=")(\d+)(")/g, (_, a, id, b) => a + (Number(id) + offset) + b)
    .replace(/(<w:bookmarkStart[^>]*w:name=")([^"]+)(")/g, (_, a, name, b) => a + name + '_c' + copy + b)
    .replace(/(<w:hyperlink[^>]*w:anchor=")([^"]+)(")/g, (_, a, name, b) => a + name + '_c' + copy + b)
    .replace(/(<wp:docPr[^>]*id=")(\d+)(")/g, (_, a, id, b) => a + (Number(id) + offset) + b);
  // Strip duplicate comment machinery: range markers and the reference runs.
  out = out
    .replace(/<w:commentRangeStart[^>]*\/>/g, '')
    .replace(/<w:commentRangeEnd[^>]*\/>/g, '')
    .replace(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, '');
  return out;
}

let repeated = content;
for (let copy = 1; copy < multiplier; copy++) repeated += uniquify(content, copy);

zip['word/document.xml'] = strToU8(prefix + repeated + finalSectPr + suffix);
writeFileSync(outPath, zipSync(zip, { level: 6 }));
console.log(
  `wrote ${outPath}: document.xml ${(prefix.length + repeated.length + finalSectPr.length + suffix.length) / 1e6}MB, x${multiplier}`
);
