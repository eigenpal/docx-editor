/**
 * Builds the demo default document (`sample.docx`) served by every example app.
 *
 * Why a build script rather than a checked-in hand-edited binary: reviewers can
 * read the transform tables below instead of diffing an opaque zip, and the
 * palette can be retuned by editing one map and re-running.
 *
 * Inputs:
 *   e2e/fixtures/comprehensive-word-element-test.docx
 *       The authored source, reused rather than copied so the demo document and
 *       the torture fixture stay the same document. Its runs inherit fonts and
 *       sizes from the style cascade, which is exactly what makes the result
 *       worth shipping: a doc whose runs carry explicit rFonts/sz can no longer
 *       catch an inheritance regression.
 *   scripts/demo-doc/toc-block.xml
 *       The TOC field after this editor generated it, lifted out of a
 *       round-trip of that same source. Only the block is kept: the round-trip
 *       also materialised explicit rFonts/sz onto ~655 runs, so splicing the
 *       whole document back would destroy the inheritance coverage above.
 *
 * Run with: bun run demo-doc:build
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

/** Example apps that serve the default document. */
const PUBLIC_DIRS = [
  'examples/shared',
  'examples/vite/public',
  'examples/vue/public',
  'examples/nuxt/public',
  'examples/nextjs/public',
  'examples/astro/public',
  'examples/remix/public',
];

// ---------------------------------------------------------------------------
// Text transforms
// ---------------------------------------------------------------------------

/**
 * Replacements are applied to run text only. Run structure is never touched:
 * the cover's "Status:" line stays split across two runs because that split is
 * what exercises character-level colouring.
 */
const TEXT: Record<string, Array<[string, string]>> = {
  'word/document.xml': [
    ['COMPREHENSIVE WORD ELEMENT', 'DOCX-EDITOR.DEV'],
    ['TEST DOCUMENT v2', 'ELEMENT TEST DOCUMENT'],
    [
      'Ultimate Automation Testing Suite — All Node Types',
      'Element coverage suite, all node types',
    ],
    ['Classification: ', 'Status: '],
    ['INTERNAL – FOR TESTING ONLY', 'PUBLIC SAMPLE'],
    ['QA Automation Department', 'docx-editor.dev'],
    ['Anthropic’s website', 'docx-editor.dev'],
  ],
  'word/header1.xml': [
    ['Comprehensive Word Element Test v2', 'docx-editor.dev'],
    ['CONFIDENTIAL', 'Sample document'],
  ],
  'word/footer1.xml': [['QA Automation Department', 'docx-editor.dev']],
  'word/comments.xml': [
    ['Legal Team', 'Docs Team'],
    [
      'Approved – wording is compliant with current regulations.',
      'Approved, wording reads clearly here.',
    ],
  ],
  'docProps/core.xml': [
    ['Comprehensive Word Element Test Document v2', 'docx-editor.dev element test document'],
    ['Automation Testing', 'Editor element coverage'],
    ['Automation Test Suite', 'docx-editor.dev'],
    [
      'Ultimate testing document with every Word element type including content controls, nested tables, comments, and advanced features',
      'Sample document covering every Word element type: content controls, nested tables, comments, fields, and section layout.',
    ],
  ],
};

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * A slight nudge off the authored palette, keeping each hue in its own family.
 *
 * Reds stay red and greens stay green on purpose: section 1.4 labels a run
 * "Red" and the status table colours "Failed", so re-hueing those would break
 * the very thing they check. FF0000 is left untouched as the canonical red.
 * Greys (888888/999999/808080/AAAAAA/666666) are neutral chrome and stay put.
 */
