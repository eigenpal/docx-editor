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
import { sha256FontBytes } from '../store/package/sha256.ts';

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
  /**
   * Whether values released after placement remain available to later layout passes.
   *
   * One-shot exporters set this false so producers may avoid defensive snapshots whose
   * only purpose is protecting a value reused by a future pass.
   */
  readonly retainAcrossPasses?: boolean;
  get(key: ParagraphLayoutKey): T | undefined;
  set(key: ParagraphLayoutKey, value: T): void;
  /** Release a break after final placement when this cache was created for a one-shot pass. */
  release?(key: ParagraphLayoutKey): void;
  /** Drop entries for paragraphs a commit removed, so the cache cannot grow without bound. */
  retain(keys: ReadonlySet<ParagraphLayoutKey>): void;
  /**
   * Whether THIS published pass should pay for a document-wide {@link retain} sweep.
   *
   * Retention only trims memory — the aging window tolerates deferral — while building the
   * union of live keys costs real time on a large document, so callers ask per pass and
   * sweep on a stride. Per cache instance, so one editor's cadence cannot starve another's.
   * Optional for compatibility: a cache without it is retained on every pass.
   */
  retentionPassDue?(): boolean;
  clear(): void;
  readonly stats: LayoutCacheStats;
}

/**
 * Serialize a property list stably: element order matters, attribute order does not.
 *
 * Boundaries are NUL-framed because attribute VALUES carry file-derived text (marker
 * `w:lvlText`, resolved REF results). A printable join would let a crafted value spell out
 * another property's serialization, and two different property lists would alias to one
 * cache key. XML text cannot carry U+0000, so no file-derived value can forge a boundary.
 */
