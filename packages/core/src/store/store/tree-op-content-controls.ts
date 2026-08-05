// Writing content controls: values, metadata, insertion, removal — and the locks that refuse.
//
// EVERY refusal in this module is a STORE refusal. A widget that greys a button out is a
// courtesy; the guarantee is that the op path itself says no, so a keyboard gesture, a toolbar
// command and a script all meet the same answer. That is why the lock check runs in validation
// and not beside the surface that happens to be mounted.
//
// A VALUE IS TYPED. A dropdown takes an item its own list declares, a combo box takes anything,
// a date takes an ISO date and writes `@w:fullDate` beside the formatted content it paints, and
// a checkbox writes the glyph its own `w14:checkbox` declares. Offering a value of the wrong
// shape is `typeMismatch` rather than a coerced write, because a control that quietly accepted
// the wrong kind of value would produce a document Word reads differently than the caller does.
//
// A BOUND CONTROL IS PRESERVED AND REFUSED. `w:dataBinding` names a custom XML part this engine
// does not resolve; writing the content while the binding still points elsewhere would produce
// a document whose two answers disagree the moment Word opens it.

import {
  contentControlContentNodeOf,
  contentControlPropertiesNodeOf,
  contentControlPropertiesOf,
  contentControlsIn,
  lockForbidsEdit,
  lockForbidsRemoval,
  orderedContentControlProperties,
  resolveContentControlLock,
  type ContentControlKind,
  type ContentControlLock,
  type ContentControlProperties,
} from '../package/content-control-nodes.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { W14_NAMESPACE_URI, WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { isValidXmlText } from '../package/sinks.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { TEXT_DEPS, fromEdit, parentOf, runPropertiesNodeOf } from './tree-op-nodes.ts';
import { splitRunsAt } from './tree-op-apply.ts';
import { paragraphLength, paragraphOffsetIndex, splitsSurrogate } from './tree-op-segments.ts';
import type { TreeDocOp, TreeOpEffect, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

/** The value a control accepts, by what kind of control it is. */
export type ContentControlValueInput =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'listItem'; readonly value: string }
  | { readonly kind: 'checkbox'; readonly checked: boolean }
  /** A calendar date, `YYYY-MM-DD` or a full ISO-8601 instant. */
  | { readonly kind: 'date'; readonly iso: string };

/** The control types an insertion may author. Picture and repeating section are deferred. */
export const INSERTABLE_CONTENT_CONTROL_TYPES = [
  'richText',
  'plainText',
  'dropDownList',
  'comboBox',
  'date',
] as const satisfies readonly ContentControlKind[];

export type InsertableContentControlType = (typeof INSERTABLE_CONTENT_CONTROL_TYPES)[number];

/** Longest tag/alias an op may write, so a hostile caller cannot author an unbounded attribute. */
const MAX_METADATA_LENGTH = 4_096;

/**
 * The prompt Word writes back when a control is emptied and has no glossary entry.
 *
 * The AUTHORED prompt lives in the glossary document, which this change preserves without
 * reading (`w:placeholder/w:docPart`), so a restored prompt is Word's own default for the type
 * rather than a value invented here or a prompt recovered from a part nobody loaded.
 */
const DEFAULT_PROMPTS: Readonly<Record<string, string>> = {
  date: 'Click here to enter a date.',
  dropDownList: 'Choose an item.',
  comboBox: 'Choose an item.',
};
const DEFAULT_TEXT_PROMPT = 'Click here to enter text.';

function promptFor(type: ContentControlKind): string {
  return DEFAULT_PROMPTS[type] ?? DEFAULT_TEXT_PROMPT;
}

// ---------------------------------------------------------------------------
// Addressing: which controls enclose a node, and what they forbid
// ---------------------------------------------------------------------------

/**
 * The controls enclosing a node, outermost first, and the node's own control when it is one.
 *
 * Resolved by walking DOWN from the part root rather than up from the node, because the tree
 * carries no parent pointers and the walk is the same bounded one every other lane uses.
 */
export function enclosingContentControls(part: OoxmlPart, nodeId: string): readonly OoxmlNode[] {
  for (const entry of contentControlsIn(part.root)) {
    if (entry.node.id === nodeId) return [...entry.ancestors, entry.node];
  }
  const chain: OoxmlNode[] = [];
  const walk = (node: OoxmlNode, open: OoxmlNode[]): boolean => {
    if (node.kind === 'textValue') return node.id === nodeId;
    if (node.id === nodeId) {
      chain.push(...open);
      return true;
    }
    for (const child of node.children) {
      const nested = child.kind === 'contentControl' ? [...open, child] : open;
      if (walk(child, nested)) return true;
    }
    return false;
  };
  walk(part.root, []);
  return chain;
}

