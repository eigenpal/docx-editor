// Fetch the ECMA-376 PDFs and their supplementary archives, and write a searchable text copy and
// a subclause index for each part. Every file that this script writes is git-ignored
// (reference/README.md).
//
//   bun run reference:fetch            fetch what is missing, then write the text and the index
//   bun run reference:fetch --text     write the text and the index again from the local PDFs
//
// Output, for each part N:
//   reference/ecma-376/partN/*.pdf            the standard, as Ecma publishes it
//   reference/ecma-376/partN/*.zip            the supplementary archives (schemas, RELAX NG)
//   reference/ecma-376/partN/text/full.txt    `pdftotext -layout` of the PDF
//   reference/ecma-376/partN/text/index.tsv   subclause, title, PDF page, line in full.txt
//
// Find a subclause: `grep -P '^18\.3\.1\.13\t' reference/ecma-376/part1/text/index.tsv`, then
// read `full.txt` from the line that the index names. The text needs Poppler (`pdftotext`).
//
// The EigenPal editors (XLSX Editor, PPTX Editor, and DOCX Editor) keep the same copy of this
// file and of `check-citations.ts`. It takes the place of DOCX Editor's
// `scripts/fetch-reference.mjs` at 6130fecd. Differences: it fetches Parts 2 and 3 too (OPC and
// Markup Compatibility), unzips with fflate, and writes the text copy and the subclause index.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { unzipSync } from 'fflate';

const ROOT = join(import.meta.dir, '..', '..');
const REF = join(ROOT, 'reference', 'ecma-376');
const BASE = 'https://ecma-international.org/wp-content/uploads/';

interface Target {
  readonly entry: RegExp;
  readonly out: string;
}

interface Part {
  readonly part: number;
  readonly archive: string;
  readonly pdf: RegExp;
  readonly extras: readonly Target[];
}

const PARTS: readonly Part[] = [
  {
    part: 1,
    archive: 'ECMA-376-1_5th_edition_december_2016.zip',
    pdf: /Part 1.*\.pdf$/i,
    extras: [
      { entry: /OfficeOpenXML-XMLSchema-Strict\.zip$/, out: 'OfficeOpenXML-XMLSchema-Strict.zip' },
      { entry: /OfficeOpenXML-RELAXNG-Strict\.zip$/, out: 'OfficeOpenXML-RELAXNG-Strict.zip' },
      {
        entry: /OfficeOpenXML-DrawingMLGeometries\.zip$/,
        out: 'OfficeOpenXML-DrawingMLGeometries.zip',
      },
      {
        entry: /OfficeOpenXML-SpreadsheetMLStyles\.zip$/,
        out: 'OfficeOpenXML-SpreadsheetMLStyles.zip',
      },
      {
        entry: /OfficeOpenXML-WordprocessingMLArtBorders\.zip$/,
        out: 'OfficeOpenXML-WordprocessingMLArtBorders.zip',
      },
    ],
  },
  {
    part: 2,
    archive: 'ECMA-376-2_5th_edition_december_2021.zip',
    pdf: /Part 2.*\.pdf$/i,
    extras: [
      {
        entry: /OpenPackagingConventions-XMLSchema\.zip$/,
        out: 'OpenPackagingConventions-XMLSchema.zip',
      },
    ],
  },
  {
    part: 3,
    archive: 'ECMA-376-3_5th_edition_december_2015.zip',
    pdf: /Part 3.*\.pdf$/i,
    extras: [],
  },
  {
    part: 4,
    archive: 'ECMA-376-4_5th_edition_december_2016.zip',
    pdf: /Part 4.*\.pdf$/i,
    extras: [
      {
        entry: /OfficeOpenXML-XMLSchema-Transitional\.zip$/,
        out: 'OfficeOpenXML-XMLSchema-Transitional.zip',
      },
      {
        entry: /OfficeOpenXML-RELAXNG-Transitional\.zip$/,
        out: 'OfficeOpenXML-RELAXNG-Transitional.zip',
      },
    ],
  },
];

const partDir = (p: Part): string => join(REF, `part${p.part}`);
const pdfPath = (p: Part): string => join(partDir(p), `ECMA-376-${p.part}.pdf`);
const textDir = (p: Part): string => join(partDir(p), 'text');
const rel = (path: string): string => relative(ROOT, path);

