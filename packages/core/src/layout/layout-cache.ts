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
 * The break-cache keys a table's cell paragraphs were last cached under, per (immutable)
 * table node.
 *
 * A pass can enumerate its top-level block keys without laying anything out, but a table's
 * CELL keys only exist while table layout runs — and a resumed pass never lays out the
 * unchanged prefix. Recording them per node lets `retain` name every live key: the node is
 * immutable, so the recorded keys stay right until an edit replaces the node, whose new
 * layout re-records them.
 */
const tableCellBreakKeys = new WeakMap<object, readonly ParagraphLayoutKey[]>();

export function registerTableCellBreakKeys(
  table: object,
  keys: readonly ParagraphLayoutKey[]
): void {
  tableCellBreakKeys.set(table, keys);
}

export function tableCellBreakKeysOf(table: object): readonly ParagraphLayoutKey[] | undefined {
  return tableCellBreakKeys.get(table);
}

/**
 * Retain a pass's live keys: its block keys plus the recorded cell keys of its tables.
 *
 * With a `collector` (the multi-section orchestrator's shared set) the keys are only
 * ADDED — the orchestrator retains once over the union, because retaining per section
 * evicted every other section's entries.
 */
export function retainLiveBreakKeys<T>(
  cache: ParagraphLayoutCache<T> | undefined,
  collector: Set<string> | undefined,
  blockKeys: readonly string[],
  tables: readonly object[]
): void {
  if (!cache) return;
  const retained = collector ?? new Set<string>();
  for (const key of blockKeys) retained.add(key);
  for (const table of tables) {
    const cellKeys = tableCellBreakKeys.get(table);
    if (cellKeys) for (const key of cellKeys) retained.add(key);
  }
  if (!collector) cache.retain(retained);
}

/**
 * Passes between document-wide retention sweeps.
 *
 * Retention only trims memory — the generation TTL tolerates deferral — while the union of
 * live keys it builds costs real time on a large document. So it runs on a stride of
 * published passes instead of on every keystroke; between sweeps the cache grows by at most
 * one re-keyed paragraph per pass.
 */
const RETENTION_PASS_STRIDE = 8;

let retentionTick = 0;

/** Whether this published pass should pay for the document-wide retention sweep. */
export function retentionPassDue(): boolean {
  retentionTick += 1;
  return retentionTick % RETENTION_PASS_STRIDE === 0;
}

/**
 * How many retain generations an entry survives without being listed or touched.
 *
 * `retain` receives the keys a pass can NAME cheaply — the top-level block keys plus the
 * registered table-cell keys. Lanes that mint keys the pass cannot enumerate up front
 * (notes, textbox stories) live on this grace period instead: touched entries re-stamp, so
 * only keys no pass has wanted for this many retains are dropped. One retain runs per
 * published layout pass, so the window is "recent passes", not wall time.
 */
const RETAIN_GENERATION_TTL = 8;

/**
 * A bounded least-recently-used cache with generation-scoped retention.
 *
 * Bounded because a long editing session touches far more paragraph states than a document
 * contains — every keystroke mints a new key for the paragraph being typed in — and an
 * unbounded cache would hold every intermediate state of the session.
 *
 * The bound never evicts the CURRENT working set: entries stamped by this generation's
 * retain or touched since it began are skipped, and the map grows past `maxEntries` when a
 * document is larger than the configured cap — evicting live entries made every full pass
 * on a 500-page document re-measure the whole document.
 */
export function createParagraphLayoutCache<T>(
  options: ParagraphLayoutCacheOptions = {}
): ParagraphLayoutCache<T> {
  const maxEntries = Math.max(1, options.maxEntries ?? 4096);
  // Insertion order IS the recency order: a hit deletes and re-inserts, so the oldest key
  // is always the first one the iterator yields.
  const entries = new Map<ParagraphLayoutKey, { value: T; generation: number }>();
  let generation = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) {
        misses += 1;
        return undefined;
      }
      hits += 1;
      entries.delete(key);
      entry.generation = generation;
      entries.set(key, entry);
      return entry.value;
    },

    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, { value, generation });
      while (entries.size > maxEntries) {
        const oldest = entries.entries().next();
        if (oldest.done) break;
        // The least recent entry is still part of the current working set: everything
        // after it is too, so the cap yields rather than thrash.
        if (oldest.value[1].generation >= generation) break;
        entries.delete(oldest.value[0]);
        evictions += 1;
      }
    },

    retain(keys) {
      generation += 1;
      for (const key of keys) {
        const entry = entries.get(key);
        if (entry) entry.generation = generation;
      }
      for (const [key, entry] of entries) {
        if (generation - entry.generation > RETAIN_GENERATION_TTL) {
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
