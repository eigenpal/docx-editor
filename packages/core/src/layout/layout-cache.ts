// Reusing measured and broken lines across revisions (task 9.2).
//
// Breaking a paragraph into lines is the expensive half of layout: every piece is measured,
// every word boundary tested. PLACING those lines — assigning y, cutting fragments at page
// boundaries — is arithmetic over results already in hand. So the break is cached and the
// placement is always redone, which keeps pagination correct after an edit anywhere above
// while a paragraph nobody touched is never measured twice.
//
// A cache is only safe if its key covers everything the cached value depends on. Miss one
// input and the editor shows geometry for a document that no longer exists — worse than no
// cache at all, because it looks right. The key therefore spans:
//
//   CONTENT      the paragraph's text and the run properties over it
//   PROPERTIES   the paragraph's own properties, which decide indents and alignment
//   WIDTH        the space available, since the same text breaks differently in a narrower
//                column
//   PRODUCER     who measured it — a font resource epoch, a shaping library version, a
//                different measurer entirely. Fonts arriving after first paint change every
//                advance in the document, and nothing in the content changes to say so.
//
// The revision is deliberately NOT part of the key: reuse across revisions is the point, and
// a paragraph whose content and context are unchanged lays out identically whatever the
// document around it did.

import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';

/** A fingerprint over one paragraph's layout inputs. */
export type ParagraphLayoutKey = string;

/** Cache counters, for asserting that incremental layout is actually reusing work. */
export interface LayoutCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly size: number;
}

/**
 * The per-paragraph measurement cache.
 *
 * Caches the BREAK only — where a paragraph's lines fall at a given width — never its placement.
 * An edit high in a document still repaginates everything below it, while paragraphs nobody
 * touched are never measured again.
 */
export interface ParagraphLayoutCache<T> {
  get(key: ParagraphLayoutKey): T | undefined;
  set(key: ParagraphLayoutKey, value: T): void;
  /** Drop entries for paragraphs a commit removed, so the cache cannot grow without bound. */
  retain(keys: ReadonlySet<ParagraphLayoutKey>): void;
  clear(): void;
  readonly stats: LayoutCacheStats;
}