/** The lock in force at a node: every enclosing control's, resolved conservatively. */
export function contentControlLockAt(part: OoxmlPart, nodeId: string): ContentControlLock {
  return resolveContentControlLock(
    enclosingContentControls(part, nodeId).map(
      (control) => contentControlPropertiesOf(control).lock
    )
  );
}

/** Ops whose effect is to CHANGE the content a control encloses. */
const CONTENT_EDITING_OPS: ReadonlySet<string> = new Set([
  'insertText',
  'deleteText',
  'insertTab',
  'insertHardBreak',
  'insertPageBreak',
  'insertPageField',
  'insertCommentMarker',
  'splitParagraph',
  'splitParagraphMany',
  'joinParagraphs',
  'setRunProperties',
  'setParagraphProperties',
  'setParagraphMarkProperties',
  'setParagraphMarkRevision',
  'proposeParagraphMerge',
  'setListLevel',
  'setListNumbering',
  'insertHyperlink',
  'setSectionMark',
  'deleteBlock',
]);

/**
 * Whether an ordinary story op is refused by a lock, checked before any tree work.
 *
 * Deliberately covers the whole editing vocabulary rather than the two text ops: a template
 * that locks a field means the field, and a caller that could still restyle it, renumber it or
 * split it in half has not been stopped by anything.
 */