function propertyToken(property: OoxmlProperty): string {
  const attributes = Object.entries(property.attributes ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('\0,');
  return `${property.localName}(\0${attributes}\0)`;
}

function propertiesToken(properties: readonly OoxmlProperty[]): string {
  return properties.map(propertyToken).join('\0;');
}

/**
 * Tokens longer than this are computed transiently instead of retained. A table token embeds
 * its whole subtree, so a hostile document nesting a large payload inside ~50 table levels
 * would otherwise retain depth × payload of strings for the document's lifetime; the ceiling
 * bounds retention while leaving every realistic paragraph and table memoized.
 */
const MAX_MEMOIZED_TOKEN_LENGTH = 1 << 18;

const layoutTokenEncoder = new TextEncoder();

/** Collision-resistant, platform-neutral cache fingerprint over a framed string. */
function layoutTokenDigest(token: string): string {
  return sha256FontBytes(layoutTokenEncoder.encode(token));
}

interface CachedLayoutDigest {
  readonly digest: string;
  readonly bytes: number;
}

const MAX_CACHED_LAYOUT_DIGESTS = 2_048;
const MAX_CACHED_LAYOUT_DIGEST_BYTES = 2 * 1024 * 1024;
const cachedLayoutDigests = new Map<string, CachedLayoutDigest>();
let cachedLayoutDigestBytes = 0;

function reusableLayoutTokenDigest(token: string): string {
  const cached = cachedLayoutDigests.get(token);
  if (cached) {
    cachedLayoutDigests.delete(token);
    cachedLayoutDigests.set(token, cached);
    return cached.digest;
  }
  const digest = layoutTokenDigest(token);
  const bytes = token.length * 2;
  if (bytes <= MAX_CACHED_LAYOUT_DIGEST_BYTES) {
    cachedLayoutDigests.set(token, { digest, bytes });
    cachedLayoutDigestBytes += bytes;
    while (
      cachedLayoutDigests.size > MAX_CACHED_LAYOUT_DIGESTS ||
      cachedLayoutDigestBytes > MAX_CACHED_LAYOUT_DIGEST_BYTES
    ) {
      const oldest = cachedLayoutDigests.entries().next();
      if (oldest.done) break;
      cachedLayoutDigests.delete(oldest.value[0]);
      cachedLayoutDigestBytes -= oldest.value[1].bytes;
    }
  }
  return digest;
}

/**
 * Namespaces a break-cache token by the inline-drawing CONTEXT that minted it.
 *
 * The context changes how a paragraph breaks — inline drawings are measured as atoms only
 * when it is present — so two passes over the same bytes may not share cache entries just
 * because their per-block tokens agree. One helper for every key path (body blocks, table
 * cells, the section-prepass epoch), so the namespace cannot diverge per lane.
 */
export function withDrawingContext(token: string, inlineDrawingContext: boolean): string {
  return `${token}|${inlineDrawingContext ? 'drawing' : ''}`;
}

/**
 * Injective token join: every part is length-prefixed (netstring framing), so NO content —
 * file-controlled text, other framed joins, even a part containing digits and colons — can
 * forge a part boundary. Two part lists concatenate to one string only when they are the
 * same list. Use this for every cache/reuse token composed over file-influenced strings; a
 * printable separator, and even a NUL separator once parts may themselves contain NUL, lets
 * two different states alias and a reused page paint the stale one.
 */
export function framedTokenJoin(parts: readonly string[]): string {
  let out = '';
  for (const part of parts) out += `${part.length}:${part}`;
  return out;
}

/**
 * Aggregate the list tokens of every paragraph a table contains, memoized per (table,
 * listItems) pair — both immutable, so the walk runs once per numbering state instead of
 * once per pass. An empty slot is retained for every unlisted paragraph, so token position
 * remains significant even when neighboring paragraphs have equal authored content.
 */
const tableListTokens = new WeakMap<object, WeakMap<object, string>>();
export function listTokenForTableBlock(
  table: OoxmlNode,
  listItems: ReadonlyMap<string, { readonly cacheToken: string }> | undefined
): string {
  if (!listItems || listItems.size === 0) return '';
  // Nested weak keying: neither the table nor the list map is retained by the memo, and two
  // consumers preparing one table under different list maps both stay warm.
  let byListItems = tableListTokens.get(table);
  const cached = byListItems?.get(listItems);
  if (cached !== undefined) return cached;
  const token = aggregateParagraphTokensForTableBlock(
    table,
    (paragraph) => listItems.get(paragraph.id)?.cacheToken ?? ''
  );
  if (token.length <= MAX_MEMOIZED_TOKEN_LENGTH) {
    if (!byListItems) {
      byListItems = new WeakMap();
      tableListTokens.set(table, byListItems);
    }
    byListItems.set(listItems, token);
  }
  return token;
}

/**
 * ONE walk for every per-paragraph token aggregate over a table subtree (list, drawing,
 * semantic projection), so framing and traversal cannot drift between copies. Empty slots
 * preserve paragraph position; netstring framing stays injective even if a future token
 * contains NUL or another file-controlled delimiter. Empty when no paragraph carries a token,
 * so token-free tables keep keying as before. Callers own their memoization.
 */
export function aggregateParagraphTokensForTableBlock(
  table: OoxmlNode,
  tokenForParagraph: (paragraph: OoxmlNode) => string
): string {
  const tokens: string[] = [];
  let any = false;
  const stack: OoxmlNode[] = [table];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'paragraph') {
      const token = tokenForParagraph(node);
      if (token) any = true;
      tokens.push(token);
      // Hosted text-box paragraphs are represented by their host paragraph's aggregate token.
      continue;
    }
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]!);
      }
    }
  }
  return any ? framedTokenJoin(tokens) : '';
}

/**
 * One fixed-width digest per immutable element subtree.
 *
 * Tree edits are copy-on-write: every changed ancestor gets a new identity, while untouched
 * siblings keep theirs. Caching at each element therefore makes rehashing proportional to the
 * changed path instead of the size of an enclosing table. Text values stay inline in their
 * parent's token, avoiding a WeakMap entry for every leaf. No inherited/contextual state enters
 * this digest; every field below belongs to the node itself, so identity reuse is always sound.
 */
const nodeLayoutDigests = new WeakMap<object, string>();

interface NodeTokenTestObserver {
  nodeVisits: number;
  active: boolean;
  readonly previous: NodeTokenTestObserver | null;
}

let nodeTokenTestObserver: NodeTokenTestObserver | null = null;