const PALETTE: Record<string, string> = {
  // blues
  '2E75B6': '2B6CB0', // info callout
  '2E74B5': '2B6CB0', // Heading 1 (styles.xml)
  '1F4D78': '234E78', // Heading 2 (styles.xml)
  '4A90D9': '4E96D6', // light accent
  // navy
  '1B3A5C': '1A3550', // cover + heading ink
  // greens
  '28A745': '2F9E5C', // success callout
  '008800': '1E8A4C', // "Green" label / "Passed"
  '339933': '2F9E5C', // table borders
  '155724': '1B5E3A', // success text
  // ambers
  CC6600: 'C2700A', // warning callout
  '856404': '7A5B0C', // warning text
  // reds
  CC0000: 'C42B2B', // "Red" label / "Failed"
  CC3333: 'C94A4A', // table borders
  DC3545: 'D13B4A', // error callout
  '721C24': '6E2029', // error text
  // shading fills
  E8F0FE: 'E7EFFA',
  FFF8E1: 'FDF6E3',
  D4EDDA: 'D8EFE0',
  F8D7DA: 'F9D9DC',
};

/**
 * Runs whose colour is changed on their own, after the palette nudge. These
 * carry text that was reworded, so their original colour no longer fits:
 * "PUBLIC SAMPLE" should not inherit the alarm red that "INTERNAL" wore.
 * Keyed by the (already rewritten) run text, so each stays a coloured run and
 * the character-colour coverage survives.
 */
const RUN_RECOLOR: Record<string, Array<[string, string]>> = {
  'word/document.xml': [['PUBLIC SAMPLE', '2F9E5C']],
  'word/header1.xml': [['Sample document', '2B6CB0']],
};

// ---------------------------------------------------------------------------
// Transform helpers
// ---------------------------------------------------------------------------

function applyText(xml: string, part: string): string {
  let out = xml;
  for (const [from, to] of TEXT[part] ?? []) {
    if (!out.includes(from)) {
      throw new Error(`[${part}] text replacement never matched: ${JSON.stringify(from)}`);
    }
    out = out.replaceAll(from, to);
  }
  return out;
}

/**
 * Rewrites colours only inside w:val/w:color/w:fill attributes, never as a bare
 * string search, so a hex can never be clobbered inside unrelated content.
 */
function applyPalette(xml: string): string {
  let out = xml;
  for (const [from, to] of Object.entries(PALETTE)) {
    out = out.replace(new RegExp(`(w:(?:val|color|fill)=")${from}(")`, 'g'), `$1${to}$2`);
  }
  return out;
}

/** Recolours the single run that contains `text`. */
function applyRunRecolor(xml: string, part: string): string {
  let out = xml;
  for (const [text, color] of RUN_RECOLOR[part] ?? []) {
    const run = new RegExp(`<w:r>(?:(?!</w:r>).)*?${text}(?:(?!</w:r>).)*?</w:r>`, 's');
    const m = out.match(run);
    if (!m) throw new Error(`[${part}] recolor target run not found: ${text}`);
    const recolored = m[0].includes('<w:color ')
      ? m[0].replace(/<w:color w:val="[0-9A-Fa-f]{6}"\/>/, `<w:color w:val="${color}"/>`)
      : m[0].replace(/<w:rPr>/, `<w:rPr><w:color w:val="${color}"/>`);
    if (recolored === m[0]) throw new Error(`[${part}] recolor made no change: ${text}`);
    out = out.replace(m[0], recolored);
  }
  return out;
}

// ---------------------------------------------------------------------------
// TOC
// ---------------------------------------------------------------------------

const HEADING_RE =
  /<w:p(?: [^>]*)?>(?:(?!<\/w:p>).)*?<w:pStyle w:val="Heading[1-5]"\/>(?:(?!<\/w:p>).)*?<\/w:p>/gs;

function tocSdt(xml: string): { start: number; end: number } {
  const i = xml.indexOf('TOC \\h');
  if (i < 0) throw new Error('no TOC field found');
  return {
    start: xml.lastIndexOf('<w:sdt>', i),
    end: xml.indexOf('</w:sdt>', i) + '</w:sdt>'.length,
  };
}

function runText(p: string): string {
  return [...p.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/gs)].map((m) => m[1]).join('');
}