export function contentControlLockRefusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  if (!CONTENT_EDITING_OPS.has(op.op)) return null;
  const targets: string[] = [];
  if ('paragraphId' in op && typeof op.paragraphId === 'string') targets.push(op.paragraphId);
  if (op.op === 'joinParagraphs') targets.push(op.firstId, op.secondId);
  if (op.op === 'deleteBlock') targets.push(op.blockId);
  for (const target of targets) {
    if (lockForbidsEdit(contentControlLockAt(part, target))) return 'locked';
  }
  // Removing a block also removes any control inside it, which a removal lock forbids.
  if (op.op === 'deleteBlock') {
    const block = findNode(part, op.blockId);
    if (block && block.kind !== 'textValue') {
      for (const entry of contentControlsIn(block)) {
        const chain = [
          ...enclosingContentControls(part, op.blockId).map(
            (control) => contentControlPropertiesOf(control).lock
          ),
          ...entry.ancestors.map((ancestor) => contentControlPropertiesOf(ancestor).lock),
          contentControlPropertiesOf(entry.node).lock,
        ];
        const resolved = resolveContentControlLock(chain);
        if (lockForbidsRemoval(resolved) || lockForbidsEdit(resolved)) return 'locked';
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Forms protection: the document-scoped half of the same refusal
// ---------------------------------------------------------------------------

/**
 * Whether `settings.xml` enforces `w:documentProtection w:edit="forms"` (§17.15.1.29).
 *
 * Enforcement is a separate attribute from the mode: Word stores the mode a document was last
 * protected with even after the protection is lifted, so a file with `w:enforcement="0"` is an
 * ordinary editable document and treating it as protected would lock users out of their own
 * text.
 */
export function enforcesFormsProtection(settings: OoxmlPart | null | undefined): boolean {
  if (!settings) return false;
  for (const child of settings.root.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri !== WML_NAMESPACE_URI || child.localName !== 'documentProtection') {
      continue;
    }
    const attribute = (name: string): string | undefined =>
      child.attributes.find(
        (entry) => entry.localName === name && entry.namespaceUri === WML_NAMESPACE_URI
      )?.value;
    if (attribute('edit') !== 'forms') return false;
    return isTrue(attribute('enforcement'));
  }
  return false;
}

/** `ST_OnOff`: absent means on for a flag element, and "0"/"false"/"off" always means off. */
function isTrue(value: string | undefined): boolean {
  if (value === undefined) return true;
  return value !== '0' && value !== 'false' && value !== 'off';
}

/**
 * Whether forms protection reaches a node, i.e. it is not inside a control and not in a
 * section that switched form protection off (`w:sectPr/w:formProt`, §17.6.7).
 *
 * Under `edit="forms"` the document is read-only EXCEPT inside form fields, which is the
 * inverse of a lock: the same refusal, resolved from the other direction.
 */
export function formsProtectionRefusal(
  part: OoxmlPart,
  settings: OoxmlPart | null | undefined,
  op: TreeDocOp
): TreeOpRejection | null {
  if (!enforcesFormsProtection(settings)) return null;
  if (!PROTECTED_OPS.has(op.op)) return null;

  // A write ADDRESSED to a control is the one thing forms protection exists to allow.
  if (op.op === 'setContentControlValue') return null;

  const targets: string[] = [];
  if ('paragraphId' in op && typeof op.paragraphId === 'string') targets.push(op.paragraphId);
  if ('controlId' in op && typeof op.controlId === 'string') targets.push(op.controlId);
  if (op.op === 'joinParagraphs') targets.push(op.firstId, op.secondId);
  if (op.op === 'deleteBlock') targets.push(op.blockId);
  if (targets.length === 0) return 'locked';

  for (const target of targets) {
    // The control itself is protected even though its contents are not: forms protection
    // permits FILLING a form, never dismantling it.
    const enclosing = enclosingContentControls(part, target);
    const inside =
      op.op === 'removeContentControl' || op.op === 'setContentControlProperties'
        ? enclosing.length > 1
        : enclosing.length > 0;
    if (inside) continue;
    if (!sectionProtectsForms(part, target)) continue;
    return 'locked';
  }
  return null;
}

/** Ops forms protection refuses outside a control. Reads and note lifecycle are unaffected. */
const PROTECTED_OPS: ReadonlySet<string> = new Set([
  ...CONTENT_EDITING_OPS,
  'insertContentControl',
  'removeContentControl',
  'setContentControlProperties',
]);

/**
 * Whether the section owning a node still has form protection on.
 *
 * `w:formProt` is per-section, so a protected document may carry an unprotected section. The
 * owning section is the first `w:sectPr` at or after the node in body order, which is how a
 * section's extent is expressed in the body at all.
 */
function sectionProtectsForms(part: OoxmlPart, nodeId: string): boolean {
  let seenTarget = false;
  let answer = true;
  const walk = (node: OoxmlNode): boolean => {
    if (node.kind === 'textValue') return false;
    if (node.id === nodeId) seenTarget = true;
    if (
      seenTarget &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      node.localName === 'sectPr' &&
      node.id !== nodeId
    ) {
      const formProt = node.children.find(
        (child) =>
          child.kind !== 'textValue' &&
          child.namespaceUri === WML_NAMESPACE_URI &&
          child.localName === 'formProt'
      );
      // No `w:formProt` on the section leaves the document's own protection in force.
      if (formProt && formProt.kind !== 'textValue') {
        answer = isTrue(
          formProt.attributes.find(
            (entry) => entry.localName === 'val' && entry.namespaceUri === WML_NAMESPACE_URI
          )?.value
        );
      }
      return true;
    }
    for (const child of node.children) {
      if (walk(child)) return true;
    }
    return false;
  };
  walk(part.root);
  return answer;
}

// ---------------------------------------------------------------------------
// Node construction
// ---------------------------------------------------------------------------

function element(
  nextId: () => string,
  localName: string,
  options: {
    readonly kind?: OoxmlNode['kind'];
    readonly attributes?: readonly (readonly [string, string])[];
    readonly children?: readonly OoxmlNode[];
  } = {}
): OoxmlElement {
  return {
    id: nextId(),
    kind: options.kind ?? 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: (options.attributes ?? []).map(([name, value]) => ({
      kind: 'generic',
      namespaceUri: WML_NAMESPACE_URI,
      localName: name,
      prefix: 'w',
      value,
    })),
    children: options.children ?? [],
  } as unknown as OoxmlElement;
}

function textRun(nextId: () => string, text: string, properties: OoxmlNode | undefined): OoxmlNode {
  const value: OoxmlNode = { id: nextId(), kind: 'textValue', value: text };
  const textNode = {
    id: nextId(),
    kind: 'text',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [value],
  } as unknown as OoxmlNode;
  return {
    id: nextId(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: properties ? [properties, textNode] : [textNode],
  } as unknown as OoxmlNode;
}

/** The `w:rPr` a control's first run carries, cloned so a value write keeps its face. */
function firstRunProperties(
  content: OoxmlNode | undefined,
  nextId: () => string
): OoxmlNode | undefined {
  if (!content || content.kind === 'textValue') return undefined;
  const find = (node: OoxmlNode, depth: number): OoxmlNode | undefined => {
    if (node.kind === 'textValue' || depth > 8) return undefined;
    if (node.kind === 'run') {
      const properties = runPropertiesNodeOf(node);
      return properties ? clone(properties, nextId) : undefined;
    }
    for (const child of node.children) {
      const found = find(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return find(content, 0);
}

function clone(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { id: nextId(), kind: 'textValue', value: node.value };
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => clone(child, nextId)),
  } as OoxmlNode;
}

function withAttribute(node: OoxmlElement, localName: string, value: string): OoxmlElement {
  const existing = node.attributes.findIndex(
    (attribute) => attribute.localName === localName && attribute.namespaceUri !== ''
  );
  const attribute = {
    ...(existing >= 0
      ? node.attributes[existing]!
      : {
          kind: 'generic',
          namespaceUri: node.namespaceUri,
          localName,
          prefix: node.prefix,
        }),
    value,
  };
  const attributes =
    existing >= 0
      ? node.attributes.map((current, index) => (index === existing ? attribute : current))
      : [...node.attributes, attribute];
  return { ...node, attributes } as OoxmlElement;
}

function w14Attribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.localName === localName && attribute.namespaceUri === W14_NAMESPACE_URI) {
      return attribute.value;
    }
  }
  return undefined;
}

function namedElementChild(
  parent: OoxmlNode | undefined,
  namespaceUri: string,
  localName: string
): OoxmlElement | undefined {
  if (!parent || parent.kind === 'textValue') return undefined;
  for (const child of parent.children as readonly OoxmlNode[]) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === namespaceUri && child.localName === localName) return child;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Value semantics
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]{1,15}Z?)?$/;

