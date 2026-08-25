// Budgeted note-reference scans compose from per-subtree memos in a module-level WeakMap
// keyed on node OBJECTS, and a store edit shares every untouched subtree by reference
// across revisions — so a stale entry (wrong hits, wrong visited count, wrong depth)
// would be read back by every later scan, including the one that checks it.
//
// The clean side of the differential therefore scans a structuredClone of the part: same
// content, all-new node objects, so nothing identity-keyed can be shared with the
// memoized side and the clone's first walk IS the unmemoized walk. Node ids are plain
// data properties, so the clone carries the ORIGINAL ids and hits compare by value.
//
// Three probes per applied op:
// 1. Full budget: hits AND the final `budget.visited` / `budget.truncated` must be
//    byte-identical to the cold walk — downstream parts sharing one budget must truncate
//    at exactly the same point.
// 2. A budget small enough to truncate mid-tree: the terminal accounting must match the
//    cold walk. Hits under truncation are immaterial (callers treat `truncated` as
//    atomic failure), so they are not compared.
// 3. The budget-free memoized path, so the two memo systems cannot drift apart.
//
// Determinism: fixed seeds and a pure inline PRNG (mulberry32). A failure prints the
// seed and the accumulated op script, which replays the exact sequence.

import { describe, expect, test } from 'bun:test';
import {
  paragraphTextOf,
  TreeDocumentStore,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type TreeDocOp,
} from '../index.ts';
import {
  collectNoteReferences,
  createNoteReferenceScanBudget,
  readOoxmlPart,
} from '../package/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadPart(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Deterministic PRNG. Same seed, same sequence, every run, every machine. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Fixture ────────────────────────────────────────────────────────────────────
// Note references sit in every third paragraph, inside hyperlinks in some, so edits hit
// both ref-bearing and plain subtrees and splits/joins move refs between spines.

function fixturePart(): OoxmlPart {
  const words = 'word '.repeat(6);
  const paragraphs = Array.from({ length: 12 }, (_, i) => {
    const ref =
      i % 3 === 0
        ? `<w:r><w:footnoteReference w:id="${i + 1}"/></w:r>`
        : i % 3 === 1
          ? `<w:hyperlink w:anchor="a${i}"><w:r><w:endnoteReference w:id="${i + 100}"/></w:r></w:hyperlink>`
          : '';
    return `<w:p><w:r><w:t xml:space="preserve">p${i} ${words}</w:t></w:r>${ref}</w:p>`;
  }).join('');
  return loadPart(
    `<w:document xmlns:w="${W}"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`
  );
}

// ── Reading the retained tree ──────────────────────────────────────────────────

function* walk(node: OoxmlNode): Generator<OoxmlNode> {
  yield node;
  if (node.kind === 'textValue') return;
  for (const child of node.children ?? []) yield* walk(child);
}

function paragraphSitesOf(part: OoxmlPart): { id: string; length: number }[] {
  const sites: { id: string; length: number }[] = [];
  for (const node of walk(part.root)) {
    if (node.kind !== 'paragraph') continue;
    sites.push({ id: node.id, length: paragraphTextOf(part, node.id)?.length ?? 0 });
  }
  return sites;
}

/** Adjacent (first, second) paragraph pairs among the body's direct children. */
function adjacentBodyParagraphPairs(part: OoxmlPart): [string, string][] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  );
  const pairs: [string, string][] = [];
  const children = body?.children ?? [];
  for (let index = 0; index + 1 < children.length; index += 1) {
    const first = children[index]!;
    const second = children[index + 1]!;
    if (first.kind === 'paragraph' && second.kind === 'paragraph') {
      pairs.push([first.id, second.id]);
    }
  }
  return pairs;
}

// ── Op vocabulary ──────────────────────────────────────────────────────────────
// Generated against the CURRENT tree, so ids and offsets are usually valid; the store
// may still refuse. A refusal is logged and skipped, and the applied-op floor below
// keeps the test from passing by refusing everything.

