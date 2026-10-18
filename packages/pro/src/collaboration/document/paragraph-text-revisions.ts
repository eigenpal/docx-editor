/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Tracked revisions in a paragraph's shared text: one attribute for each revision.
 *
 * An insertion, deletion or move around a character is the attribute `v:<wrapper ID>`, not an
 * entry of the wrapper list `w`. Its value names the wrapper and its order among the revisions
 * of the character; each wrapper in `w` names the revisions nested inside it, so a link added
 * around tracked text writes only `w`. Formatting attributes hold one value per key
 * and end where a marker restores the value before them, and an insert writes that marker
 * with the value its author saw. With every revision in `w`, text typed inside another
 * author's pending insertion restored the insertion after itself, and a concurrent accept of
 * the insertion did not reach that marker: the rest of the insertion stayed pending, and the
 * text after it could become part of it.
 *
 * So a write never sets a revision attribute that another author's change owns. A character
 * typed inside a revision it does not belong to keeps the revision's attribute and names the
 * revision in `b`, its superseded revisions, which only inserts write, for their own
 * characters. A strike adds its own attribute next to the ones it is nested in. A decision
 * removes only the attribute of the revision it decides. The pieces of a revision that an edit
 * split are one revision while their contents agree, so a decision reaches every piece.
 *
 * Every value comes from a peer, so reading validates each one and ignores what it cannot
 * trust.
 */
import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { DocumentLimits } from './limits.ts';
import { rejectDangerousKey } from './limits.ts';
import {
  decodeId,
  elementData,
  encodeId,
  isRecord,
  MAX_JSON_DEPTH,
  readElement,
  type JsonValue,
  type Slot,
} from './paragraph-text-codec.ts';
import type { ElementShell } from './paragraph-linear.ts';

/** The attribute key prefix of one revision. */
export const REVISION_PREFIX = 'v:';
/** The attribute that names the revisions a character does not belong to, though it holds them. */
export const SUPERSEDED_KEY = 'b';

/**
 * How many revisions `b` names. Each insert inside or after another author's pending change
 * adds the revisions it leaves, so text two authors extend in turn names one more each turn.
 * A writer keeps the list within this bound, and a reader reads no further.
 */
export const MAX_SUPERSEDED = 512;
const MAX_ORDER = 2 ** 31;

const REVISION_NAMES = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

type Attributes = Readonly<Record<string, string>>;

export function isRevisionWrapper(shell: OoxmlElement): boolean {
  return shell.namespaceUri === WML_NAMESPACE_URI && REVISION_NAMES.has(shell.localName);
}

/**
 * Paragraph-level wrappers a revision cannot hold: `w:ins` and `w:del` admit run content only
 * (CT_RunTrackChange), so a revision always goes inside a link or a simple field.
 */
const OUTSIDE_REVISIONS = new Set(['hyperlink', 'fldSimple']);

function holdsNoRevision(shell: ElementShell): boolean {
  return shell.namespaceUri === WML_NAMESPACE_URI && OUTSIDE_REVISIONS.has(shell.localName);
}

/** An element shell's compact data with its ID relative to `base`, and extra fields. */
export function shellData(
  shell: ElementShell,
  base: string,
  slot: Slot | null,
  extra: { [key: string]: JsonValue } = {}
): { [key: string]: JsonValue } {
  return { i: encodeId(shell.id, base), ...(elementData(shell, slot, false) as object), ...extra };
}

/** A wrapper as compact data: its shell and its fixed children. */
export function wrapperData(
  wrapper: ElementShell,
  paragraphId: string
): { [key: string]: JsonValue } {
  return shellData(wrapper, paragraphId, null, {
    c: wrapper.children.map((child) => elementData(child, null, true)),
  });
}

/** A wrapper `w` keeps, as compact data, with the stored IDs of the revisions inside it. */
export interface PlainWrapper {
  readonly wrapper: ElementShell;
  /** The revisions nested inside it, by stored wrapper ID: its `r`. */
  readonly inside: readonly string[];
  /**
   * For a link or simple field, the revisions around it, by stored wrapper ID: its `x`. A file
   * can nest a link inside a revision, and only this list tells that apart from a revision a
   * peer added without seeing the link, which belongs inside it.
   */
  readonly outside: readonly string[];
}

/**
 * Split `wrap` into the wrappers `w` keeps and one attribute per revision, written into `out`.
 * A revision's order is its place among the character's revisions, outer first. Each wrapper
 * `w` keeps names the revisions nested inside it, so a write that only changes those wrappers,
 * as adding a link around tracked text does, never writes a revision attribute.
 */
