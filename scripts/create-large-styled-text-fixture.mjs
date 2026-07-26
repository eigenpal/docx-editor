/**
 * Create the LARGE STYLED-TEXT fixture for renderer run-grouping benchmarks.
 *
 * The comprehensive Word fixture (`sample.docx`) proves breadth — every element type
 * once. This fixture proves SCALE at the specific thing run grouping changes: many
 * words per line, many authored runs per paragraph, and long runs that cross line and
 * page boundaries.
 *
 * Why it is generated rather than hand-authored: the baseline has to be reproducible.
 * The content is fully deterministic (a seeded LCG, no Math.random, no dates), so
 * regenerating it byte-compares equal and a measurement taken today is comparable to one
 * taken after the grouping change.
 *
 * What it deliberately contains:
 *
 *  - PLAIN paragraphs of many words — the worst case for word-per-element painting and
 *    the best case for grouping, since one line collapses to one element.
 *  - HEAVILY SPLIT paragraphs alternating formatting every few words — the worst case
 *    for grouping, where element count is dominated by authored run count and grouping
 *    can only win by clipping to lines.
 *  - LONG SINGLE RUNS spanning several lines — proves a run clipped to lines keeps its
 *    formatting on every piece and its semantic range stays contiguous.
 *  - Whitespace that must survive verbatim: repeated spaces, leading/trailing spaces,
 *    tabs, non-breaking spaces, empty paragraphs.
 *  - The full basic-formatting matrix the change must support, so the same fixture
 *    serves the formatting gates and not just the node-count numbers.
 *
 * Run: node scripts/create-large-styled-text-fixture.mjs
 *   or: bun scripts/create-large-styled-text-fixture.mjs
 */

import JSZip from 'jszip';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Determinism ──────────────────────────────────────────────────────────────
// A tiny LCG (numerical recipes constants). Seeded, so the same bytes every run.
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const WORDS = [
  'document', 'paragraph', 'formatting', 'baseline', 'measurement', 'pagination',
  'selection', 'grapheme', 'cluster', 'kerning', 'ligature', 'typography',
  'renderer', 'projection', 'interaction', 'geometry', 'authored', 'semantic',
  'boundary', 'fragment', 'identity', 'canonical', 'serialize', 'reopen',
];

function sentence(rng, wordCount) {
  const out = [];
  for (let i = 0; i < wordCount; i += 1) out.push(WORDS[Math.floor(rng() * WORDS.length)]);
  return out.join(' ');
}

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A `w:r` with the given `w:rPr` inner XML. `xml:space="preserve"` ALWAYS — this
 *  fixture's whitespace is part of what the gates check. */
