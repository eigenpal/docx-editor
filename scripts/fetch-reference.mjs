#!/usr/bin/env node
/**
 * Downloads ECMA-376 reference PDFs + supplementary ZIPs that are
 * gitignored to keep the repo small. Idempotent: skips files that
 * already exist on disk.
 *
 * The XSD schemas under reference/ecma-376/part1/schemas/ stay
 * committed (876KB) and the handwritten quick-refs under
 * reference/quick-ref/ stay committed (28KB). This script only
 * fetches the heavy bits (~58MB) that are useful when you need
 * the full spec PDF or to re-extract supplementary schemas.
 *
 * Source: ECMA-376 5th Edition (December 2016).
 * https://ecma-international.org/publications-and-standards/standards/ecma-376/
 *
 * If a URL has moved, update SOURCES below or follow the page link
 * above and place files manually; the script logs the expected
 * destination for each.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const refDir = path.join(repoRoot, 'reference', 'ecma-376');

// Each part ships as one ZIP bundle containing the PDF + supplementary
// schema ZIPs. Download once, extract the needed entries, drop the bundle.
const SOURCES = [
  {
    name: 'ECMA-376 Part 1 5th Edition bundle',
    url: 'https://ecma-international.org/wp-content/uploads/ECMA-376-1_5th_edition_december_2016.zip',
    targets: [
      {
        zipPath: /Ecma Office Open XML Part 1.*\.pdf$/i,
        outPath: path.join(refDir, 'part1', 'Ecma Office Open XML Part 1 - Fundamentals And Markup Language Reference.pdf'),
      },
      { zipPath: /OfficeOpenXML-XMLSchema-Strict\.zip$/, outPath: path.join(refDir, 'part1', 'OfficeOpenXML-XMLSchema-Strict.zip') },
      { zipPath: /OfficeOpenXML-RELAXNG-Strict\.zip$/, outPath: path.join(refDir, 'part1', 'OfficeOpenXML-RELAXNG-Strict.zip') },
      { zipPath: /OfficeOpenXML-DrawingMLGeometries\.zip$/, outPath: path.join(refDir, 'part1', 'OfficeOpenXML-DrawingMLGeometries.zip') },
      { zipPath: /OfficeOpenXML-SpreadsheetMLStyles\.zip$/, outPath: path.join(refDir, 'part1', 'OfficeOpenXML-SpreadsheetMLStyles.zip') },
      { zipPath: /OfficeOpenXML-WordprocessingMLArtBorders\.zip$/, outPath: path.join(refDir, 'part1', 'OfficeOpenXML-WordprocessingMLArtBorders.zip') },
    ],
  },
  {
    name: 'ECMA-376 Part 4 5th Edition bundle',
    url: 'https://ecma-international.org/wp-content/uploads/ECMA-376-4_5th_edition_december_2016.zip',
    targets: [
      {
        zipPath: /Ecma Office Open XML Part 4.*\.pdf$/i,
        outPath: path.join(refDir, 'part4', 'Ecma Office Open XML Part 4 - Transitional Migration Features.pdf'),
      },
      { zipPath: /OfficeOpenXML-XMLSchema-Transitional\.zip$/, outPath: path.join(refDir, 'part4', 'OfficeOpenXML-XMLSchema-Transitional.zip') },
      { zipPath: /OfficeOpenXML-RELAXNG-Transitional\.zip$/, outPath: path.join(refDir, 'part4', 'OfficeOpenXML-RELAXNG-Transitional.zip') },
    ],
  },
];

// reference/ecma-376/overview.pdf isn't published as a standalone
// download by ECMA. If you want it locally, grab it manually from
// https://ecma-international.org/publications-and-standards/standards/ecma-376/
// and drop it at reference/ecma-376/overview.pdf. The Part 1 PDF
// fetched below covers the same ground in more depth.

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await fs.mkdir(path.dirname(p), { recursive: true });
}

async function downloadBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

async function handleBundle(bundle) {
  const missing = [];
  for (const t of bundle.targets) {
    if (!(await exists(t.outPath))) missing.push(t);
  }
  if (missing.length === 0) {
    console.log(`${bundle.name}: all ${bundle.targets.length} files present, skipping`);
    return { downloaded: 0, skipped: bundle.targets.length, failed: 0 };
  }
  console.log(`${bundle.name}: ${missing.length}/${bundle.targets.length} missing, downloading bundle...`);
  let buf;
  try {
    buf = await downloadBuffer(bundle.url);
  } catch (err) {
    console.error(`  download failed: ${err.message}`);
    console.error(`  manual fallback: open ${bundle.url} in a browser, then place files at:`);
    for (const t of missing) console.error(`    ${path.relative(repoRoot, t.outPath)}`);
    return { downloaded: 0, skipped: bundle.targets.length - missing.length, failed: missing.length };
  }
  console.log(`  downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB, extracting...`);
  const zip = await JSZip.loadAsync(buf);
  let extracted = 0;
  for (const t of missing) {
    const entry = Object.values(zip.files).find((f) => !f.dir && t.zipPath.test(f.name));
    if (!entry) {
      console.error(`  no match in zip for ${t.zipPath} -> ${path.relative(repoRoot, t.outPath)}`);
      continue;
    }
    await ensureDir(t.outPath);
    const data = await entry.async('nodebuffer');
    await fs.writeFile(t.outPath, data);
    console.log(`  wrote ${path.relative(repoRoot, t.outPath)} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
    extracted++;
  }
  return {
    downloaded: extracted,
    skipped: bundle.targets.length - missing.length,
    failed: missing.length - extracted,
  };
}

async function main() {
  console.log('Fetching ECMA-376 reference (~58 MB across 2 bundles). Existing files are skipped.\n');
  const totals = { downloaded: 0, skipped: 0, failed: 0 };
  for (const b of SOURCES) {
    const r = await handleBundle(b);
    totals.downloaded += r.downloaded;
    totals.skipped += r.skipped;
    totals.failed += r.failed;
  }
  console.log();
  console.log(`Done. downloaded=${totals.downloaded} skipped=${totals.skipped} failed=${totals.failed}`);
  if (totals.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