export function encodeRevisions(
  wrap: readonly ElementShell[],
  paragraphId: string,
  out: Record<string, string>
): PlainWrapper[] {
  const plain: PlainWrapper[] = [];
  // Two IDs can encode alike, as numbered siblings with and without a leading zero do; the
  // later wrapper is then stored by its whole ID, in its key, its value and every `r` list, so
  // no revision replaces or hides another.
  const used = new Set<string>();
  const stored = wrap.map((wrapper) => {
    const encoded = encodeId(wrapper.id, paragraphId);
    const id = used.has(encoded) ? `!${wrapper.id}` : encoded;
    used.add(id);
    return id;
  });
  let order = 0;
  wrap.forEach((wrapper, index) => {
    if (!isRevisionWrapper(wrapper)) {
      const inside = stored.filter((_, inner) => inner > index && isRevisionWrapper(wrap[inner]!));
      const outside = holdsNoRevision(wrapper)
        ? stored.filter((_, outer) => outer < index && isRevisionWrapper(wrap[outer]!))
        : [];
      plain.push({ wrapper, inside, outside });
      return;
    }
    order += 1;
    out[`${REVISION_PREFIX}${stored[index]!}`] = JSON.stringify({
      e: { ...wrapperData(wrapper, paragraphId), i: stored[index]! },
      d: order,
    });
  });
  return plain;
}