/** ISO input, validated as a real calendar date rather than a well-shaped string. */
function parseIsoDate(raw: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;
  return { year, month, day };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Format a date the way the control's own `w:dateFormat` asks.
 *
 * A BOUNDED token substitution over the patterns Word writes, not a locale engine: the format
 * comes out of an untrusted file, so it is walked once, left to right, with no backtracking and
 * no repetition driven by a file-supplied count.
 */
export function formatContentControlDate(
  date: { year: number; month: number; day: number },
  pattern: string | undefined
): string {
  const iso = `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  if (!pattern || pattern.length === 0 || pattern.length > 64) return iso;
  let out = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index]!;
    if (char !== 'y' && char !== 'M' && char !== 'd') {
      out += char;
      index += 1;
      continue;
    }
    let run = 0;
    while (index + run < pattern.length && pattern[index + run] === char) run += 1;
    if (char === 'y')
      out += run <= 2 ? String(date.year % 100).padStart(2, '0') : String(date.year);
    else if (char === 'M') {
      out +=
        run >= 4
          ? MONTH_NAMES[date.month - 1]!
          : run === 3
            ? MONTH_NAMES[date.month - 1]!.slice(0, 3)
            : String(date.month).padStart(Math.min(run, 2), '0');
    } else {
      out += String(date.day).padStart(Math.min(run, 2), '0');
    }
    index += run;
  }
  return out;
}

interface PlannedValue {
  /** What the control's content becomes. */
  readonly text: string;
  /** Whether the control ends up showing its prompt. */
  readonly showingPlaceholder: boolean;
  /** Property edits to make on `w:sdtPr`, applied in place and re-ordered on write. */
  readonly lastValue?: string;
  readonly fullDate?: string;
  readonly checked?: boolean;
}

function planValue(
  properties: ContentControlProperties,
  value: ContentControlValueInput
): PlannedValue | TreeOpRejection {
  switch (value.kind) {
    case 'text': {
      if (
        properties.type !== 'richText' &&
        properties.type !== 'plainText' &&
        properties.type !== 'comboBox' &&
        properties.type !== 'untyped'
      ) {
        return 'typeMismatch';
      }
      if (typeof value.text !== 'string' || !isValidXmlText(value.text)) return 'invalidArgs';
      if (value.text.length === 0) {
        return { text: promptFor(properties.type), showingPlaceholder: true };
      }
      return {
        text: value.text,
        showingPlaceholder: false,
        ...(properties.type === 'comboBox' ? { lastValue: value.text } : {}),
      };
    }
    case 'listItem': {
      if (properties.type !== 'dropDownList' && properties.type !== 'comboBox') {
        return 'typeMismatch';
      }
      const item = properties.listItems.find((candidate) => candidate.value === value.value);
      // A dropdown's whole contract is that its value is one the list declares; a combo box
      // reaches free text through `{ kind: 'text' }`, so an unknown ITEM is wrong there too.
      if (!item) return 'invalidArgs';
      return { text: item.displayText, showingPlaceholder: false, lastValue: item.value };
    }
    case 'checkbox': {
      if (properties.type !== 'checkbox' || !properties.checkbox) return 'typeMismatch';
      if (typeof value.checked !== 'boolean') return 'invalidArgs';
      const state = value.checked
        ? properties.checkbox.checkedState
        : properties.checkbox.uncheckedState;
      const glyph = glyphFor(state?.value, value.checked);
      if (glyph === null) return 'invalidArgs';
      return { text: glyph, showingPlaceholder: false, checked: value.checked };
    }
    case 'date': {
      if (properties.type !== 'date') return 'typeMismatch';
      const parsed = typeof value.iso === 'string' ? parseIsoDate(value.iso) : null;
      if (!parsed) return 'invalidArgs';
      const iso = `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
      return {
        text: formatContentControlDate(parsed, properties.date?.dateFormat),
        showingPlaceholder: false,
        fullDate: `${iso}T00:00:00Z`,
      };
    }
    default:
      return 'invalidArgs';
  }
}