/** Download the archive of a part and write the PDF and the extras that are missing. */
async function fetchPart(p: Part): Promise<boolean> {
  const targets: Target[] = [{ entry: p.pdf, out: `ECMA-376-${p.part}.pdf` }, ...p.extras];
  const missing = targets.filter((t) => !existsSync(join(partDir(p), t.out)));
  if (missing.length === 0) {
    console.log(`part ${p.part}: all files present`);
    return true;
  }
  const url = BASE + p.archive;
  console.log(`part ${p.part}: downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`part ${p.part}: HTTP ${response.status}. Download ${url} by hand, and place:`);
    for (const t of missing) console.error(`  ${rel(join(partDir(p), t.out))}`);
    return false;
  }
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  let ok = true;
  for (const t of missing) {
    const name = Object.keys(files).find((n) => t.entry.test(n));
    if (!name) {
      console.error(`part ${p.part}: the archive has no entry for ${t.entry}`);
      ok = false;
      continue;
    }
    const out = join(partDir(p), t.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, files[name]!);
    console.log(`  wrote ${rel(out)}`);
  }
  return ok;
}

/** A table of contents line: `18.3.1.13 col (Column Width & Formatting) ....... 1600`. */
const TOC_LINE = /^\s*(\d+(?:\.\d+)*)\s+(.+?)\s*\.{4,}\s*(\d+)\s*$/;

/** Write `full.txt` with `pdftotext -layout`, and `index.tsv` from its table of contents. */
function writeText(p: Part): boolean {
  if (!existsSync(pdfPath(p))) {
    console.error(`part ${p.part}: ${rel(pdfPath(p))} is missing; run without --text first`);
    return false;
  }
  mkdirSync(textDir(p), { recursive: true });
  const full = join(textDir(p), 'full.txt');
  const run = spawnSync('pdftotext', ['-layout', pdfPath(p), full], { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`part ${p.part}: pdftotext failed; install Poppler (CONTRIBUTING.md)`);
    return false;
  }
  const lines = readFileSync(full, 'utf8').split('\n');
  const toc = new Map<string, { title: string; page: string }>();
  for (const line of lines) {
    const m = TOC_LINE.exec(line);
    if (m && !toc.has(m[1]!)) toc.set(m[1]!, { title: m[2]!, page: m[3]! });
  }
  // The heading of each subclause in the body: its number, white space, and its title.
  const headings = new Map<string, number>();
  lines.forEach((line, i) => {
    const m = /^(\d+(?:\.\d+)*)(?:\s{2,}\S|\s[A-Za-z])/.exec(line);
    if (m && toc.has(m[1]!) && !TOC_LINE.test(line) && !headings.has(m[1]!))
      headings.set(m[1]!, i + 1);
  });
  // Some subclauses (the parts of clause 12, for example) have no table of contents line of
  // their own. Take a body heading whose parent subclause is known, with no page number.
  const extra = new Map<string, { title: string; line: number }>();
  lines.forEach((line, i) => {
    const m = /^(\d+(?:\.\d+)+)(?:\s{2,}|\s(?=[A-Za-z]))(\S.{0,100}?[^.\s])\s*$/.exec(line);
    if (!m || toc.has(m[1]!) || extra.has(m[1]!) || TOC_LINE.test(line)) return;
    const parent = m[1]!.slice(0, m[1]!.lastIndexOf('.'));
    if (toc.has(parent) || extra.has(parent)) extra.set(m[1]!, { title: m[2]!, line: i + 1 });
  });
  const rows = ['subclause\ttitle\tpage\tline'];
  for (const [number, { title, page }] of toc)
    rows.push(`${number}\t${title}\t${page}\t${headings.get(number) ?? ''}`);
  for (const [number, { title, line }] of extra) rows.push(`${number}\t${title}\t\t${line}`);
  writeFileSync(join(textDir(p), 'index.tsv'), `${rows.join('\n')}\n`);
  console.log(`  wrote ${rel(full)} and index.tsv (${rows.length - 1} subclauses)`);
  return true;
}

if (import.meta.main) {
  const textOnly = process.argv.includes('--text');
  let ok = true;
  for (const p of PARTS) {
    if (!textOnly) ok = (await fetchPart(p)) && ok;
    ok = writeText(p) && ok;
  }
  process.exit(ok ? 0 : 1);
}

export { PARTS, TOC_LINE, textDir };