/** A plain wrapper's `r` (or `x`): the stored IDs of the revisions it holds (or sits in). */
export function insideOf(
  entry: unknown,
  limits: DocumentLimits,
  paragraphId: string,
  key: 'r' | 'x' = 'r'
): Set<string> {
  const ids = new Set<string>();
  const data = isRecord(entry) ? entry[key] : undefined;
  if (!Array.isArray(data)) return ids;
  for (const value of data.slice(0, MAX_JSON_DEPTH)) {
    const id = decodeId(value, paragraphId, limits);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/** One revision attribute of a character, as read. */
export interface RevisionEntry {
  readonly key: string;
  readonly shell: ElementShell;
  /** The wrapper's ID as stored, relative to the paragraph. */
  readonly encodedId: string;
  /** Its order among the character's revisions: an inner one has a greater order. */
  readonly order: number;
  /** What makes two pieces one revision: the wrapper's data without its ID. */
  readonly content: string;
  /** What makes two items one wrapper element: the revision's content, as for `content`. */
  readonly signature: string;
}

/** A shared value as JSON, or undefined for one that is not a string or does not parse. */
export function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** The longest revision value a reader parses: a wrapper shell with its attributes. */
const MAX_REVISION_VALUE = 1 << 16;

/** The longest wrapper ID `b` names; one the writer encodes is far shorter. */
const MAX_SUPERSEDED_ID = 4096;

/**
 * The keys a character's `b` names, or none for a value that does not parse. A longer list
 * keeps its first entries, so one entry too many never makes every superseded revision count.
 * It reads alike under every session's limits, as `revisionTrail` must read it too.
 */
function supersededKeys(value: unknown): Set<string> {
  const keys = new Set<string>();
  // No list the bounds admit is longer, so a longer value is never parsed.
  if (typeof value !== 'string' || value.length > MAX_SUPERSEDED * (MAX_SUPERSEDED_ID + 3)) {
    return keys;
  }
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return keys;
  for (const entry of parsed.slice(0, MAX_SUPERSEDED)) {
    if (typeof entry !== 'string' || entry.length > MAX_SUPERSEDED_ID) continue;
    if (rejectDangerousKey(entry)) continue;
    keys.add(`${REVISION_PREFIX}${entry}`);
  }
  return keys;
}

/**
 * The revision keys a reader looks at: those `b` does not name, in key order. Every one is a
 * candidate: the reader stops after the revisions a wrapper chain holds that read, so keys a
 * peer stored that do not read never hide one that does, and the work stays linear in what
 * the character stores.
 */
function liveKeys(attributes: Readonly<Record<string, unknown>>): string[] {
  const superseded = supersededKeys(attributes[SUPERSEDED_KEY]);
  return Object.keys(attributes)
    .filter(
      (key) => key.startsWith(REVISION_PREFIX) && !rejectDangerousKey(key) && !superseded.has(key)
    )
    .sort();
}

const WRAPPER_SLOT: Slot | null = null;

/** A revision's order: a whole number from 1 to `MAX_ORDER`. */
function isOrder(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_ORDER
  );
}

function readEntry(
  key: string,
  value: unknown,
  limits: DocumentLimits,
  paragraphId: string
): RevisionEntry | null {
  // A value past this is never one a writer encodes, so it is never parsed.
  if (typeof value !== 'string' || value.length > MAX_REVISION_VALUE) return null;
  const data = parseJson(value);
  if (!isRecord(data) || !isRecord(data.e)) return null;
  const order = data.d;
  if (!isOrder(order)) return null;
  const { i: encodedId, ...element } = data.e;
  const id = decodeId(encodedId, paragraphId, limits);
  if (id === null) return null;
  const shell = readElement(element, id, WRAPPER_SLOT, limits, { nodes: 0 }, 0);
  if (!shell || shell.kind === 'textValue' || !isRevisionWrapper(shell)) return null;
  return {
    key,
    shell,
    encodedId: encodedId as string,
    order,
    content: JSON.stringify(element),
    // Two pieces of one revision side by side are one element, whichever wrapper IDs their
    // keys keep: an edit splits a revision into pieces, and writes never rename a kept one.
    signature: JSON.stringify(element),
  };
}

/**
 * The revisions a character belongs to, outer first: its revision attributes that `b` does
 * not name, by order and then key. A superseded attribute is never read, so however many a
 * character holds, they never push out one it belongs to; and a character shows no more
 * revisions than a wrapper chain holds.
 */
export function readRevisions(
  attributes: Readonly<Record<string, unknown>>,
  limits: DocumentLimits,
  paragraphId: string
): RevisionEntry[] {
  const entries: RevisionEntry[] = [];
  // Valid entries count toward the cap, so keys that do not read never push one out.
  for (const key of liveKeys(attributes)) {
    const entry = readEntry(key, attributes[key], limits, paragraphId);
    if (entry) entries.push(entry);
    if (entries.length === MAX_JSON_DEPTH) break;
  }
  return entries.sort(byOrder);
}

function byOrder(left: RevisionEntry, right: RevisionEntry): number {
  return left.order - right.order || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

/**
 * The wrapper chain of a character: the wrappers `w` keeps, with each revision placed inside
 * the innermost of them whose `r` names it, or outermost, and revisions placed at one place in
 * their order.
 */
export function placeRevisions(
  plain: readonly {
    readonly shell: ElementShell;
    readonly signature: string;
    readonly inside: ReadonlySet<string>;
    readonly outside?: ReadonlySet<string>;
  }[],
  revisions: readonly RevisionEntry[]
): { readonly shell: ElementShell; readonly signature: string }[] {
  /** Each placed revision names the wrapper it was placed inside, or null for outermost. */
  const chain: {
    readonly shell: ElementShell;
    readonly signature: string;
    readonly inside?: ReadonlySet<string>;
    readonly outside?: ReadonlySet<string>;
    anchor?: string | null;
  }[] = [...plain];
  // The whole chain stays as deep as a writer encodes, outer wrappers first.
  for (const revision of revisions.slice(0, Math.max(0, MAX_JSON_DEPTH - plain.length))) {
    let at = 0;
    let anchor: string | null = null;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      if (chain[index]!.inside?.has(revision.shell.id)) {
        at = index + 1;
        anchor = chain[index]!.shell.id;
        break;
      }
    }
    // A revision no wrapper names, as one a peer made while another wrapped the text in a
    // link, still goes inside every link and simple field above it, unless the writer of
    // that link put it around the link, as a file can.
    const around = chain.some((entry) => entry.outside?.has(revision.shell.id));
    for (let index = chain.length - 1; index >= at && !around; index -= 1) {
      if (chain[index]!.anchor === undefined && holdsNoRevision(chain[index]!.shell)) {
        at = index + 1;
        anchor = chain[index]!.shell.id;
        break;
      }
    }
    // Revisions placed inside the same wrapper keep their order, as two peers' strikes of the
    // same words do: the later one goes inside the earlier one.
    while (at < chain.length && chain[at]!.anchor === anchor) at += 1;
    // Two stored IDs can name one wrapper; one element never nests inside itself.
    if (chain.some((entry) => entry.shell.id === revision.shell.id)) continue;
    chain.splice(at, 0, { shell: revision.shell, signature: revision.signature, anchor });
  }
  return chain.map(({ shell, signature }) => ({ shell, signature }));
}

// ---------------------------------------------------------------------------------------------
// Writing against the attributes a character already has

/** How a write's revisions match the ones a character has. */
interface Match {
  readonly kept: ReadonlySet<RevisionEntry>;
  /** Wanted revisions the character does not have, in order, each with its wanted value. */
  readonly added: readonly RevisionEntry[];
  /** The stored wrapper ID of each kept revision, by the wrapper ID the write gives it. */
  readonly renamed: ReadonlyMap<string, string>;
}

/**
 * Match the wanted revisions to the character's own. A wanted revision the character has,
 * under its own key or another, as a piece of a revision an edit split has, matches by content
 * and is kept as stored, whatever its place among the others.
 */
function matchRevisions(have: readonly RevisionEntry[], wanted: readonly RevisionEntry[]): Match {
  const kept = new Set<RevisionEntry>();
  const added: RevisionEntry[] = [];
  const renamed = new Map<string, string>();
  for (const entry of wanted) {
    const found = have.find((own) => !kept.has(own) && own.content === entry.content);
    if (found) {
      kept.add(found);
      renamed.set(entry.encodedId, found.encodedId);
    } else {
      added.push(entry);
    }
  }
  return { kept, added, renamed };
}

/** The attributes other than revisions and `b`. */
export function withoutRevisions(attributes: Attributes): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(attributes)) {
    if (!key.startsWith(REVISION_PREFIX) && key !== SUPERSEDED_KEY) out[key] = attributes[key]!;
  }
  return out;
}

