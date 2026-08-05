// Generates src/google-catalog.generated.ts: the closed catalog of Google-hosted faces
// `googleFonts()` is allowed to fetch, pinned to one immutable google/fonts revision.
//
// Why a generated closed catalog rather than a URL rule: the runtime must never turn a
// family name a .docx supplied into a network request, so lookup has to be against a set
// the package shipped. Baking `sha256:` here also means the runtime pins what it loads —
// same discipline as the packaged-asset manifest, extended to bytes we do not ship.
//
// Inclusion is a RULE, not taste, so a regeneration is reproducible:
//
//   1. The family directory holds all four static faces: X-Regular/-Bold/-Italic/-BoldItalic.
//      Variable-only families (`Family[wght].ttf`) are EXCLUDED — the shaper rejects
//      variation axes (`unsupportedVariationAxes`), so a variable file would render every
//      weight at its default instance and paginate bold as regular.
//   2. Every face carries the shaper's required tables and none of its colour tables,
//      checked against the downloaded bytes rather than trusted from the listing.
//
// Run: `bun run google:catalog` in packages/fonts (downloads ~90 MB, a few minutes).
// `--check` re-validates the committed file offline; `--verify` re-downloads and compares.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pinned google/fonts revision. Bump deliberately: every catalogued URL and hash below is
 * derived from it, and a jsDelivr path pinned to a commit is immutable.
 */
const REVISION = 'ea14f3c4c462af1d847b1abe96fcb3c3a8a66f97';

const CDN = (path) => `https://cdn.jsdelivr.net/gh/google/fonts@${REVISION}/${path}`;

const FACES = [
  { suffix: 'Regular', weight: 400, style: 'normal' },
  { suffix: 'Bold', weight: 700, style: 'normal' },
  { suffix: 'Italic', weight: 400, style: 'italic' },
  { suffix: 'BoldItalic', weight: 700, style: 'italic' },
];

const REQUIRED_TABLES = ['cmap', 'head', 'hhea', 'hmtx', 'maxp'];
const REJECTED_TABLES = ['COLR', 'CPAL', 'CBDT', 'CBLC', 'sbix', 'SVG ', 'fvar'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'src', 'google-catalog.generated.ts');