/** The glyph a checkbox state declares, as a character. Word's defaults when it declares none. */
function glyphFor(hex: string | undefined, checked: boolean): string | null {
  const raw = hex ?? (checked ? '2612' : '2610');
  if (!/^[0-9A-Fa-f]{1,6}$/.test(raw)) return null;
  const code = Number.parseInt(raw, 16);
  // A file-supplied code point is bounded before it reaches `fromCodePoint`, which throws on
  // anything past the Unicode range and would turn a malformed control into a crash.
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

// ---------------------------------------------------------------------------
// Property writing
// ---------------------------------------------------------------------------

interface PropertyEdits {
  readonly tag?: string | null;
  readonly alias?: string | null;
  readonly lock?: ContentControlLock;
  readonly id?: number;
  readonly showingPlaceholder?: boolean;
  readonly lastValue?: string;
  readonly fullDate?: string;
  readonly checked?: boolean;
  readonly temporary?: false;
}

/**
 * Rebuild `w:sdtPr` with the named edits applied, in schema order.
 *
 * Everything not named survives — including the unmodelled children (`w15:repeatingSection`, a
 * vendor extension) this change deliberately does not own — and the order is restored by
 * {@link orderedContentControlProperties} rather than by appending, because `CT_SdtPr` is a
 * sequence and Word rejects one out of order.
 */
function editedProperties(
  sdtPr: OoxmlElement | undefined,
  edits: PropertyEdits,
  nextId: () => string
): OoxmlElement {
  const base =
    sdtPr ?? element(nextId, 'sdtPr', { kind: 'contentControlProperties' as OoxmlNode['kind'] });
  let children = [...base.children] as OoxmlNode[];

  const setSimple = (localName: string, value: string | null): void => {
    const index = children.findIndex(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === localName
    );
    if (value === null) {
      if (index >= 0) children.splice(index, 1);
      return;
    }
    const next = element(nextId, localName, { attributes: [['val', value]] });
    if (index >= 0) children[index] = next;
    else children.push(next);
  };
  const setFlag = (localName: string, on: boolean): void => {
    const index = children.findIndex(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === localName
    );
    if (!on) {
      if (index >= 0) children.splice(index, 1);
      return;
    }
    if (index < 0) children.push(element(nextId, localName));
  };

  if (edits.tag !== undefined) setSimple('tag', edits.tag);
  if (edits.alias !== undefined) setSimple('alias', edits.alias);
  if (edits.lock !== undefined) setSimple('lock', edits.lock === 'unlocked' ? null : edits.lock);
  if (edits.id !== undefined) setSimple('id', String(edits.id));
  if (edits.showingPlaceholder !== undefined) setFlag('showingPlcHdr', edits.showingPlaceholder);
  if (edits.temporary === false) setFlag('temporary', false);
  if (edits.lastValue !== undefined) {
    children = children.map((child) => {
      if (
        child.kind === 'textValue' ||
        child.namespaceUri !== WML_NAMESPACE_URI ||
        (child.localName !== 'dropDownList' && child.localName !== 'comboBox')
      ) {
        return child;
      }
      return withAttribute(child, 'lastValue', edits.lastValue!);
    });
  }
  if (edits.fullDate !== undefined) {
    children = children.map((child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'date'
        ? withAttribute(child, 'fullDate', edits.fullDate!)
        : child
    );
  }
  if (edits.checked !== undefined) {
    children = children.map((child) => {
      if (
        child.kind === 'textValue' ||
        child.namespaceUri !== W14_NAMESPACE_URI ||
        child.localName !== 'checkbox'
      ) {
        return child;
      }
      const inner = child.children.map((grand) => {
        if (
          grand.kind === 'textValue' ||
          grand.namespaceUri !== W14_NAMESPACE_URI ||
          grand.localName !== 'checked'
        ) {
          return grand;
        }
        return {
          ...grand,
          attributes: grand.attributes.map((attribute) =>
            attribute.localName === 'val' && attribute.namespaceUri === W14_NAMESPACE_URI
              ? { ...attribute, value: edits.checked ? '1' : '0' }
              : attribute
          ),
        } as OoxmlNode;
      });
      return { ...child, children: inner } as OoxmlNode;
    });
  }

  return { ...base, children: orderedContentControlProperties(children) } as OoxmlElement;
}

/** Rebuild a control's content so it holds exactly `text`, keeping its block shape. */
function contentWithText(
  content: OoxmlElement | undefined,
  text: string,
  nextId: () => string
): readonly OoxmlNode[] {
  const properties = firstRunProperties(content, nextId);
  const run = textRun(nextId, text, properties);
  const firstParagraph = content?.children.find((child) => child.kind === 'paragraph');
  if (!firstParagraph || firstParagraph.kind === 'textValue') return [run];
  const pPr = firstParagraph.children.find(
    (child: OoxmlNode) => child.kind !== 'textValue' && child.localName === 'pPr'
  );
  const paragraph = {
    ...firstParagraph,
    children: pPr ? [pPr, run] : [run],
  } as OoxmlNode;
  return [paragraph];
}

function contentControlEffect(controlId: string, impact: TreeOpEffect['impact']): TreeOpEffect {
  return {
    dirty: [controlId],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact,
  };
}

// ---------------------------------------------------------------------------
// Appliers
// ---------------------------------------------------------------------------

function resolveControl(
  part: OoxmlPart,
  controlId: string
): { control: OoxmlElement; lock: ContentControlLock } | TreeOpRejection {
  const node = findNode(part, controlId);
  if (!node) return 'unknown-content-control';
  if (node.kind !== 'contentControl') return 'not-a-content-control';
  return { control: node, lock: contentControlLockAt(part, controlId) };
}

export function applySetContentControlValue(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'setContentControlValue' }>,
  options?: EditOptions
): TreeOpResult {
  const resolved = resolveControl(part, op.controlId);
  if (typeof resolved === 'string') return { ok: false, reason: resolved };
  const { control, lock } = resolved;
  const properties = contentControlPropertiesOf(control);
  if (properties.dataBinding) return { ok: false, reason: 'bound' };
  if (lockForbidsEdit(lock)) return { ok: false, reason: 'locked' };

  const planned = planValue(properties, op.value);
  if (typeof planned === 'string') return { ok: false, reason: planned };

  const nextId = createNodeIdAllocator(part);
  const sdtPr = contentControlPropertiesNodeOf(control);
  const content = contentControlContentNodeOf(control);
  const nextProperties = editedProperties(
    sdtPr,
    {
      showingPlaceholder: planned.showingPlaceholder,
      ...(planned.lastValue === undefined ? {} : { lastValue: planned.lastValue }),
      ...(planned.fullDate === undefined ? {} : { fullDate: planned.fullDate }),
      ...(planned.checked === undefined ? {} : { checked: planned.checked }),
    },
    nextId
  );
  const nextContent = {
    ...(content ??
      element(nextId, 'sdtContent', { kind: 'contentControlContent' as OoxmlNode['kind'] })),
    children: contentWithText(content, planned.text, nextId),
  } as OoxmlNode;

  const rebuilt = {
    ...control,
    children: [
      nextProperties,
      ...control.children.filter(
        (child) =>
          child.kind !== 'contentControlProperties' && child.kind !== 'contentControlContent'
      ),
      nextContent,
    ],
  } as OoxmlNode;

  const written = replaceNode(part, control.id, rebuilt, options);
  if (!written.ok) {
    return { ok: false, reason: 'tree-invariant', detail: JSON.stringify(written.issues) };
  }
  // `w:temporary`: the control goes once its content has been edited, and the content stays.
  // The other half of the placeholder transition — a prompt that was only ever a prompt.
  if (properties.temporary) {
    return applyRemoveContentControl(
      written.part,
      { op: 'removeContentControl', controlId: control.id, keepContent: true },
      options
    );
  }
  return {
    ok: true,
    part: written.part,
    effect: contentControlEffect(control.id, 'flow-structural'),
  };
}

export function applySetContentControlProperties(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'setContentControlProperties' }>,
  options?: EditOptions
): TreeOpResult {
  const resolved = resolveControl(part, op.controlId);
  if (typeof resolved === 'string') return { ok: false, reason: resolved };
  const { control, lock } = resolved;
  if (lockForbidsEdit(lock) || lockForbidsRemoval(lock)) return { ok: false, reason: 'locked' };

  const nextId = createNodeIdAllocator(part);
  const nextProperties = editedProperties(
    contentControlPropertiesNodeOf(control),
    {
      ...(op.tag === undefined ? {} : { tag: op.tag }),
      ...(op.alias === undefined ? {} : { alias: op.alias }),
      ...(op.lock === undefined ? {} : { lock: op.lock }),
    },
    nextId
  );
  const children = [
    nextProperties,
    ...control.children.filter((child) => child.kind !== 'contentControlProperties'),
  ];
  return fromEdit(
    replaceNode(part, control.id, { ...control, children } as OoxmlNode, options),
    contentControlEffect(control.id, 'paragraph-local')
  );
}