/** @internal Deterministic work recorder for recursive layout-key digest tests. */
export function layoutNodeTokenVisitTestRecorder(): {
  readonly nodeVisits: number;
  reset(): void;
  dispose(): void;
} {
  const observer: NodeTokenTestObserver = {
    nodeVisits: 0,
    active: true,
    previous: nodeTokenTestObserver,
  };
  nodeTokenTestObserver = observer;
  return {
    get nodeVisits() {
      return observer.nodeVisits;
    },
    reset() {
      observer.nodeVisits = 0;
    },
    dispose() {
      if (!observer.active) return;
      observer.active = false;
      // Restore a surrounding observer when recorders are nested. An out-of-order dispose
      // must not detach the newer observer that still owns the instrumentation slot.
      if (nodeTokenTestObserver !== observer) return;
      let restore = observer.previous;
      while (restore && !restore.active) restore = restore.previous;
      nodeTokenTestObserver = restore;
    },
  };
}

function nodeLayoutIdentity(node: OoxmlNode): string {
  if (node.kind === 'textValue') return layoutTokenDigest(computeNodeToken(node));
  const cached = nodeLayoutDigests.get(node);
  if (cached !== undefined) return cached;
  const digest = layoutTokenDigest(computeNodeToken(node));
  nodeLayoutDigests.set(node, digest);
  return digest;
}

function computeNodeToken(node: OoxmlNode): string {
  if (nodeTokenTestObserver) nodeTokenTestObserver.nodeVisits += 1;
  if (node.kind === 'textValue') return framedTokenJoin(['text', node.value]);
  const attributes: string[] = [];
  // Attribute order is not semantic, but every tuple and sequence boundary must be. File
  // values may contain any printable delimiter, so length-prefix each component. Append in
  // a loop as OOXML is untrusted: spreading an attacker-sized attribute list can exceed the
  // engine's argument-count limit before the document reaches configured byte limits.
  for (const attribute of node.attributes) {
    attributes.push(
      framedTokenJoin([attribute.namespaceUri ?? '', attribute.localName, attribute.value])
    );
  }
  attributes.sort();
  const children: string[] = [];
  for (const child of node.children) {
    // A digest is fixed-width and collision-resistant, so retaining one per immutable child
    // avoids both the old whole-table rewalk and quadratic retained recursive token strings.
    // Frame its role as well as its value: a text token cannot masquerade as a child digest.
    children.push(
      child.kind === 'textValue'
        ? computeNodeToken(child)
        : framedTokenJoin(['child-digest', nodeLayoutIdentity(child)])
    );
  }
  return framedTokenJoin([
    'element',
    node.kind,
    node.localName,
    node.id,
    framedTokenJoin(attributes),
    framedTokenJoin(children),
  ]);
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
  /** Paragraph-local semantic projection identity (links and live metadata fields). */
  readonly projectionToken?: string;
  /** Active page exclusion zones affecting this paragraph's break. */
  readonly exclusionToken?: string;
}

/**
 * How each {@link ParagraphKeyInputs} field reaches the memo hit test in
 * {@link paragraphLayoutKey}. The `satisfies` clause makes a new input field a compile
 * error here until it is classified — the trap this map exists for is the memo: an input
 * folded into the joined key but missing from the memo comparison is SILENTLY INERT,
 * because the memo returns the previous key before the join ever runs.
 *
 * - `'memo-identity'`: the WeakMap key itself; its content reaches the key via a SHA-256 digest.
 * - `'memo-compared'`: compared verbatim (after normalization) in the memo hit test AND
 *   folded into the key.
 * - `'memo-derived'`: compared through a derived token (`propertiesToken`).
 */
export const PARAGRAPH_KEY_INPUT_ROLES = {
  paragraph: 'memo-identity',
  properties: 'memo-derived',
  width: 'memo-compared',
  producer: 'memo-compared',
  drawingToken: 'memo-compared',
  projectionToken: 'memo-compared',
  exclusionToken: 'memo-compared',
} as const satisfies Record<
  keyof ParagraphKeyInputs,
  'memo-identity' | 'memo-compared' | 'memo-derived'
>;

interface ParagraphKeyMemoEntry {
  readonly producerIdentity: string;
  readonly width: number;
  readonly drawingIdentity: string;
  readonly projectionIdentity: string;
  readonly exclusionIdentity: string;
  readonly propertiesToken: string;
  readonly key: ParagraphLayoutKey;
}