function run(text, rPrInner = '') {
  const rPr = rPrInner ? `<w:rPr>${rPrInner}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

const para = (runsXml, pPrInner = '') =>
  `<w:p>${pPrInner ? `<w:pPr>${pPrInner}</w:pPr>` : ''}${runsXml}</w:p>`;

// ── The basic-formatting matrix ──────────────────────────────────────────────
// Every property the run-grouping change must parse, measure, group, paint, mutate,
// serialize and reopen. Kept as `[label, rPr]` so the paragraph text names the property
// being exercised — a failed gate then points at the property, not at an index.
const FORMATS = [
  ['bold', '<w:b/>'],
  ['italic', '<w:i/>'],
  ['bold italic', '<w:b/><w:i/>'],
  ['underline single', '<w:u w:val="single"/>'],
  ['underline double', '<w:u w:val="double"/>'],
  ['underline wave', '<w:u w:val="wave"/>'],
  ['underline colored', '<w:u w:val="single" w:color="FF0000"/>'],
  ['strike', '<w:strike/>'],
  ['double strike', '<w:dstrike/>'],
  ['superscript', '<w:vertAlign w:val="superscript"/>'],
  ['subscript', '<w:vertAlign w:val="subscript"/>'],
  ['baseline raised', '<w:position w:val="6"/>'],
  ['baseline lowered', '<w:position w:val="-6"/>'],
  ['font family', '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>'],
  ['font size', '<w:sz w:val="32"/>'],
  ['text color', '<w:color w:val="1F6FEB"/>'],
  ['highlight', '<w:highlight w:val="yellow"/>'],
  ['character shading', '<w:shd w:val="clear" w:color="auto" w:fill="D0E8FF"/>'],
  ['all caps', '<w:caps/>'],
  ['small caps', '<w:smallCaps/>'],
  ['letter spacing', '<w:spacing w:val="40"/>'],
  ['horizontal scale', '<w:w w:val="150"/>'],
  ['kerning', '<w:kern w:val="16"/>'],
  ['outline', '<w:outline/>'],
  ['shadow', '<w:shadow/>'],
  ['emboss', '<w:emboss/>'],
  ['imprint', '<w:imprint/>'],
  ['emphasis mark', '<w:em w:val="dot"/>'],
  ['vanish', '<w:vanish/>'],
  ['combined', '<w:b/><w:i/><w:u w:val="single"/><w:color w:val="B31D28"/><w:sz w:val="28"/>'],
];

function buildBody() {
  const rng = makeRng(20260726);
  const parts = [];

  parts.push(para(run('Large styled-text fixture', '<w:b/><w:sz w:val="40"/>')));
  parts.push(
    para(
      run(
        'Deterministic content for renderer run-grouping baselines. Regenerating this file produces identical bytes.'
      )
    )
  );
  parts.push(para(''));

  // 1. PLAIN paragraphs — many words, one authored run. Grouping should collapse each
  //    visual line to a single element here.
  parts.push(para(run('1. Plain paragraphs (one authored run, many words)', '<w:b/>')));
  for (let i = 0; i < 40; i += 1) {
    parts.push(para(run(sentence(rng, 90) + '.')));
  }

  // 2. HEAVILY SPLIT paragraphs — formatting alternates every few words, so authored run
  //    count dominates. Grouping wins only by clipping runs to lines, never by merging
  //    across a style change.
  parts.push(para(run('2. Heavily split paragraphs (formatting alternates)', '<w:b/>')));
  for (let i = 0; i < 30; i += 1) {
    const runs = [];
    for (let r = 0; r < 24; r += 1) {
      const [, rPr] = FORMATS[(i + r) % FORMATS.length];
      runs.push(run(sentence(rng, 3) + ' ', rPr));
    }
    parts.push(para(runs.join('')));
  }

  // 3. LONG SINGLE RUNS — one authored run spanning many visual lines and, at this
  //    length, page boundaries. Every clipped piece must keep the formatting and the
  //    semantic range must stay contiguous across the split.
  parts.push(para(run('3. Long single runs crossing lines and pages', '<w:b/>')));
  for (const [label, rPr] of FORMATS) {
    parts.push(para(run(`${label}: ${sentence(rng, 160)}.`, rPr)));
  }

  // 4. WHITESPACE that must survive verbatim.
  parts.push(para(run('4. Whitespace preservation', '<w:b/>')));
  parts.push(para(run('Repeated     spaces     between     words.')));
  parts.push(para(run('   Leading spaces and trailing spaces.   ')));
  parts.push(para(run('Tab\tseparated\tcolumns\there.')));
  parts.push(para(run('Non breaking spaces hold together.')));
  parts.push(para('')); // empty paragraph
  parts.push(para(run('Text after an empty paragraph.')));
  parts.push(
    para(
      run('Line', '') +
        '<w:r><w:br/></w:r>' +
        run('after an explicit break.')
    )
  );

  // 5. UNICODE — punctuation, symbols, and the scripts the correctness gates name.
  parts.push(para(run('5. Unicode, symbols and scripts', '<w:b/>')));
  parts.push(para(run('Punctuation: — – … “quoted” ‘single’ © ® ™ § ¶')));
  parts.push(para(run('Symbols: † ‡ • ° ± ≠ ≤ ≥ ∞ ∑')));
  parts.push(para(run('Ligatures: office affluent waffle first-fit')));
  parts.push(para(run('Combining marks: é ä õ ñ ü')));
  parts.push(para(run('Emoji: 📄 ✅ 🔍 🌐')));
  parts.push(para(run('CJK: 漢字とかな，中文段落，한글 문장.')));
  parts.push(para(run('RTL: שלום עולם and مرحبا بالعالم mixed with Latin.')));

  // 6. MIXED FORMATTING INSIDE A WORD — a run boundary mid-word must not become a
  //    wrapping opportunity, and grouping must not merge across it.
  parts.push(para(run('6. Run boundaries inside words', '<w:b/>')));
  for (let i = 0; i < 10; i += 1) {
    parts.push(
      para(
        run('un', '<w:b/>') +
          run('break', '<w:i/>') +
          run('able ', '<w:u w:val="single"/>') +
          run(sentence(rng, 40) + '.')
      )
    );
  }

  return parts.join('');
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

function documentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
}

async function main() {
  const zip = new JSZip();
  // A FIXED per-entry date. `generateAsync({ date })` is not enough: JSZip stamps each
  // entry with its own creation time, so without this the archive differs on every run
  // and the "fixture hash" the baseline records would be meaningless.
  const date = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));
  const add = (name, content) => zip.file(name, content, { date });
  add('[Content_Types].xml', CONTENT_TYPES_XML);
  add('_rels/.rels', RELS_XML);
  add('word/_rels/document.xml.rels', DOCUMENT_RELS_XML);
  add('word/document.xml', documentXml(buildBody()));

  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const out = path.join(__dirname, '..', 'examples', 'vite', 'public', 'large-styled-text.docx');
  fs.writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
