// Derivation freshness under structural edits: `usedParaIds`, `deepParagraphOrderOfPart`
// and `revisionItemsOf` compose from per-subtree memos in module-level WeakMaps keyed on
// node OBJECTS, and a store edit shares every untouched subtree by reference across
// revisions — so a stale entry would be read back by any pass over the same nodes,
// including the one that checks it.
//
// The clean side of the differential therefore derives over a structuredClone of the part:
// same content, all-new node objects, so nothing identity-keyed can be shared with the
// memoized side. Node ids are plain data properties (minted as `${partName}#${path}` at
// parse, and by the transaction's id counter afterwards), so the clone carries the
// ORIGINAL ids and both the paragraph-order map and the revision items compare by value.
//
// Two fixtures: an untracked one, where the revision read must answer [] at every step
// (the empty early return in front of the site index), and a tracked one seeded with
// `w:ins`/`w:del` plus tracked insertions in the op vocabulary, where the read must keep
// answering the full card list.
//
// Determinism: fixed seeds and a pure inline PRNG (mulberry32). A failure prints the seed
// and the accumulated op script, which replays the exact sequence.

import { describe, expect, test } from 'bun:test';
import {
  deepParagraphOrderOfPart,
  paragraphTextOf,
  readOoxmlPart,
  revisionItemsOf,
  TreeDocumentStore,
  usedParaIds,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type TreeDocOp,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

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

// ── Fixtures ───────────────────────────────────────────────────────────────────
// Every paragraph carries authored identity and the root binds w14, so every applied
// split MINTS a fresh paraId against the memoized set — without identity the id half of
// the oracle would never move.

const paraIdFor = (index: number): string => (0x4c0a0001 + index).toString(16).toUpperCase();

const para = (index: number, text: string, extra = ''): string =>
  `<w:p w14:paraId="${paraIdFor(index)}" w14:textId="${paraIdFor(index)}">` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>${extra}</w:p>`;

const INS =
  `<w:ins w:id="101" w:author="QA Reviewer" w:date="2026-01-01T00:00:00Z">` +
  `<w:r><w:t xml:space="preserve"> added words</w:t></w:r></w:ins>`;
const DEL =
  `<w:del w:id="102" w:author="QA Reviewer" w:date="2026-01-02T00:00:00Z">` +
  `<w:r><w:delText xml:space="preserve"> removed words</w:delText></w:r></w:del>`;

function fixturePart(tracked: boolean): OoxmlPart {
  const words = 'word '.repeat(6);
  const body = Array.from({ length: 10 }, (_, i) =>
    para(i, `p${i} ${words}`, tracked && i === 2 ? INS : tracked && i === 5 ? DEL : '')
  ).join('');
  return loadPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
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
// Generated against the CURRENT tree, so ids and offsets are usually valid; the store may
// still refuse (a delete crossing tracked content, a join it will not perform). A refusal
// is logged and skipped, and the applied-op floor below keeps the test from passing by
// refusing everything.

type OpKind = 'insert-text' | 'delete-text' | 'split' | 'join' | 'tracked-insert';

const PLAIN_OPS: readonly OpKind[] = [
  'insert-text',
  'insert-text',
  'delete-text',
  'split',
  'split',
  'join',
];
const TRACKED_OPS: readonly OpKind[] = [...PLAIN_OPS, 'tracked-insert', 'tracked-insert'];

function randomOp(
  part: OoxmlPart,
  rand: () => number,
  step: number,
  tracked: boolean
): TreeDocOp | null {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const sites = paragraphSitesOf(part);
  if (sites.length === 0) return null;
  const site = pick(sites);
  switch (pick(tracked ? TRACKED_OPS : PLAIN_OPS)) {
    case 'insert-text':
      return {
        op: 'insertText',
        paragraphId: site.id,
        offset: Math.floor(rand() * (site.length + 1)),
        text: ` step${step} extra`,
      };
    case 'tracked-insert':
      return {
        op: 'insertText',
        paragraphId: site.id,
        offset: Math.floor(rand() * (site.length + 1)),
        text: ` step${step} proposal`,
        revision: { author: 'QA Reviewer', date: '2026-01-03T00:00:00Z' },
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

/** Memoized derivations over the retained part vs the same derivations over a clone. */
function assertFreshDerivations(
  store: TreeDocumentStore,
  seed: number,
  step: number,
  log: unknown[]
): void {
  const clone = structuredClone(store.part);
  const comparisons: [string, unknown, unknown][] = [
    ['usedParaIds', [...usedParaIds(store.part.root)].sort(), [...usedParaIds(clone.root)].sort()],
    [
      'deepParagraphOrderOfPart',
      [...deepParagraphOrderOfPart(store.part).entries()],
      [...deepParagraphOrderOfPart(clone).entries()],
    ],
    ['revisionItemsOf', revisionItemsOf(store.part), revisionItemsOf(clone)],
  ];
  for (const [name, memoized, fresh] of comparisons) {
    const memoizedJson = JSON.stringify(memoized);
    const freshJson = JSON.stringify(fresh);
    if (memoizedJson !== freshJson) {
      throw new Error(
        `${name} over the retained tree diverged from the clone derivation.\n` +
          `seed: ${seed}, step: ${step}\nmemoized: ${memoizedJson}\nfresh: ${freshJson}\n` +
          `replay script:\n${JSON.stringify(log)}`
      );
    }
  }
}

const SEEDS = [0xc0ffee, 42, 20260825];
const STEPS = 30;

describe('per-subtree derivation memos stay fresh across random op sequences', () => {
  for (const tracked of [false, true]) {
    for (const seed of SEEDS) {
      test(`${tracked ? 'tracked' : 'untracked'} fixture, seed ${seed}: ${STEPS} random ops`, () => {
        const rand = mulberry32(seed);
        const store = new TreeDocumentStore(fixturePart(tracked));
        const log: unknown[] = [];

        // The fixture's authored identity must have parsed, or splits mint nothing and
        // the id half of the oracle measures a constant.
        expect(usedParaIds(store.part.root).size).toBe(10);
        if (tracked) expect(revisionItemsOf(store.part).length).toBeGreaterThanOrEqual(2);
        else expect(revisionItemsOf(store.part)).toEqual([]);

        let applied = 0;
        let splitsApplied = 0;
        for (let step = 0; step < STEPS; step += 1) {
          const op = randomOp(store.part, rand, step, tracked);
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
          assertFreshDerivations(store, seed, step, log);
        }

        // Anti-vacuity: enough ops applied, and enough splits that fresh paraIds were
        // minted against — and then read back through — the memoized set.
        expect(applied).toBeGreaterThanOrEqual(15);
        expect(splitsApplied).toBeGreaterThanOrEqual(2);
      });
    }
  }
});