type OpKind = 'insert-text' | 'delete-text' | 'split' | 'join';

const OPS: readonly OpKind[] = ['insert-text', 'insert-text', 'delete-text', 'split', 'join'];

function randomOp(part: OoxmlPart, rand: () => number, step: number): TreeDocOp | null {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const sites = paragraphSitesOf(part);
  if (sites.length === 0) return null;
  const site = pick(sites);
  switch (pick(OPS)) {
    case 'insert-text':
      return {
        op: 'insertText',
        paragraphId: site.id,
        offset: Math.floor(rand() * (site.length + 1)),
        text: ` step${step} extra`,
      };
    case 'delete-text': {
      if (site.length < 2) return null;
      const start = Math.floor(rand() * (site.length - 1));
      const end = start + 1 + Math.floor(rand() * (site.length - start - 1));
      return { op: 'deleteText', paragraphId: site.id, start, end };
    }
    case 'split':
      return {
        op: 'splitParagraph',
        paragraphId: site.id,
        offset: Math.floor(rand() * (site.length + 1)),
      };
    case 'join': {
      const pairs = adjacentBodyParagraphPairs(part);
      if (pairs.length === 0) return null;
      const [firstId, secondId] = pick(pairs);
      return { op: 'joinParagraphs', firstId, secondId };
    }
  }
}

// ── The oracle ─────────────────────────────────────────────────────────────────

const FULL_BUDGET = 1_000_000;

function fail(name: string, seed: number, step: number, detail: string, log: unknown[]): never {
  throw new Error(
    `${name} over the retained tree diverged from the clone walk.\n` +
      `seed: ${seed}, step: ${step}\n${detail}\nreplay script:\n${JSON.stringify(log)}`
  );
}

/** Memoized budgeted scans over the retained part vs cold walks over structuredClones. */
function assertBudgetedScanFresh(
  part: OoxmlPart,
  seed: number,
  step: number,
  log: unknown[]
): void {
  // Full budget: hits and accounting byte-identical to the cold walk.
  const memoBudget = createNoteReferenceScanBudget(FULL_BUDGET);
  const memoHits = collectNoteReferences(part, {
    budget: memoBudget,
    maxHits: Number.POSITIVE_INFINITY,
  });
  const coldClone = structuredClone(part);
  const coldBudget = createNoteReferenceScanBudget(FULL_BUDGET);
  const coldHits = collectNoteReferences(coldClone, {
    budget: coldBudget,
    maxHits: Number.POSITIVE_INFINITY,
  });
  const memoJson = JSON.stringify(memoHits);
  const coldJson = JSON.stringify(coldHits);
  if (memoJson !== coldJson) {
    fail('budgeted hits', seed, step, `memoized: ${memoJson}\nfresh: ${coldJson}`, log);
  }
  if (memoBudget.visited !== coldBudget.visited || memoBudget.truncated !== coldBudget.truncated) {
    fail(
      'budget accounting',
      seed,
      step,
      `memoized: visited ${memoBudget.visited}, truncated ${memoBudget.truncated}\n` +
        `fresh: visited ${coldBudget.visited}, truncated ${coldBudget.truncated}`,
      log
    );
  }
  if (memoBudget.truncated) {
    fail('full budget', seed, step, 'full budget unexpectedly truncated', log);
  }

  // Budget-free memoized path must agree with its own cold walk too, so the two memo
  // systems cannot drift apart.
  const plainJson = JSON.stringify(collectNoteReferences(part));
  const plainColdJson = JSON.stringify(collectNoteReferences(structuredClone(part)));
  if (plainJson !== plainColdJson) {
    fail('budget-free hits', seed, step, `memoized: ${plainJson}\nfresh: ${plainColdJson}`, log);
  }

  // A budget that truncates mid-tree: warm memos (populated by the scan above) may
  // bulk-charge past the stop point, but the terminal accounting must match the cold
  // walk. Hits under truncation are immaterial: callers treat it as atomic failure.
  const cap = Math.max(1, Math.floor(coldBudget.visited / 2));
  const memoSmall = createNoteReferenceScanBudget(cap);
  collectNoteReferences(part, { budget: memoSmall, maxHits: Number.POSITIVE_INFINITY });
  const coldSmall = createNoteReferenceScanBudget(cap);
  collectNoteReferences(structuredClone(part), {
    budget: coldSmall,
    maxHits: Number.POSITIVE_INFINITY,
  });
  if (memoSmall.visited !== coldSmall.visited || memoSmall.truncated !== coldSmall.truncated) {
    fail(
      'truncating budget accounting',
      seed,
      step,
      `cap: ${cap}\nmemoized: visited ${memoSmall.visited}, truncated ${memoSmall.truncated}\n` +
        `fresh: visited ${coldSmall.visited}, truncated ${coldSmall.truncated}`,
      log
    );
  }
}

