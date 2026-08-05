// Headless pipeline benchmark: bytes → parse → store → layout → edit/relayout → save.
//
// Measures each stage of the one pipeline on a fixture (default: the 20x sample doc built by
// scripts/create-sample-20x-fixture.mjs). Uses the fixed measurer so numbers are font-independent
// and reproducible; browser paint cost is profiled separately in Chrome.
//
// Usage: bun scripts/bench/pipeline-bench.ts [fixturePath] [--json]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  resolveHeaderFooterPartsBySection,
  TreePackageStore,
  normalizeParagraphIdentity,
  type OoxmlPart,
  type OoxmlPackage,
} from '../../packages/core/src/store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type PageFurniture,
} from '../../packages/core/src/layout/index.ts';

const fixture = resolve(
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : 'examples/vite/public/sample-20x.docx'
);
const asJson = process.argv.includes('--json');

const measurer = createFixedMeasurer(6, 14);

function furnitureFor(pkg: OoxmlPackage, part: OoxmlPart): readonly (PageFurniture | undefined)[] {
  const sections = enumerateDocumentSections(part);
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  return sections.map((section, index) => {
    const parts = bySection[index];
    if (!parts || (parts.headers.size === 0 && parts.footers.size === 0)) return undefined;
    const geometry = geometryOfSection(section.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const mapStories = (source: typeof parts.headers) => {
      const laid = new Map();
      for (const [variant, hfPart] of source) {
        laid.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'bench'));
      }
      return laid;
    };
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: mapStories(parts.headers),
      footers: mapStories(parts.footers),
    };
  });
}

interface StageResult {
  stage: string;
  ms: number;
  note?: string;
}
const results: StageResult[] = [];
function stage<T>(name: string, fn: () => T, note?: (value: T) => string): T {
  const t0 = performance.now();
  const value = fn();
  const ms = performance.now() - t0;
  results.push({ stage: name, ms, ...(note ? { note: note(value) } : {}) });
  return value;
}

const bytes = new Uint8Array(readFileSync(fixture));
results.push({ stage: 'fixture', ms: 0, note: `${fixture} (${(bytes.length / 1024) | 0} KB)` });

// ── parse ──
const loaded = stage('readOoxmlPackage', () => readOoxmlPackage(bytes));
if (!loaded.ok) throw new Error(`parse failed: ${loaded.reason}`);
const pkg = loaded.package;
const main = pkg.parts.get(pkg.mainDocumentPart)!;

// ── identity + store ──
const normalized = stage('normalizeParagraphIdentity', () => normalizeParagraphIdentity(main));
const store = stage('new TreePackageStore', () => new TreePackageStore(pkg, normalized));
const bodyStore = store.bodyStore();
const part = () => bodyStore.part;

// ── furniture + full layout ──
const furniture = stage('furniture (hf layout)', () => furnitureFor(pkg, part()));
const session = createLayoutSession();
const layout = stage(
  'layoutSemanticDocument (cold)',
  () =>
    layoutSemanticDocument(part(), 1, {
      measurer,
      sectionFurniture: furniture,
      session,
      producer: 'bench',
    }),
  (l) => `${l.pages.length} pages`
);

// ── no-change incremental pass ──
stage('layout (no-change, warm session)', () =>
  layoutSemanticDocument(part(), 2, {
    measurer,
    sectionFurniture: furniture,
    session,
    producer: 'bench',
  })
);

// ── single edit + incremental relayout (keystroke path) ──
const firstParagraph = (() => {
  const body = part();
  const walk = (node: any): any => {
    if (node.kind === 'paragraph') return node;
    for (const child of node.children ?? []) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  return walk(body.root);
})();
if (firstParagraph) {
  stage('transact insertText(1 char)', () =>
    bodyStore.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: firstParagraph.id, offset: 0, text: 'X' })
    )
  );
  stage('layout (incremental after edit)', () =>
    layoutSemanticDocument(part(), 3, {
      measurer,
      sectionFurniture: furniture,
      session,
      producer: 'bench',
    })
  );
}

// ── save ──
stage(
  'writeOoxmlPackage (save)',
  () => writeOoxmlPackage(store.currentPackage()),
  (b) => `${((b as Uint8Array).length / 1024) | 0} KB`
);

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const total = results.reduce((sum, r) => sum + r.ms, 0);
  for (const r of results) {
    console.log(`${r.stage.padEnd(40)} ${r.ms.toFixed(1).padStart(9)} ms  ${r.note ?? ''}`);
  }
  console.log(`${'TOTAL'.padEnd(40)} ${total.toFixed(1).padStart(9)} ms`);
  console.log(`pages: ${layout.pages.length}`);
}