const readUint16 = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];
const readUint32 = (bytes, offset) =>
  (bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;

/** The shaper's own admission questions, asked of the bytes before they enter the catalog. */
function sfntProblem(bytes) {
  if (bytes.byteLength < 12) return 'truncated sfnt header';
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const isTrueType = bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0;
  if (!isTrueType && signature !== 'OTTO') return `unsupported sfnt signature ${JSON.stringify(signature)}`;
  const tableCount = readUint16(bytes, 4);
  if (12 + tableCount * 16 > bytes.byteLength) return 'truncated sfnt table directory';
  const tags = new Set();
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    tags.add(String.fromCharCode(bytes[record], bytes[record + 1], bytes[record + 2], bytes[record + 3]));
    const offset = readUint32(bytes, record + 8);
    const length = readUint32(bytes, record + 12);
    if (offset > bytes.byteLength || length > bytes.byteLength - offset) {
      return 'sfnt table range exceeds font bytes';
    }
  }
  const missing = REQUIRED_TABLES.find((tag) => !tags.has(tag));
  if (missing) return `missing required table ${missing}`;
  const rejected = REJECTED_TABLES.find((tag) => tags.has(tag));
  if (rejected) return `carries unsupported table ${rejected.trim()}`;
  return null;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function getBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Run `jobs` with bounded concurrency; jsDelivr is generous but not infinite. */
async function pooled(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Family directories that ship all four static faces, as {dir, slug, stem, files}.
 * One tree request covers the whole repository, so this costs a single API call.
 */
async function discoverFamilies() {
  const tree = await getJson(
    `https://api.github.com/repos/google/fonts/git/trees/${REVISION}?recursive=1`
  );
  if (tree.truncated) throw new Error('google/fonts tree came back truncated; cannot enumerate');

  const byDirectory = new Map();
  for (const entry of tree.tree) {
    if (!entry.path.endsWith('.ttf')) continue;
    const parts = entry.path.split('/');
    if (parts.length !== 3) continue; // Only the family directory itself, never nested variants.
    const key = `${parts[0]}/${parts[1]}`;
    if (!byDirectory.has(key)) byDirectory.set(key, new Set());
    byDirectory.get(key).add(parts[2]);
  }

  const families = [];
  for (const [directory, files] of byDirectory) {
    for (const file of files) {
      const stem = file.endsWith('-Regular.ttf') ? file.slice(0, -'-Regular.ttf'.length) : null;
      if (!stem) continue;
      if (!FACES.every((face) => files.has(`${stem}-${face.suffix}.ttf`))) continue;
      const [licenseDir, slug] = directory.split('/');
      families.push({ directory, licenseDir, slug, stem });
      break;
    }
  }
  families.sort((left, right) => left.directory.localeCompare(right.directory));
  return families;
}

/**
 * The human family name a document would actually write ("Alegreya Sans"), taken from
 * METADATA.pb rather than un-camel-casing the file stem, which gets "PT Sans" wrong.
 */
async function familyName(family) {
  try {
    const response = await fetch(CDN(`${family.directory}/METADATA.pb`));
    if (!response.ok) return null;
    const text = await response.text();
    const match = text.match(/^name:\s*"([^"]+)"/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function buildCatalog() {
  const families = await discoverFamilies();
  console.log(`google/fonts@${REVISION.slice(0, 8)}: ${families.length} families with full static faces`);

  const named = await pooled(families, 8, async (family) => ({
    ...family,
    name: await familyName(family),
  }));

  const entries = [];
  const skipped = [];
  let done = 0;
  await pooled(named, 8, async (family) => {
    if (!family.name) {
      skipped.push({ family: family.slug, reason: 'no name in METADATA.pb' });
      return;
    }
    const faces = [];
    for (const face of FACES) {
      const path = `${family.directory}/${family.stem}-${face.suffix}.ttf`;
      const url = CDN(path);
      let bytes;
      try {
        bytes = await getBytes(url);
      } catch (error) {
        skipped.push({ family: family.name, reason: String(error.message ?? error) });
        return;
      }
      const problem = sfntProblem(bytes);
      if (problem) {
        skipped.push({ family: family.name, reason: `${face.suffix}: ${problem}` });
        return;
      }
      faces.push({
        family: family.name,
        weight: face.weight,
        style: face.style,
        url,
        byteLength: bytes.byteLength,
        hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      });
    }
    // All-or-nothing per family: a partial family would resolve regular and silently fall
    // back to the fixed measurer for bold, which is worse than not offering it at all.
    entries.push(...faces);
    done += 1;
    if (done % 20 === 0) console.log(`  ...${done} families hashed`);
  });

  entries.sort(
    (left, right) =>
      left.family.localeCompare(right.family) ||
      left.weight - right.weight ||
      left.style.localeCompare(right.style)
  );
  return { entries, skipped };
}

function render(entries) {
  const families = new Set(entries.map((entry) => entry.family));
  return (
    '// GENERATED by scripts/generate-google-catalog.mjs — do not edit.\n' +
    '// Regenerate with `bun run google:catalog` in packages/fonts; `google:check` guards it.\n' +
    `//\n// ${families.size} families, ${entries.length} faces, pinned to google/fonts@${REVISION}.\n` +
    '// Every family here ships all four static faces and passes the shaper\'s table checks;\n' +
    '// variable-only and colour families are excluded by the generator, not by hand.\n' +
    '\nexport interface GoogleFontFace {\n' +
    '  /** The family name a document would name, e.g. "PT Sans". */\n' +
    '  readonly family: string;\n' +
    '  readonly weight: 400 | 700;\n' +
    '  readonly style: \'normal\' | \'italic\';\n' +
    '  /** Immutable, commit-pinned jsDelivr URL. */\n' +
    '  readonly url: string;\n' +
    '  readonly byteLength: number;\n' +
    '  readonly hash: string;\n' +
    '}\n\n' +
    `export const GOOGLE_FONTS_REVISION = '${REVISION}';\n\n` +
    'export const GOOGLE_FONT_CATALOG: readonly GoogleFontFace[] = [\n' +
    entries
      .map(
        (entry) =>
          `  { family: '${entry.family.replace(/'/g, "\\'")}', weight: ${entry.weight}, ` +
          `style: '${entry.style}', url: '${entry.url}', byteLength: ${entry.byteLength}, ` +
          `hash: '${entry.hash}' },`
      )
      .join('\n') +
    '\n];\n'
  );
}

/** Offline consistency guard: shape, pinning and four-face completeness of what is committed. */
function check() {
  if (!existsSync(outPath)) {
    console.error('packages/fonts: src/google-catalog.generated.ts is missing. Run `bun run google:catalog`.');
    process.exit(1);
  }
  const current = readFileSync(outPath, 'utf8');
  const revision = current.match(/GOOGLE_FONTS_REVISION = '([0-9a-f]{40})'/);
  if (!revision || revision[1] !== REVISION) {
    console.error(
      `packages/fonts: catalog revision ${revision?.[1] ?? 'missing'} does not match the pinned ${REVISION}.\n` +
        'Regenerate with `bun run google:catalog` (then `bun run format`) and commit the result.'
    );
    process.exit(1);
  }
  const pattern =
    /family: '((?:[^'\\]|\\')+)',\s*weight: (400|700),\s*style: '(normal|italic)',\s*url: '([^']+)',\s*byteLength: (\d+),\s*hash: '(sha256:[0-9a-f]{64})'/g;
  const byFamily = new Map();
  let count = 0;
  for (const match of current.matchAll(pattern)) {
    count += 1;
    const [, family, weight, style, url, , ] = match;
    if (!url.startsWith(`https://cdn.jsdelivr.net/gh/google/fonts@${REVISION}/`)) {
      console.error(`packages/fonts: ${family} ${weight}/${style} is not pinned to the recorded revision.`);
      process.exit(1);
    }
    if (!byFamily.has(family)) byFamily.set(family, new Set());
    byFamily.get(family).add(`${weight}/${style}`);
  }
  if (count === 0) {
    console.error('packages/fonts: catalog parsed to zero faces; the generated shape changed.');
    process.exit(1);
  }
  for (const [family, faces] of byFamily) {
    if (faces.size !== 4) {
      console.error(`packages/fonts: ${family} has ${faces.size} faces, expected all four.`);
      process.exit(1);
    }
  }
  console.log(`google catalog OK (${byFamily.size} families, ${count} faces)`);
}