/** Each TOC entry links an anchor and repeats its heading's text. */
function tocEntries(block: string): Array<{ anchor: string; label: string }> {
  return [...block.matchAll(/<w:hyperlink w:anchor="(_Toc\d+)">(.*?)<\/w:hyperlink>/gs)].map(
    (m) => ({
      anchor: m[1],
      // Trailing run is the page number; the label is everything before the ptab.
      label: runText(m[2].split('<w:ptab')[0]),
    })
  );
}

/**
 * Swaps the source's empty TOC field for the generated block, then bookmarks
 * each heading with the anchor that block links to. Without the bookmarks every
 * entry would be a dead link.
 *
 * Entries pair with headings by document order, since both derive from the same
 * source. The label check below is the tripwire: an entry whose text no longer
 * matches the heading it lands on means the pairing drifted, and it fails the
 * build rather than shipping a TOC that points at the wrong sections.
 */
function injectToc(source: string, tocBlock: string): string {
  const entries = tocEntries(tocBlock);
  const { start, end } = tocSdt(source);
  let out = source.slice(0, start) + tocBlock + source.slice(end);

  const heads = [...out.matchAll(HEADING_RE)];
  if (entries.length !== heads.length) {
    throw new Error(`TOC entries (${entries.length}) != headings (${heads.length})`);
  }

  let bookmarkId = 900_000;
  const edits: Array<[number, string]> = [];

  heads.forEach((h, i) => {
    const { anchor, label } = entries[i];
    const actual = runText(h[0]);
    if (actual !== label) {
      throw new Error(
        `TOC entry ${i} does not match its heading:\n  heading: ${actual}\n  entry:   ${label}`
      );
    }
    const id = bookmarkId++;
    const pprEnd = h[0].indexOf('</w:pPr>');
    const at =
      pprEnd >= 0 ? h.index! + pprEnd + '</w:pPr>'.length : h.index! + h[0].indexOf('>') + 1;
    edits.push([at, `<w:bookmarkStart w:id="${id}" w:name="${anchor}"/>`]);
    edits.push([h.index! + h[0].length - '</w:p>'.length, `<w:bookmarkEnd w:id="${id}"/>`]);
  });

  // Apply back-to-front so each insertion leaves earlier offsets valid.
  for (const [at, text] of edits.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, at) + text + out.slice(at);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const SOURCE_DOCX = 'e2e/fixtures/comprehensive-word-element-test.docx';

/**
 * Zip entries are stamped with this instead of the wall clock, so rebuilding
 * from an unchanged source reproduces the committed file byte for byte. Without
 * it every run rewrites 36 KB of binary and the output can't be verified
 * against the script. Value is the source document's own authored date.
 */
const ENTRY_DATE = new Date('2026-03-26T00:00:00Z');

async function main(): Promise<void> {
  const source = await JSZip.loadAsync(await readFile(join(REPO, SOURCE_DOCX)));
  const tocBlock = await readFile(join(HERE, 'toc-block.xml'), 'utf8');

  for (const path of Object.keys(source.files)) {
    const entry = source.files[path];
    if (entry.dir) continue;
    if (!path.endsWith('.xml')) continue;

    let xml = await entry.async('string');
    if (path === 'word/document.xml') xml = injectToc(xml, tocBlock);
    xml = applyText(xml, path);
    xml = applyRunRecolor(xml, path);
    xml = applyPalette(xml);
    source.file(path, xml, { date: ENTRY_DATE });
  }

  // Normalise every entry's timestamp, directories included: their headers
  // carry a date too, and leaving them live is enough to churn the output.
  for (const path of Object.keys(source.files)) {
    source.files[path].date = ENTRY_DATE;
  }

  const out = await source.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  for (const dir of PUBLIC_DIRS) {
    await writeFile(join(REPO, dir, 'sample.docx'), out);
  }
  console.log(`sample.docx (${(out.length / 1024).toFixed(1)} KB) -> ${PUBLIC_DIRS.length} dirs`);
}

await main();