/** Serialize a property list stably: element order matters, attribute order does not. */
function propertyToken(property: OoxmlProperty): string {
  const attributes = Object.entries(property.attributes ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join(',');
  return `${property.localName}(${attributes})`;
}

function propertiesToken(properties: readonly OoxmlProperty[]): string {
  return properties.map(propertyToken).join(';');
}

/**
 * Everything about a paragraph NODE that can change how it breaks.
 *
 * Walks the tree rather than reading text alone: a run property changes advances without
 * changing a character, and an unknown child changes the ordering of what surrounds it.
 */
/**
 * Canonical-tree nodes are immutable (deep-frozen at construction; edits replace nodes), so a
 * node's token can never change — memoizing per object turns the per-pass key computation for
 * an unchanged paragraph into a single WeakMap hit instead of a full subtree walk.
 *
 * Only paragraph and table nodes are stored (the granularity `paragraphLayoutKey` is called
 * at): caching every descendant would hold one string per nesting level of the same content.
 */
const nodeTokens = new WeakMap<object, string>();

/**
 * Tokens longer than this are computed transiently instead of retained. A table token embeds
 * its whole subtree, so a hostile document nesting a large payload inside ~50 table levels
 * would otherwise retain depth × payload of strings for the document's lifetime; the ceiling
 * bounds retention while leaving every realistic paragraph and table memoized.
 */
const MAX_MEMOIZED_TOKEN_LENGTH = 1 << 18;

function nodeToken(node: OoxmlNode): string {
  if (node.kind === 'textValue') return `t:${node.value}`;
  const cacheable = node.kind === 'paragraph' || node.kind === 'table';
  if (cacheable) {
    const cached = nodeTokens.get(node);
    if (cached !== undefined) return cached;
  }
  const token = computeNodeToken(node);
  if (cacheable && token.length <= MAX_MEMOIZED_TOKEN_LENGTH) nodeTokens.set(node, token);
  return token;
}

function computeNodeToken(node: OoxmlNode): string {
  if (node.kind === 'textValue') return `t:${node.value}`;
  // The node's OWN identity, not just its shape. Ids are structural paths, so inserting a
  // table above a paragraph renumbers every paragraph below it while nothing about their
  // content changes — and the reused records would then name paragraphs that no longer
  // exist at those ids, leaving hit testing and the caret resolving against dead anchors.
  const parts: string[] = [
    `${node.kind}:${'localName' in node ? node.localName : ''}#${'id' in node ? node.id : ''}`,
  ];
  // `attributes` is an ARRAY of records, not a record. `Object.entries` over it yielded
  // `0=[object Object]` — every attribute VALUE was dropped and only the count survived, so
  // changing a run from 11pt to 22pt produced an identical key and served the 11pt breaks.
  if ('attributes' in node && Array.isArray(node.attributes)) {
    const attributes = [...node.attributes]
      .map(
        (attribute) => `${attribute.namespaceUri ?? ''}:${attribute.localName}=${attribute.value}`
      )
      .sort();
    for (const attribute of attributes) parts.push(attribute);
  }
  for (const child of node.children ?? []) parts.push(nodeToken(child));
  return `(${parts.join('|')})`;
}

/**
 * Everything that decides whether a cached paragraph break is still valid.
 *
 * `producer` is in the key because a font arriving after first paint changes every advance in the
 * document while no content changes — without it the cache would serve the pre-font layout
 * forever.
 */
export interface ParagraphKeyInputs {
  readonly paragraph: OoxmlNode;
  readonly properties: readonly OoxmlProperty[];
  /** Available width, which decides where the lines break. */
  readonly width: number;
  /**
   * Who produced the measurements.
   *
   * Fonts loading after first paint change every advance while no content changes, so a
   * cache keyed on content alone would serve the pre-font layout forever.
   */
  readonly producer: string;
  /**
   * Inline drawing projection/resource epoch for this paragraph.
   *
   * Pending→ready/refused transitions and extent/hidden changes must invalidate breaks even
   * when paragraph text is unchanged.
   */
  readonly drawingToken?: string;
  /** Active page exclusion zones affecting this paragraph's break. */
  readonly exclusionToken?: string;
}

interface ParagraphKeyMemo {
  readonly producer: string;
  readonly width: number;
  readonly drawingToken: string;
  readonly exclusionToken: string;
  readonly propertiesToken: string;
  readonly key: ParagraphLayoutKey;
}

/**
 * Single-entry memo of the assembled key per (immutable) paragraph node.
 *
 * The key embeds the whole content token, so it is a LONG string — and a freshly joined
 * string has no cached hash, which made every cache `get` re-hash kilobytes per paragraph
 * per pass. Handing back the SAME string object keeps the engine on V8's cached string
 * hash, which is what makes the paragraph cache cheap to consult on every keystroke.
 */
const paragraphKeyMemos = new WeakMap<object, ParagraphKeyMemo>();

/**
 * The cache key for one paragraph's measured break.
 *
 * Folds in the content, the available width, and the measurement producer. Anything that changes
 * where lines fall must be in here, or the cache serves a break taken under different conditions.
 */
export function paragraphLayoutKey(inputs: ParagraphKeyInputs): ParagraphLayoutKey {
  // Width is quantized to a thousandth of a point: a width that differs by less than that
  // cannot move a break, and keying on the raw float would miss on every scroll that
  // recomputes it.
  const width = Math.round(inputs.width * 1000);
  const drawingToken = inputs.drawingToken ?? '';
  const exclusionToken = inputs.exclusionToken ?? '';
  const properties = propertiesToken(inputs.properties);
  const memo = paragraphKeyMemos.get(inputs.paragraph);
  if (
    memo &&
    memo.producer === inputs.producer &&
    memo.width === width &&
    memo.drawingToken === drawingToken &&
    memo.exclusionToken === exclusionToken &&
    memo.propertiesToken === properties
  ) {
    return memo.key;
  }
  const key = [
    inputs.producer,
    width,
    drawingToken,
    exclusionToken,
    properties,
    nodeToken(inputs.paragraph),
  ].join('\0');
  if (key.length <= MAX_MEMOIZED_TOKEN_LENGTH) {
    paragraphKeyMemos.set(inputs.paragraph, {
      producer: inputs.producer,
      width,
      drawingToken,
      exclusionToken,
      propertiesToken: properties,
      key,
    });
  }
  return key;
}

/** How large the paragraph cache grows before least-recently-used eviction. */
export interface ParagraphLayoutCacheOptions {
  /**
   * Entries retained before the least recently used are dropped.
   *
   * The default has to exceed a realistic document, or a full pass evicts exactly what the
   * next one needs and the cache costs more than it saves.
   */
  readonly maxEntries?: number;
}

/**
 * A bounded least-recently-used cache.
 *
 * Bounded because a long editing session touches far more paragraph states than a document
 * contains — every keystroke mints a new key for the paragraph being typed in — and an
 * unbounded cache would hold every intermediate state of the session.
 */
export function createParagraphLayoutCache<T>(
  options: ParagraphLayoutCacheOptions = {}
): ParagraphLayoutCache<T> {
  const maxEntries = Math.max(1, options.maxEntries ?? 4096);
  // Insertion order IS the recency order: a hit deletes and re-inserts, so the oldest key
  // is always the first one the iterator yields.
  const entries = new Map<ParagraphLayoutKey, T>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) {
        misses += 1;
        return undefined;
      }
      hits += 1;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },

    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
        evictions += 1;
      }
    },

    retain(keys) {
      for (const key of [...entries.keys()]) {
        if (!keys.has(key)) {
          entries.delete(key);
          evictions += 1;
        }
      }
    },

    clear() {
      entries.clear();
    },

    get stats() {
      return { hits, misses, evictions, size: entries.size };
    },
  };
}