interface ParagraphKeyMemo {
  readonly entries: ParagraphKeyMemoEntry[];
}

/**
 * Small digest-match memo of compact keys per immutable paragraph/table node.
 *
 * The canonical tree is immutable: an edit replaces the affected node, while unchanged nodes
 * preserve identity. SHA-256 fingerprints every layout-affecting input without serializing an
 * entire OOXML subtree into every cache key. A few slots preserve the common prepass/placement
 * widths; eviction only causes a safe miss.
 */
const paragraphKeyMemos = new WeakMap<object, ParagraphKeyMemo>();
const MAX_PARAGRAPH_KEY_SLOTS = 8;

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
  const projectionToken = inputs.projectionToken ?? '';
  const exclusionToken = inputs.exclusionToken ?? '';
  const properties = reusableLayoutTokenDigest(propertiesToken(inputs.properties));
  const nodeIdentity = nodeLayoutIdentity(inputs.paragraph);
  const producerIdentity = reusableLayoutTokenDigest(inputs.producer);
  const drawingIdentity = reusableLayoutTokenDigest(drawingToken);
  const projectionIdentity = reusableLayoutTokenDigest(projectionToken);
  const exclusionIdentity = reusableLayoutTokenDigest(exclusionToken);
  let memo = paragraphKeyMemos.get(inputs.paragraph);
  const entryIndex = memo?.entries.findIndex(
    (entry) =>
      entry.producerIdentity === producerIdentity &&
      entry.width === width &&
      entry.drawingIdentity === drawingIdentity &&
      entry.projectionIdentity === projectionIdentity &&
      entry.exclusionIdentity === exclusionIdentity &&
      entry.propertiesToken === properties
  );
  if (memo && entryIndex !== undefined && entryIndex >= 0) {
    const [entry] = memo.entries.splice(entryIndex, 1);
    memo.entries.push(entry);
    return entry.key;
  }
  const key = `plk:${nodeIdentity}:${producerIdentity}:${width}:${drawingIdentity}:${projectionIdentity}:${exclusionIdentity}:${properties}`;
  if (!memo) {
    memo = { entries: [] };
    paragraphKeyMemos.set(inputs.paragraph, memo);
  }
  const sharedProperties =
    memo.entries.find((entry) => entry.propertiesToken === properties)?.propertiesToken ??
    properties;
  memo.entries.push({
    producerIdentity,
    width,
    drawingIdentity,
    projectionIdentity,
    exclusionIdentity,
    propertiesToken: sharedProperties,
    key,
  });
  if (memo.entries.length > MAX_PARAGRAPH_KEY_SLOTS) memo.entries.shift();
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
  /** Keep placed breaks for later revisions. Default true; false bounds one-shot exporters. */
  readonly retainAcrossPasses?: boolean;
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
 * one re-keyed paragraph per pass. The tick lives on each cache instance
 * ({@link ParagraphLayoutCache.retentionPassDue}), so interleaved editors in one process
 * cannot starve each other's sweeps.
 */
const RETENTION_PASS_STRIDE = 8;

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
  const retainAcrossPasses = options.retainAcrossPasses ?? true;
  // The absolute ceiling the working-set exemption below cannot exceed: a cache whose
  // owner never (or rarely) retains still may not grow without bound.
  const hardMaxEntries = maxEntries * 8;
  // Insertion order IS the recency order: a hit deletes and re-inserts, so the oldest key
  // is always the first one the iterator yields.
  const entries = new Map<ParagraphLayoutKey, { value: T; generation: number }>();
  let generation = 0;
  let retentionTick = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  return {
    retainAcrossPasses,
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
        // after it is too, so the soft cap yields rather than thrash — up to the hard
        // ceiling, past which memory wins over reuse.
        if (oldest.value[1].generation >= generation && entries.size <= hardMaxEntries) break;
        entries.delete(oldest.value[0]);
        evictions += 1;
      }
    },

    release(key) {
      if (!retainAcrossPasses) entries.delete(key);
    },

    retentionPassDue() {
      retentionTick += 1;
      return retentionTick % RETENTION_PASS_STRIDE === 0;
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