/** Whether attributes hold any revision attribute or `b`. */
export function hasRevisions(attributes: Readonly<Record<string, unknown>>): boolean {
  for (const key of Object.keys(attributes)) {
    if (key.startsWith(REVISION_PREFIX) || key === SUPERSEDED_KEY) return true;
  }
  return false;
}

/**
 * Whether two `w` values hold the same wrappers and nest the revisions in `holds` alike. Then
 * the stored one stays: an `r` that still names a revision the character left places nothing,
 * so a decision does not write `w` again.
 */
function sameWrappers(
  have: string | undefined,
  wanted: string | undefined,
  holds: ReadonlySet<string>
): boolean {
  if (have === wanted) return true;
  const left = parseJson(have ?? '[]');
  const right = parseJson(wanted ?? '[]');
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((entry, at) => {
    const other = right[at];
    if (!isRecord(entry) || !isRecord(other)) return false;
    const { r: leftInside, ...leftWrapper } = entry;
    const { r: rightInside, ...rightWrapper } = other;
    if (JSON.stringify(leftWrapper) !== JSON.stringify(rightWrapper)) return false;
    const held = (inside: unknown) =>
      (Array.isArray(inside) ? inside : []).filter((id) => holds.has(id as string)).sort();
    return JSON.stringify(held(leftInside)) === JSON.stringify(held(rightInside));
  });
}

/** A wanted revision's value with another order. */
function reordered(value: string, order: number): string {
  const data = JSON.parse(value) as Record<string, JsonValue>;
  return JSON.stringify({ ...data, d: order });
}

/**
 * The wanted `w` with each `r` naming the kept revisions by their stored wrapper IDs, so a
 * reader finds them inside their wrappers. Unchanged when no kept revision was renamed.
 */
function renamedInside(value: string | undefined, renamed: ReadonlyMap<string, string>) {
  if (value === undefined || ![...renamed].some(([from, to]) => from !== to)) return value;
  const data = parseJson(value);
  if (!Array.isArray(data)) return value;
  return JSON.stringify(
    data.map((entry) =>
      isRecord(entry) && Array.isArray(entry.r)
        ? {
            ...entry,
            r: entry.r.map((id) => (typeof id === 'string' ? (renamed.get(id) ?? id) : id)),
          }
        : entry
    )
  );
}

function supersededValue(keys: ReadonlySet<string>): string {
  return JSON.stringify([...keys].map((key) => key.slice(REVISION_PREFIX.length)).sort());
}

/**
 * The attributes to write for a character: `wanted` as the editor's tree encodes it, with the
 * revision attributes of `have`, the character's own attributes or, for an insert, those of
 * the character it is typed after, changed only as far as the revisions it belongs to change.
 *
 * An existing character loses the attribute of each revision it leaves, which is the write a
 * decision makes. An inserted character keeps every attribute it would take from its left,
 * and names in `b` each revision it does not belong to: an insert writes markers only for its
 * own keys and for `b`, which no other write sets on these characters. A revision the
 * character joins gets an order after all of its others.
 */