export function applyRemoveContentControl(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'removeContentControl' }>,
  options?: EditOptions
): TreeOpResult {
  const resolved = resolveControl(part, op.controlId);
  if (typeof resolved === 'string') return { ok: false, reason: resolved };
  const { control, lock } = resolved;
  if (lockForbidsRemoval(lock)) return { ok: false, reason: 'locked' };
  // Taking the content with the control is a content edit as well as a structural one.
  if (!op.keepContent && lockForbidsEdit(lock)) return { ok: false, reason: 'locked' };

  const owner = parentOf(part, control.id);
  if (!owner) return { ok: false, reason: 'tree-invariant' };
  const content = contentControlContentNodeOf(control);
  const kept = op.keepContent && content ? [...content.children] : [];
  const children = owner.children.flatMap((child) => (child.id === control.id ? kept : [child]));
  return fromEdit(
    replaceChildren(part, owner.id, children, options),
    contentControlEffect(owner.id, 'flow-structural')
  );
}

export function applyInsertContentControl(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'insertContentControl' }>,
  options?: EditOptions
): TreeOpResult {
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph) return { ok: false, reason: 'unknown-paragraph' };
  if (paragraph.kind !== 'paragraph') return { ok: false, reason: 'not-a-paragraph' };
  if (lockForbidsEdit(contentControlLockAt(part, op.paragraphId))) {
    return { ok: false, reason: 'locked' };
  }

  if (op.start < 0 || op.end > paragraphLength(paragraph) || op.start >= op.end) {
    return { ok: false, reason: 'invalid-range' };
  }
  if (splitsSurrogate(paragraph, op.start) || splitsSurrogate(paragraph, op.end)) {
    return { ok: false, reason: 'splits-surrogate-pair' };
  }
  // A control wraps WHOLE children — `w:sdt` is a sibling of runs in `EG_PContent`, never a
  // thing inside one — so a range that ends mid-run only becomes wrappable once that run is
  // two runs. Splitting at both edges first is the discipline a comment anchor already uses,
  // and it keeps the characters and their formatting exactly as they were.
  let current = part;
  for (const edge of [op.end, op.start]) {
    const target = findNode(current, op.paragraphId);
    if (!target || target.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
    const split = splitRunsAt(current, target, edge, options);
    if (!split.ok) return { ok: false, reason: split.reason };
    current = split.part;
  }

  const reloaded = findNode(current, op.paragraphId);
  if (!reloaded || reloaded.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
  const index = paragraphOffsetIndex(reloaded);
  const wrapped: OoxmlNode[] = [];
  let covered = false;
  for (const child of reloaded.children) {
    const span = index.spanOf(child);
    if (!span || span.start === span.end) continue;
    if (span.start >= op.start && span.end <= op.end) {
      wrapped.push(child);
      covered = true;
      continue;
    }
    if (span.start < op.end && span.end > op.start) return { ok: false, reason: 'invalid-range' };
  }
  if (!covered) return { ok: false, reason: 'invalid-range' };

  const nextId = createNodeIdAllocator(current);
  const allocated = nextContentControlId(current);
  const properties = editedProperties(
    undefined,
    {
      ...(op.tag === undefined ? {} : { tag: op.tag }),
      ...(op.alias === undefined ? {} : { alias: op.alias }),
      ...(allocated === null ? {} : { id: allocated }),
      ...(op.lock === undefined ? {} : { lock: op.lock }),
    },
    nextId
  );
  const typed = element(nextId, TYPE_ELEMENT_FOR[op.type]);
  const withType = {
    ...properties,
    children: orderedContentControlProperties([...properties.children, typed]),
  } as OoxmlElement;
  const content = element(nextId, 'sdtContent', {
    kind: 'contentControlContent' as OoxmlNode['kind'],
    children: wrapped,
  });
  const control = element(nextId, 'sdt', {
    kind: 'contentControl' as OoxmlNode['kind'],
    children: [withType, content],
  });

  const wrappedIds = new Set(wrapped.map((child) => child.id));
  let placed = false;
  const children: OoxmlNode[] = [];
  for (const child of reloaded.children) {
    if (!wrappedIds.has(child.id)) {
      children.push(child);
      continue;
    }
    if (!placed) {
      children.push(control);
      placed = true;
    }
  }
  return fromEdit(
    replaceChildren(current, reloaded.id, children, options),
    contentControlEffect(reloaded.id, 'flow-structural')
  );
}

const TYPE_ELEMENT_FOR: Readonly<Record<InsertableContentControlType, string>> = {
  richText: 'richText',
  plainText: 'text',
  dropDownList: 'dropDownList',
  comboBox: 'comboBox',
  date: 'date',
};

/** The next `w:id`, seeded from the part's own maximum. Null once the 32-bit bound is reached. */
function nextContentControlId(part: OoxmlPart): number | null {
  let max = 0;
  for (const entry of contentControlsIn(part.root)) {
    const id = contentControlPropertiesOf(entry.node).id;
    if (id !== undefined && id > max) max = id;
  }
  if (max >= 0x7fffffff) return null;
  return max + 1;
}

// ---------------------------------------------------------------------------
// Placeholder replacement on an ordinary edit
// ---------------------------------------------------------------------------

/**
 * The control whose PROMPT an insertion at this position would type over, if any.
 *
 * A prompt is state rather than text, so the first character typed replaces the whole of it —
 * appending to it is the defect this change exists to fix, and it is the store's job because
 * the caret is not the only thing that can insert.
 */
export function placeholderControlForInsertion(
  part: OoxmlPart,
  paragraphId: string,
  offset: number
): { readonly control: OoxmlNode; readonly offset: number } | null {
  const chain = enclosingContentControls(part, paragraphId);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const control = chain[index]!;
    if (contentControlPropertiesOf(control).showingPlaceholder) return { control, offset: 0 };
  }
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const index = paragraphOffsetIndex(paragraph);
  for (const entry of contentControlsIn(paragraph)) {
    if (!contentControlPropertiesOf(entry.node).showingPlaceholder) continue;
    const span = index.spanOf(entry.node);
    if (!span) continue;
    if (offset >= span.start && offset <= span.end)
      return { control: entry.node, offset: span.start };
  }
  return null;
}