/** Networked guard: re-download every catalogued URL and compare hashes. */
async function verify() {
  const current = readFileSync(outPath, 'utf8');
  const pattern = /url: '([^']+)', byteLength: (\d+), hash: '(sha256:[0-9a-f]{64})'/g;
  const recorded = [...current.matchAll(pattern)].map(([, url, byteLength, hash]) => ({
    url,
    byteLength: Number(byteLength),
    hash,
  }));
  let bad = 0;
  await pooled(recorded, 8, async (entry) => {
    try {
      const bytes = await getBytes(entry.url);
      const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (bytes.byteLength !== entry.byteLength || hash !== entry.hash) {
        console.error(`drift: ${entry.url}`);
        bad += 1;
      }
    } catch (error) {
      console.error(`unreachable: ${entry.url} (${error.message ?? error})`);
      bad += 1;
    }
  });
  if (bad > 0) process.exit(1);
  console.log(`verified ${recorded.length} catalogued faces against the CDN`);
}

if (process.argv.includes('--check')) {
  check();
} else if (process.argv.includes('--verify')) {
  await verify();
} else {
  const { entries, skipped } = await buildCatalog();
  writeFileSync(outPath, render(entries));
  const families = new Set(entries.map((entry) => entry.family)).size;
  console.log(`wrote ${outPath} (${families} families, ${entries.length} faces)`);
  if (skipped.length > 0) {
    console.log(`skipped ${skipped.length}:`);
    for (const entry of skipped) console.log(`  ${entry.family}: ${entry.reason}`);
  }
}
