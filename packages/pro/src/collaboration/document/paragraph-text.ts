/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The shared form of a paragraph's inline content (openspec `paragraph-text-collaboration`).
 *
 * A paragraph's inline sequence (`paragraph-linear.ts`) is stored in one shared text. A
 * character is a character; an inline element that is not text is an embed naming its
 * registry node; an element that holds no content is an anchor. Everything around an item
 * is a formatting attribute on it, as JSON:
 *
 * - `r`: the run element without children.
 * - `rp`: the run's `w:rPr` without children, and the order of its properties.
 * - `p:<namespace>|<local name>`: one property element of that `w:rPr`, with its subtree.
 * - `t`: the text element without children, and the ID of its text value.
 * - `w`: the wrappers around the item, outer to inner, each with its fixed children.
 *
 * Two peers formatting the same characters then merge property by property, and a deletion
 * removes only the characters its author saw. Every value comes from a peer, so decoding
 * validates shape, size and depth, and drops what it cannot trust instead of throwing.
 */
import {
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { emptyWmlElement, expectElement, withChildren } from './node-shapes.ts';
import { rejectDangerousKey, type DocumentLimits } from './limits.ts';
import { asLogicalId, type LogicalId } from './identity.ts';
import {
  decodeId,
  elementData,
  encodeId,
  isRecord,
  MAX_JSON_DEPTH,
  namespaceCode,
  namespaceFromCode,
  readElement,
  RUN_PROPERTIES_SLOT,
  RUN_SLOT,
  TEXT_SLOT,
  type JsonValue,
  type Slot,
} from './paragraph-text-codec.ts';
import type { ElementShell, LinearAttributes, LinearItem } from './paragraph-linear.ts';

/** The record field that holds a paragraph's shared inline text. */
export const INLINE_FIELD = 'inline';

const KEY_RUN = 'r';
const KEY_RUN_PROPERTIES = 'rp';
const KEY_TEXT = 't';
const KEY_WRAP = 'w';
const PROPERTY_PREFIX = 'p:';

export type InlineAttributes = Readonly<Record<string, string>>;

/**
 * An embedded registry node, with `r: 1` when it belongs in a run, or an anchor. Run
 * placement is part of the content, because formatting can move a run attribute.
 */
export type InlineEmbed = { readonly n: string; readonly r?: 1 } | { readonly a: 1 };

/** The shared text content of a non-character item. */
export function embedContent(item: LinearItem): InlineEmbed {
  if (item.kind !== 'embed') return { a: 1 };
  return item.attributes.run ? { n: item.node.id, r: 1 } : { n: item.node.id };
}

export interface InlineDeltaOp {
  readonly insert: string | InlineEmbed;
  readonly attributes?: InlineAttributes;
}

// ---------------------------------------------------------------------------------------------
// Encoding

/** An element shell's compact data with its ID relative to `base`, and extra fields. */
function shellData(
  shell: ElementShell,
  base: string,
  slot: Slot | null,
  extra: { [key: string]: JsonValue } = {}
): { [key: string]: JsonValue } {
  return { i: encodeId(shell.id, base), ...(elementData(shell, slot, false) as object), ...extra };
}

/**
 * The attribute key of one run property: `p:` and the local name for WordprocessingML,
 * `p:<namespace code>|<local name>` otherwise. A repeated name gets a counter.
 */
function propertyKeys(properties: readonly OoxmlElement[]): string[] {
  const seen = new Map<string, number>();
  return properties.map((property) => {
    const code = namespaceCode(property.namespaceUri);
    const base = `${PROPERTY_PREFIX}${code === '' ? '' : `${code}|`}${property.localName}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}#${count}`;
  });
}

/** The namespace and local name a property key names, or null for a key it cannot read. */
function propertyName(key: string): { namespaceUri: string; localName: string } | null {
  const name = key.slice(PROPERTY_PREFIX.length).replace(/#\d+$/, '');
  const bar = name.indexOf('|');
  const namespaceUri = namespaceFromCode(bar < 0 ? '' : name.slice(0, bar));
  const localName = bar < 0 ? name : name.slice(bar + 1);
  if (namespaceUri === null || localName.length === 0) return null;
  return { namespaceUri, localName };
}

/**
 * One item's attributes in shared form. Shell IDs are relative to the paragraph, never to
 * each other: concurrent formatting can pair one run's `w:rPr` with another run.
 */
export function encodeAttributes(
  attributes: LinearAttributes,
  paragraphId: string
): InlineAttributes {
  const out: Record<string, string> = {};
  const run = attributes.run;
  if (run) out[KEY_RUN] = JSON.stringify(shellData(run, paragraphId, RUN_SLOT));
  if (run && attributes.runProperties) {
    const keys = propertyKeys(attributes.properties);
    out[KEY_RUN_PROPERTIES] = JSON.stringify(
      shellData(attributes.runProperties, paragraphId, RUN_PROPERTIES_SLOT, { o: keys })
    );
    attributes.properties.forEach((property, index) => {
      const slot = { kind: 'generic', localName: property.localName };
      out[keys[index]!] = JSON.stringify(elementData(property, slot, true));
    });
  }
  if (attributes.text) {
    const textId = attributes.text.id;
    const valueId = attributes.textValueId ?? `${textId}~v`;
    const extra: { [key: string]: JsonValue } =
      valueId === `${textId}~v` ? {} : { v: encodeId(valueId, textId) };
    out[KEY_TEXT] = JSON.stringify(shellData(attributes.text, paragraphId, TEXT_SLOT, extra));
  }
  if (attributes.wrap.length > 0) {
    out[KEY_WRAP] = JSON.stringify(
      attributes.wrap.map((wrapper) =>
        shellData(wrapper, paragraphId, null, {
          c: wrapper.children.map((child) => elementData(child, null, true)),
        })
      )
    );
  }
  return out;
}

/** The shared text's content for one inline sequence, consecutive equal attributes merged. */
export function encodeItems(items: readonly LinearItem[], paragraphId: string): InlineDeltaOp[] {
  const ops: InlineDeltaOp[] = [];
  let pending: { text: string; attributes: InlineAttributes; signature: string } | null = null;
  const flush = (): void => {
    if (pending) ops.push({ insert: pending.text, attributes: pending.attributes });
    pending = null;
  };
  for (const item of items) {
    const attributes = encodeAttributes(item.attributes, paragraphId);
    if (item.kind === 'char') {
      const signature = attributeSignature(attributes);
      if (pending && pending.signature === signature) pending.text += item.value;
      else {
        flush();
        pending = { text: item.value, attributes, signature };
      }
      continue;
    }
    flush();
    ops.push({ insert: embedContent(item), attributes });
  }
  flush();
  return ops;
}

/** Equal attribute sets give equal signatures, whatever order their keys were written in. */
export function attributeSignature(attributes: InlineAttributes | undefined): string {
  if (!attributes) return '';
  return Object.keys(attributes)
    .sort()
    .map((key) => `${key}\u0000${attributes[key]}`)
    .join('\u0001');
}

// ---------------------------------------------------------------------------------------------
// Decoding

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** A shell with its ID resolved against `base`, or null for data it cannot trust. */
function readShell(
  value: unknown,
  base: string,
  slot: Slot | null,
  limits: DocumentLimits,
  withChildren = false
): { shell: ElementShell; data: Record<string, unknown> } | null {
  if (!isRecord(value)) return null;
  const id = decodeId(value.i, base, limits);
  if (!id) return null;
  const { i: _id, v: _value, o: _order, c: children, ...element } = value;
  const read = readElement(
    withChildren ? { ...element, c: children } : element,
    id,
    slot,
    limits,
    { nodes: 0 },
    0
  );
  if (!read || read.kind === 'textValue') return null;
  return { shell: read as ElementShell, data: value };
}

/** `CT_RPr`'s element order (ECMA-376 Part 1, 17.3.2.28), for properties without a recorded order. */
const RUN_PROPERTY_ORDER = [
  'rStyle',
  'rFonts',
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'noProof',
  'snapToGrid',
  'vanish',
  'webHidden',
  'color',
  'spacing',
  'w',
  'kern',
  'position',
  'sz',
  'szCs',
  'highlight',
  'u',
  'effect',
  'bdr',
  'shd',
  'fitText',
  'vertAlign',
  'rtl',
  'cs',
  'em',
  'lang',
  'eastAsianLayout',
  'specVanish',
  'oMath',
  'rPrChange',
];

function schemaRank(key: string): number {
  const name = propertyName(key);
  const at =
    name?.namespaceUri === WML_NAMESPACE_URI ? RUN_PROPERTY_ORDER.indexOf(name.localName) : -1;
  // Names outside the schema's list follow it, in name order; `w:rPrChange` stays last.
  return at < 0 ? RUN_PROPERTY_ORDER.length - 1 : at;
}

function bySchemaOrder(left: string, right: string): number {
  return schemaRank(left) - schemaRank(right) || (left < right ? -1 : left > right ? 1 : 0);
}

function runPropertiesShell(id: string): ElementShell {
  return emptyWmlElement(id, 'runProperties', 'rPr');
}

/** Decoded attribute sets, per limits: a decode under one session's limits is not another's. */
const decodedAttributes = new WeakMap<DocumentLimits, Map<string, LinearAttributes>>();
const MAX_DECODED_CACHE = 4096;

/**
 * One item's attributes from shared form. Unknown or untrusted parts are dropped, so a bad
 * value from a peer shows its characters as plain text rather than ending the session.
 */
export function decodeAttributes(
  attributes: Readonly<Record<string, unknown>> | undefined,
  limits: DocumentLimits,
  paragraphId: string
): LinearAttributes {
  // IDs are relative to the paragraph, so one attribute set reads differently in each.
  const signature = `${paragraphId}\u0002${attributeSignature(attributes as InlineAttributes | undefined)}`;
  let cache = decodedAttributes.get(limits);
  if (!cache) decodedAttributes.set(limits, (cache = new Map()));
  const cached = cache.get(signature);
  if (cached) return cached;
  const decoded = decodeUncached(attributes ?? {}, limits, paragraphId);
  if (cache.size >= MAX_DECODED_CACHE) cache.clear();
  cache.set(signature, decoded);
  return decoded;
}

function decodeUncached(
  attributes: Readonly<Record<string, unknown>>,
  limits: DocumentLimits,
  paragraphId: string
): LinearAttributes {
  const run = readShell(parseJson(attributes[KEY_RUN]), paragraphId, RUN_SLOT, limits);
  const recordedShell = run
    ? readShell(parseJson(attributes[KEY_RUN_PROPERTIES]), paragraphId, RUN_PROPERTIES_SLOT, limits)
    : null;
  const properties: OoxmlElement[] = [];
  const propertyKeysShown: string[] = [];
  // A peer writes these keys: as many as a `w:rPr` may hold children, cut in one order on
  // every replica, and one decode budget for all of them, so more keys buy no more decoding.
  const keys = run
    ? Object.keys(attributes)
        .filter((key) => key.startsWith(PROPERTY_PREFIX))
        .sort()
        .slice(0, limits.maxChildren)
    : [];
  const budget = { nodes: 0 };
  // The `w:rPr` shell and its property order are one attribute that a peer's formatting range
  // can reset at its end while another peer's properties stay. Properties never depend on
  // it: without it the run gets a plain `w:rPr`, and properties take the schema's order.
  const runProperties =
    recordedShell?.shell ??
    (run && keys.length > 0 ? runPropertiesShell(`${run.shell.id}~rPr`) : null);
  if (run && runProperties) {
    const recorded = Array.isArray(recordedShell?.data.o)
      ? (recordedShell!.data.o as unknown[])
      : [];
    const ordered = keys.every((key) => recorded.includes(key))
      ? recorded.filter((key): key is string => typeof key === 'string' && keys.includes(key))
      : [...keys].sort(bySchemaOrder);
    for (const key of ordered) {
      const name = propertyName(key);
      if (!name || rejectDangerousKey(key)) continue;
      const element = readElement(
        parseJson(attributes[key]),
        `${runProperties.id}~${key}`,
        { kind: 'generic', localName: name.localName },
        limits,
        budget,
        0
      );
      if (element && element.kind !== 'textValue') {
        properties.push(element);
        propertyKeysShown.push(key);
      }
    }
  }
  const textData = parseJson(attributes[KEY_TEXT]);
  const text = readShell(textData, paragraphId, TEXT_SLOT, limits);
  const textValueId = text
    ? ((isRecord(textData) && textData.v !== undefined
        ? decodeId(textData.v, text.shell.id, limits)
        : null) ?? `${text.shell.id}~v`)
    : null;
  const wrapData = parseJson(attributes[KEY_WRAP]);
  const wrap: ElementShell[] = [];
  const wrapSignatures: string[] = [];
  if (Array.isArray(wrapData) && wrapData.length <= MAX_JSON_DEPTH) {
    for (const entry of wrapData) {
      const shell = readShell(entry, paragraphId, null, limits, true);
      if (!shell) break;
      wrap.push(shell.shell);
      wrapSignatures.push(JSON.stringify(entry));
    }
  }
  const runSignature = run
    ? [
        attributes[KEY_RUN],
        attributes[KEY_RUN_PROPERTIES] ?? '',
        ...propertyKeysShown.map((key) => `${key}\u0000${String(attributes[key])}`),
      ].join('\u0001')
    : undefined;
  return Object.freeze({
    run: run?.shell ?? null,
    runProperties: properties.length > 0 || recordedShell ? runProperties : null,
    properties: Object.freeze(properties),
    text: text?.shell ?? null,
    textValueId,
    wrap: Object.freeze(wrap),
    ...(runSignature !== undefined ? { runSignature } : {}),
    wrapSignatures: Object.freeze(wrapSignatures),
  });
}

/** One piece of following text as it shows: its items, each with the pieces placed at it. */
export interface ShownPiece {
  readonly entries: readonly {
    /** Absent for a character that cannot show, which still holds the pieces at it. */
    readonly item: LinearItem | undefined;
    /** For an embed, whether it sits inside its run, as `placements` reads it. */
    readonly placement: boolean | undefined;
    readonly slot?: ShownSlot;
    /** For a character, the shared character it shows. */
    readonly character?: SharedCharacter;
  }[];
}

/** A character of a paragraph's shared text: its Yjs item ID and its identity. */
export interface SharedCharacter {
  readonly item: string;
  readonly identity: string | null;
}

/** The pieces that show before and after one character. */
export interface ShownSlot {
  readonly before: readonly ShownPiece[];
  readonly after: readonly ShownPiece[];
}

/** What of a shared text shows, and text from other paragraphs that shows in it. */
export interface DecodeView {
  /** Positions of the text that do not show. */
  readonly hidden?: ReadonlySet<number>;
  /** Text that follows a move, where `placeFollowingText` places it. */
  readonly following?: {
    /** The pieces at each position of the text. */
    readonly at: ReadonlyMap<number, ShownSlot>;
    /** Pieces whose place is not shown here: they show at the end. */
    readonly atEnd: readonly ShownPiece[];
  };
  /** Called when the text needs a repair to show. */
  readonly onRepair?: () => void;
  /** The item ID and identity of the text's own character at each position. */
  readonly characters?: {
    readonly items: readonly string[];
    readonly ids: readonly (string | null)[];
  };
  /** Called with the shared character behind each character shown, in the order shown. */
  readonly onCharacter?: (character: SharedCharacter | null) => void;
}

/** The inline sequence a shared text holds. `embedOf` resolves an embed's registry node. */
export function decodeItems(
  delta: readonly { readonly insert?: unknown; readonly attributes?: Record<string, unknown> }[],
  embedOf: (logicalId: LogicalId) => OoxmlNode | null,
  limits: DocumentLimits,
  paragraphId: string,
  view: DecodeView = {}
): readonly LinearItem[] {
  const items: LinearItem[] = [];
  const placements: RunPlacement[] = [];
  // The placement nests pieces only as deep as its limit and never in a cycle.
  const show = (piece: ShownPiece): void => {
    for (const entry of piece.entries) {
      for (const inner of entry.slot?.before ?? []) show(inner);
      if (entry.item) {
        items.push(entry.item);
        placements.push(entry.placement);
        if (entry.item.kind === 'char') view.onCharacter?.(entry.character ?? null);
      }
      for (const inner of entry.slot?.after ?? []) show(inner);
    }
  };
  const follow = (position: number, before = false): void => {
    const slot = view.following?.at.get(position);
    for (const piece of (before ? slot?.before : slot?.after) ?? []) show(piece);
  };
  let position = 0;
  for (const op of delta) {
    const attributes = decodeAttributes(op.attributes, limits, paragraphId);
    if (typeof op.insert === 'string') {
      for (let at = 0; at < op.insert.length; at += 1, position += 1) {
        if (view.hidden?.has(position)) continue;
        follow(position, true);
        items.push({ kind: 'char', value: op.insert[at]!, attributes });
        placements.push(undefined);
        if (view.onCharacter) {
          const item = view.characters?.items[position];
          view.onCharacter(
            item === undefined ? null : { item, identity: view.characters?.ids[position] ?? null }
          );
        }
        follow(position);
      }
      continue;
    }
    position += 1;
    if (view.hidden?.has(position - 1) || !isRecord(op.insert)) continue;
    if (op.insert.a === 1) {
      items.push({ kind: 'anchor', attributes });
      placements.push(undefined);
      continue;
    }
    const id = op.insert.n;
    if (typeof id !== 'string' || rejectDangerousKey(id)) continue;
    const node = embedOf(asLogicalId(id));
    if (!node) continue;
    items.push({ kind: 'embed', node, attributes });
    placements.push(op.insert.r === 1);
  }
  // Text whose place is not shown here still shows, at the end.
  for (const piece of view.following?.atEnd ?? []) show(piece);
  return repairItems(items, placements, paragraphId, view.onRepair);
}

/**
 * Give every inline node one ID. A run, text element or wrapper whose characters a
 * concurrent edit separated appears more than once; later occurrences get a suffix.
 * Embedded registry nodes keep theirs, because their IDs are their shared identity.
 * `shownId` gives the ID a shell shows in this paragraph when other paragraphs hold it too.
 */
export function uniqueInlineIds(
  paragraph: OoxmlElement,
  embedded: ReadonlySet<string>,
  shownId: (id: string) => string = (id) => id
): OoxmlElement {
  const used = new Set<string>();
  const visit = (node: OoxmlNode, renamed: { from: string; to: string } | null): OoxmlNode => {
    if (embedded.has(node.id)) return node;
    // A child's ID derives from its parent's: `~` for a shell part, `/value` for text.
    const derived =
      renamed !== null &&
      node.id.startsWith(renamed.from) &&
      (node.id[renamed.from.length] === '~' || node.id[renamed.from.length] === '/');
    let id = derived
      ? `${renamed.to}${node.id.slice(renamed.from.length)}`
      : node === paragraph
        ? node.id
        : shownId(node.id);
    if (used.has(id)) {
      let count = 2;
      while (used.has(`${id}~${count}`)) count += 1;
      id = `${id}~${count}`;
    }
    used.add(id);
    if (node.kind === 'textValue') return id === node.id ? node : Object.freeze({ ...node, id });
    const rename = id === node.id ? null : { from: node.id, to: id };
    const children = node.children.map((child) => visit(child, rename));
    const same =
      rename === null && children.every((child, index) => child === node.children[index]);
    return same ? node : Object.freeze(withChildren(node, Object.freeze(children), id));
  };
  return expectElement(visit(paragraph, null));
}

/**
 * Structure that shared text formatting cannot keep by itself.
 *
 * A run and its text element are formatting attributes of each character, and shared text
 * gives a character inserted beside a peer's concurrent insert the formatting in force where
 * it lands. So a character can arrive with no run, a run with no text element, or a break
 * that belongs in a run outside one. Dropping it loses text and leaving it there is invalid
 * WordprocessingML. Each such item takes its run and text element from its nearest neighbor
 * that has them, as typing takes the formatting around it, or from new shells when the
 * paragraph has none. Every replica reads the same text, so every replica repairs it alike;
 * the next local edit of the paragraph writes the repair back to the shared text.
 */

/** An embedded node that the shared text records as run content, or as not run content. */
export type RunPlacement = boolean | undefined;

function needsRun(item: LinearItem, placement: RunPlacement): boolean {
  return item.kind === 'char' || (item.kind === 'embed' && placement === true);
}

function needsText(item: LinearItem): boolean {
  return item.kind === 'char';
}

function withoutRun(attributes: LinearAttributes): LinearAttributes {
  return Object.freeze({
    run: null,
    runProperties: null,
    properties: Object.freeze([]),
    text: null,
    textValueId: null,
    wrap: attributes.wrap,
    ...(attributes.wrapSignatures ? { wrapSignatures: attributes.wrapSignatures } : {}),
  });
}

function withRun(
  attributes: LinearAttributes,
  donor: LinearAttributes | null,
  run: ElementShell
): LinearAttributes {
  return Object.freeze({
    ...attributes,
    run: donor?.run ?? run,
    runProperties: donor?.runProperties ?? null,
    properties: donor?.properties ?? Object.freeze([]),
    ...(donor?.runSignature !== undefined ? { runSignature: donor.runSignature } : {}),
  }) as LinearAttributes;
}

/**
 * The items with every run and text element in place. `placements[i]` says whether embed
 * `i` belongs in a run; `fallbackId` names shells the paragraph has no neighbor to lend.
 */
function repairItems(
  items: readonly LinearItem[],
  placements: readonly RunPlacement[],
  fallbackId: string,
  onRepair?: () => void
): readonly LinearItem[] {
  const broken = (item: LinearItem, at: number): boolean =>
    (needsRun(item, placements[at]) && !item.attributes.run) ||
    (item.kind === 'embed' && placements[at] === false && item.attributes.run !== null) ||
    (needsText(item) && item.attributes.run !== null && !item.attributes.text);
  if (!items.some(broken)) return items;
  onRepair?.();

  // The closest item that lends what `take` asks for, the earlier one first at equal distance.
  const nearest = (
    at: number,
    take: (item: LinearItem, index: number) => boolean
  ): LinearItem | null => {
    for (let distance = 1; distance < items.length; distance += 1) {
      const before = items[at - distance];
      if (before && take(before, at - distance)) return before;
      const after = items[at + distance];
      if (after && take(after, at + distance)) return after;
      if (!before && !after) break;
    }
    return null;
  };
  const lendsRun = (other: LinearItem, index: number): boolean =>
    other.attributes.run !== null && !(other.kind === 'embed' && placements[index] === false);
  const fallbackRun = emptyWmlElement(`${fallbackId}~r`, 'run', 'r');
  const repaired: LinearItem[] = [];
  items.forEach((item, at) => {
    if (!broken(item, at)) {
      repaired.push(item);
      return;
    }
    let attributes = item.attributes;
    if (item.kind === 'embed' && placements[at] === false) {
      repaired.push({ ...item, attributes: withoutRun(attributes) });
      return;
    }
    if (!attributes.run) {
      const donor = nearest(at, lendsRun);
      attributes = withRun(attributes, donor?.attributes ?? null, fallbackRun);
    }
    if (needsText(item) && !attributes.text) {
      const run = attributes.run!;
      const donor = nearest(
        at,
        (other) =>
          other.kind === 'char' && other.attributes.run?.id === run.id && !!other.attributes.text
      );
      attributes = Object.freeze({
        ...attributes,
        text:
          donor?.attributes.text ??
          emptyWmlElement(`${run.id}~t`, 'text', 't', [
            Object.freeze({
              kind: 'xmlSpace',
              namespaceUri: XML_NAMESPACE_URI,
              localName: 'space',
              prefix: 'xml',
              value: 'preserve',
            }),
          ]),
        textValueId: donor?.attributes.textValueId ?? null,
      });
    }
    repaired.push({ ...item, attributes } as LinearItem);
  });
  return repaired;
}