export function rebaseRevisions(
  have: Attributes,
  wanted: Attributes,
  inserted: boolean,
  limits: DocumentLimits,
  paragraphId: string
): Attributes {
  if (!hasRevisions(have)) return wanted;
  const effective = readRevisions(have, limits, paragraphId);
  const goal = readRevisions(wanted, limits, paragraphId);
  const out = withoutRevisions(wanted);
  for (const key of Object.keys(have)) {
    if (key.startsWith(REVISION_PREFIX)) out[key] = have[key]!;
  }
  const superseded = supersededKeys(have[SUPERSEDED_KEY]);
  const { kept, added, renamed } = matchRevisions(effective, goal);
  for (const entry of effective) {
    if (kept.has(entry)) continue;
    if (inserted) superseded.add(entry.key);
    else delete out[entry.key];
  }
  // A kept revision is never written again. Writing it would set that revision's attribute
  // over these characters and restore it after them, and a decision on the revision that a peer
  // makes at the same time would not reach those markers. Where the tree nests it among the
  // other wrappers lives in their `r` lists instead, in `w`, which names it by its stored ID; a
  // link added around it writes only `w`. A revision the character joins goes inside all of its
  // others.
  const wrap = renamedInside(out.w, renamed);
  if (wrap !== undefined) out.w = wrap;
  const holds = new Set(
    [...kept].map((entry) => entry.encodedId).concat(added.map((entry) => entry.encodedId))
  );
  if (sameWrappers(have.w, out.w, holds)) {
    if (have.w === undefined) delete out.w;
    else out.w = have.w;
  }
  let order = effective.reduce((highest, entry) => Math.max(highest, entry.order), 0);
  let rejoined = false;
  for (const entry of added) {
    // At the bound, later revisions share the last order and read in key order.
    order = Math.min(order + 1, MAX_ORDER);
    out[entry.key] = reordered(wanted[entry.key]!, order);
    rejoined = superseded.delete(entry.key) || rejoined;
  }
  // An existing character keeps its stored `b`, in whatever form a peer wrote it, unless it
  // joins a revision `b` names: only inserts write `b`, so two decisions on these characters
  // never both write it.
  if (!inserted && !rejoined) {
    if (have[SUPERSEDED_KEY] !== undefined) out[SUPERSEDED_KEY] = have[SUPERSEDED_KEY];
    return out;
  }
  // Past the bound, the character stops holding the revisions that sort last. It writes their
  // attributes away, which a reader would otherwise count as revisions it belongs to.
  if (superseded.size > MAX_SUPERSEDED) {
    const names = [...superseded].sort();
    for (const key of names.slice(MAX_SUPERSEDED)) {
      superseded.delete(key);
      delete out[key];
    }
  }
  if (superseded.size > 0) {
    const value = supersededValue(superseded);
    out[SUPERSEDED_KEY] =
      have[SUPERSEDED_KEY] !== undefined &&
      supersededValue(supersededKeys(have[SUPERSEDED_KEY])) === value
        ? have[SUPERSEDED_KEY]
        : value;
  }
  return out;
}

/** Trails by paragraph and revision attributes, per limits, as decoded attributes are cached. */
const trails = new WeakMap<DocumentLimits, Map<string, string>>();
const MAX_TRAIL_CACHE = 4096;

/** The revision attributes and `b` of a character, as one string in key order. */
function revisionSignature(attributes: Attributes): string {
  const parts: string[] = [];
  for (const key of Object.keys(attributes).sort()) {
    if (key.startsWith(REVISION_PREFIX) || key === SUPERSEDED_KEY) {
      parts.push(JSON.stringify([key, attributes[key]]));
    }
  }
  return parts.join(',');
}

/**
 * The revisions a character belongs to, outer first, as one string: equal for two characters
 * in the same revisions, whatever their wrapper IDs or orders. It ranks the alignments of an
 * edit and keys empty elements, and reads through `readRevisions`, so it names exactly the
 * revisions a reader shows.
 */
export function revisionTrail(
  attributes: Attributes,
  limits: DocumentLimits,
  paragraphId: string
): string {
  if (!hasRevisions(attributes)) return '[]';
  let cache = trails.get(limits);
  if (!cache) trails.set(limits, (cache = new Map()));
  const key = `${paragraphId}\u0000${revisionSignature(attributes)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const revisions = readRevisions(attributes, limits, paragraphId);
  const trail = JSON.stringify(revisions.map((entry) => entry.content));
  if (cache.size >= MAX_TRAIL_CACHE) cache.clear();
  cache.set(key, trail);
  return trail;
}