/** Empty a control's prompt and clear the flag, so the caller's insert is the whole content. */
export function clearPlaceholder(
  part: OoxmlPart,
  controlId: string,
  options?: EditOptions
): OoxmlPart | null {
  const control = findNode(part, controlId);
  if (!control || control.kind !== 'contentControl') return null;
  const nextId = createNodeIdAllocator(part);
  const content = contentControlContentNodeOf(control);
  const properties = editedProperties(
    contentControlPropertiesNodeOf(control),
    { showingPlaceholder: false },
    nextId
  );
  const emptied = {
    ...(content ??
      element(nextId, 'sdtContent', { kind: 'contentControlContent' as OoxmlNode['kind'] })),
    children: contentWithText(content, '', nextId),
  } as OoxmlNode;
  const rebuilt = {
    ...control,
    children: [
      properties,
      ...control.children.filter(
        (child) =>
          child.kind !== 'contentControlProperties' && child.kind !== 'contentControlContent'
      ),
      emptied,
    ],
  } as OoxmlNode;
  const written = replaceNode(part, control.id, rebuilt, options);
  return written.ok ? written.part : null;
}

/** Whether a metadata string is short enough and legal in XML. */
export function isWritableContentControlMetadata(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string' || value.length > MAX_METADATA_LENGTH) return false;
  return isValidXmlText(value);
}

export {
  namedElementChild as contentControlChildElement,
  w14Attribute as contentControlW14Attribute,
};