const SEEDS = [0xc0ffee, 42, 20260825];
const STEPS = 30;

describe('budgeted note-reference scan memos stay fresh across random op sequences', () => {
  for (const seed of SEEDS) {
    test(`seed ${seed}: ${STEPS} random ops`, () => {
      const rand = mulberry32(seed);
      const store = new TreeDocumentStore(fixturePart());
      const log: unknown[] = [];

      // The fixture's typed references must have parsed, or the oracle compares empty
      // hit lists at every step.
      expect(collectNoteReferences(store.part).length).toBeGreaterThanOrEqual(6);
      assertBudgetedScanFresh(store.part, seed, -1, log);

      let applied = 0;
      let splitsApplied = 0;
      for (let step = 0; step < STEPS; step += 1) {
        const op = randomOp(store.part, rand, step);
        if (op === null) {
          log.push(['skip', step]);
          continue;
        }
        const result = store.transact((tx) => {
          tx.apply(op);
        });
        if (!result.ok) {
          log.push(['refused', step, result.reason, op]);
          continue;
        }
        log.push([step, op]);
        applied += 1;
        if (op.op === 'splitParagraph') splitsApplied += 1;
        assertBudgetedScanFresh(store.part, seed, step, log);
      }

      // Anti-vacuity: enough ops applied, and enough splits that fresh spines were
      // rescanned against — and read back through — the memoized subtrees.
      expect(applied).toBeGreaterThanOrEqual(12);
      expect(splitsApplied).toBeGreaterThanOrEqual(2);
    });
  }
});

describe('memo reuse under a finite maxHits clip', () => {
  test('clipped hit prefix matches the cold walk; full buffer reads as truncated coverage', () => {
    const store = new TreeDocumentStore(fixturePart());
    // Warm the memos with an unclipped mutation-style scan.
    const warm = createNoteReferenceScanBudget(FULL_BUDGET);
    const all = collectNoteReferences(store.part, {
      budget: warm,
      maxHits: Number.POSITIVE_INFINITY,
    });
    expect(all.length).toBeGreaterThanOrEqual(6);

    // Diagnostics-style clip over the warmed tree. Memo hits append in document order,
    // so the clipped prefix is identical to the cold walk; only the visited count may
    // run ahead (bulk-charged subtrees), which diagnose already reports as truncated
    // coverage via the full hit buffer.
    const maxHits = 2;
    const memoBudget = createNoteReferenceScanBudget(FULL_BUDGET);
    const memoClipped = collectNoteReferences(store.part, { budget: memoBudget, maxHits });
    const coldBudget = createNoteReferenceScanBudget(FULL_BUDGET);
    const coldClipped = collectNoteReferences(structuredClone(store.part), {
      budget: coldBudget,
      maxHits,
    });
    expect(memoClipped).toHaveLength(maxHits);
    expect(JSON.stringify(memoClipped)).toBe(JSON.stringify(coldClipped));
    expect(memoBudget.truncated).toBe(false);
    expect(coldBudget.truncated).toBe(false);
  });
});
