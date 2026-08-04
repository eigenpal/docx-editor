// Formatting the protocol can answer, and formatting an op may author.
//
// INTERNAL. Two directions that are deliberately not symmetrical.
//
// READING IS AGREEMENT. "Is this range bold" has three answers, not two: every run that
// contributes characters says yes, every one says no, or they do not agree. The third is `null`,
// and it is also the answer when NOTHING in the range authors the property at all — because this
// lane reads what the document AUTHORS, never the cascade.
//
// That last point is the load-bearing one. The style cascade lives in the layout lane, which a
// DOM-free automation lane may not import, so there is no honest way to answer "what does this
// text LOOK like" from here. But there is more to it than reachability: the value a formatting
// WRITE merges against is the direct one, so a read that echoed the cascade would let a caller
// read a heading's inherited size, write it back unchanged, and silently freeze an inherited
// value into the paragraph as direct formatting. The divergence from upstream — which answers
// the effective value — is recorded in `compat/manifest.json`.
//
// WRITING IS THE ACCEPTED PROPERTY BOUNDARY (design D8). Every field below maps to exactly one
// element in `ACCEPTED_RUN_PROPERTIES` / `ACCEPTED_PARAGRAPH_PROPERTIES`, and a value the
// boundary cannot express is REFUSED rather than approximated. Numbers are converted at this
// edge and nowhere else: the protocol speaks points, because that is what a document's own
// vocabulary is for a reader, and OOXML speaks twips and half-points.
//
// UNTRUSTED VALUES. A font name reaching `setFont` is caller input and a font name read back is
// file input. Both are validated as XML text here; the serializer escapes on the way out. This
// file builds no markup, no URL and no CSS.

import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlElement, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { isValidXmlText } from '../store/package/sinks.ts';
import {
  directParagraphProperties,
  mergedProperties,
  runsCovering,
} from '../store/store/direct-properties.ts';
import {
  namedChild,
  paragraphPropertiesNodeOf,
  runPropertiesNodeOf,
} from '../store/store/tree-op-nodes.ts';
import type { OoxmlProperty } from '../store/store/tree-ops.ts';

/** Twips per point (ECMA-376 measures most lengths in twentieths of a point). */
const TWIPS_PER_POINT = 20;
/** Widest value `w:ind`/`w:spacing` will be authored with, in twips — 22 inches of slack. */
const MAX_TWIPS = 31680;
/** Half-points, so 1..999 points. `w:sz` is a half-point measure (17.3.2.38). */
const MAX_HALF_POINTS = 1999;

/** Alignment as this protocol publishes it. `Mixed`/`Unknown` are read-only answers. */
export type AutomationAlignment = 'Mixed' | 'Unknown' | 'Left' | 'Centered' | 'Right' | 'Justified';

/**
 * What a range agrees about its characters' formatting.
 *
 * `null` means "no agreed value": the runs disagree, or none of them authors the property. The
 * two are one answer on purpose — a caller that must not guess is told not to guess, and a
 * caller writing a value writes it unconditionally either way.
 */
export interface AutomationFontRead {
  readonly bold: boolean | null;
  readonly italic: boolean | null;
  /** `w:rFonts/@w:ascii`. */
  readonly name: string | null;
  /** Points. */
  readonly size: number | null;
  /** `#RRGGBB`. `null` for `auto`, which names no colour. */
  readonly color: string | null;
}

/** What a caller asks to author. Every field is optional; an empty request is refused. */
export interface AutomationFontWrite {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly name?: string;
  readonly size?: number;
  readonly color?: string;
}

/** One paragraph's own paragraph properties, in points. `null` = the paragraph authors none. */
export interface AutomationParagraphFormatRead {
  readonly alignment: AutomationAlignment;
  readonly firstLineIndent: number | null;
  readonly leftIndent: number | null;
  readonly rightIndent: number | null;
  readonly lineSpacing: number | null;
  readonly spaceBefore: number | null;
  readonly spaceAfter: number | null;
  readonly widowControl: boolean | null;
}

export interface AutomationParagraphFormatWrite {
  readonly alignment?: AutomationAlignment;
  readonly firstLineIndent?: number;
  readonly leftIndent?: number;
  readonly rightIndent?: number;
  readonly lineSpacing?: number;
  readonly spaceBefore?: number;
  readonly spaceAfter?: number;
  readonly widowControl?: boolean;
}

/** Why a formatting value could not be authored. Named so a caller learns the field. */
export interface FormattingRefusal {
  readonly detail: string;
}

export type FormattingPlan<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly detail: string };

const NO_FONT: AutomationFontRead = Object.freeze({
  bold: null,
  italic: null,
  name: null,
  size: null,
  color: null,
});

function attributeOf(element: OoxmlElement | undefined, localName: string): string | null {
  if (!element) return null;
  for (const entry of element.attributes) {
    if (entry.localName === localName) return entry.value;
  }
  return null;
}

/**
 * An OOXML on/off attribute, as ECMA-376 §17.17.4 defines it.
 *
 * A toggle element with no `@w:val` is ON — `<w:b/>` is bold — and the off spellings are the
 * four the standard names. Treating a missing `@w:val` as anything but true would read half the
 * bold text Word writes as unformatted.
 */
function onOff(element: OoxmlElement | undefined): boolean | null {
  if (!element) return null;
  const value = attributeOf(element, 'val');
  if (value === null) return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'none')
    return false;
  return true;
}

/** A `#RRGGBB` projection of `w:color/@w:val`, or null when it names no concrete colour. */
function hexColour(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return `#${trimmed.toUpperCase()}`;
}

/** Half-points to points, refusing a value the file wrote as something else. */
function pointsFromHalfPoints(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed / 2;
}

function pointsFromTwips(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) return null;
  return parsed / TWIPS_PER_POINT;
}

/** One value if every voice agrees on it, else null. An empty set of voices agrees on nothing. */
function agreed<T>(values: readonly (T | null)[]): T | null {
  if (values.length === 0) return null;
  const first = values[0] as T | null;
  if (first === null) return null;
  for (const value of values) {
    if (value !== first) return null;
  }
  return first;
}

/**
 * What the runs of `[start, end)` agree about, across paragraphs.
 *
 * `spans` is one entry per paragraph the range covers, each with the offsets inside that
 * paragraph the range reaches — so a range crossing a paragraph mark asks every paragraph it
 * touches and agrees across all of them, exactly as a selection would.
 */
export function fontRead(
  part: OoxmlPart,
  spans: readonly { readonly paragraphId: string; readonly start: number; readonly end: number }[]
): AutomationFontRead {
  const properties: (OoxmlElement | undefined)[] = [];
  for (const span of spans) {
    for (const run of runsCovering(part, span.paragraphId, span.start, span.end)) {
      properties.push(runPropertiesNodeOf(run));
    }
  }
  if (properties.length === 0) return NO_FONT;
  return {
    bold: agreed(properties.map((rPr) => onOff(namedChild(rPr, 'b')))),
    italic: agreed(properties.map((rPr) => onOff(namedChild(rPr, 'i')))),
    name: agreed(
      properties.map((rPr) => {
        const fonts = namedChild(rPr, 'rFonts');
        const ascii = attributeOf(fonts, 'ascii');
        return ascii === null || ascii.length === 0 ? null : ascii;
      })
    ),
    size: agreed(
      properties.map((rPr) => pointsFromHalfPoints(attributeOf(namedChild(rPr, 'sz'), 'val')))
    ),
    color: agreed(properties.map((rPr) => hexColour(attributeOf(namedChild(rPr, 'color'), 'val')))),
  };
}

const ALIGNMENT_BY_JC: Readonly<Record<string, AutomationAlignment>> = Object.freeze({
  left: 'Left',
  start: 'Left',
  center: 'Centered',
  right: 'Right',
  end: 'Right',
  both: 'Justified',
  distribute: 'Justified',
});

/** The `@w:val` each writable alignment authors. `Mixed`/`Unknown` are absent: they are reads. */
const JC_BY_ALIGNMENT: Readonly<Record<string, string>> = Object.freeze({
  Left: 'left',
  Centered: 'center',
  Right: 'right',
  Justified: 'both',
});

function alignmentOf(properties: OoxmlElement | undefined): AutomationAlignment {
  const value = attributeOf(namedChild(properties, 'jc'), 'val');
  if (value === null) return 'Unknown';
  return ALIGNMENT_BY_JC[value.trim().toLowerCase()] ?? 'Unknown';
}

/**
 * One paragraph's own `w:pPr` values, in points.
 *
 * `lineSpacing` is `@w:line / 20` under BOTH line rules, which is not a coincidence: an `auto`
 * rule measures in 240ths of a line and Word calls one line twelve points, so `line/240 * 12`
 * and `line/20` are the same number. An `exact`/`atLeast` rule measures in twips, which is also
 * `line/20`. So the conversion is the same either way and the rule does not have to be guessed
 * at on the way out.
 */
export function paragraphFormatRead(
  part: OoxmlPart,
  paragraphId: string
): AutomationParagraphFormatRead | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const spacing = namedChild(pPr, 'spacing');
  const indent = namedChild(pPr, 'ind');
  return {
    alignment: alignmentOf(pPr),
    firstLineIndent: firstLineIndentOf(indent),
    leftIndent: pointsFromTwips(attributeOf(indent, 'left') ?? attributeOf(indent, 'start')),
    rightIndent: pointsFromTwips(attributeOf(indent, 'right') ?? attributeOf(indent, 'end')),
    lineSpacing: pointsFromTwips(attributeOf(spacing, 'line')),
    spaceBefore: pointsFromTwips(attributeOf(spacing, 'before')),
    spaceAfter: pointsFromTwips(attributeOf(spacing, 'after')),
    widowControl: onOff(namedChild(pPr, 'widowControl')),
  };
}

/**
 * `@w:firstLine`, or the NEGATIVE of `@w:hanging`.
 *
 * One number in upstream's vocabulary, two mutually exclusive attributes in OOXML: a hanging
 * indent is a first line that starts further left than the rest, which is what a negative
 * first-line indent means. Reading only `@w:firstLine` would report zero for every hanging
 * paragraph — and a caller who wrote that zero back would flatten the hang.
 */
function firstLineIndentOf(indent: OoxmlElement | undefined): number | null {
  const firstLine = pointsFromTwips(attributeOf(indent, 'firstLine'));
  if (firstLine !== null) return firstLine;
  const hanging = pointsFromTwips(attributeOf(indent, 'hanging'));
  return hanging === null ? null : -hanging;
}

function twipsFor(points: number, field: string): FormattingPlan<number> {
  if (typeof points !== 'number' || !Number.isFinite(points))
    return { ok: false, detail: `${field}: not a measurement` };
  const twips = Math.round(points * TWIPS_PER_POINT);
  if (Math.abs(twips) > MAX_TWIPS) return { ok: false, detail: `${field}: out of range` };
  return { ok: true, value: twips };
}

/**
 * The `w:rPr` children a font request authors.
 *
 * A boolean asked for as `false` is written as an explicit off spelling rather than omitted:
 * omitting it would let the style cascade put the property back, so "not bold" would read as
 * bold on the next open. An absent field is simply not in the list — the caller merges these over
 * each run's own authored bag (`runPropertyEdits`), which is what keeps a size change from
 * deleting a run's colour.
 */
export function fontProperties(request: AutomationFontWrite): FormattingPlan<OoxmlProperty[]> {
  const properties: OoxmlProperty[] = [];
  if (request.bold !== undefined) {
    if (typeof request.bold !== 'boolean') return { ok: false, detail: 'bold: not a boolean' };
    properties.push({ localName: 'b', ...(request.bold ? {} : { attributes: { val: '0' } }) });
  }
  if (request.italic !== undefined) {
    if (typeof request.italic !== 'boolean') return { ok: false, detail: 'italic: not a boolean' };
    properties.push({ localName: 'i', ...(request.italic ? {} : { attributes: { val: '0' } }) });
  }
  if (request.name !== undefined) {
    const name = request.name;
    if (typeof name !== 'string' || name.length === 0 || name.length > 128)
      return { ok: false, detail: 'name: not a font name' };
    // The value goes into an attribute the serializer escapes; what it must NOT carry is a
    // character XML cannot hold at all, which escaping does not fix.
    if (!isValidXmlText(name)) return { ok: false, detail: 'name: not valid XML text' };
    properties.push({
      localName: 'rFonts',
      attributes: { ascii: name, hAnsi: name, cs: name },
    });
  }
  if (request.size !== undefined) {
    const size = request.size;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0)
      return { ok: false, detail: 'size: not a positive number of points' };
    const halfPoints = Math.round(size * 2);
    if (halfPoints < 1 || halfPoints > MAX_HALF_POINTS)
      return { ok: false, detail: 'size: out of range' };
    properties.push({ localName: 'sz', attributes: { val: String(halfPoints) } });
    // `w:szCs` keeps complex-script runs the same size, which is what Word writes; leaving it
    // behind sizes Latin text and leaves Arabic or Hebrew in the same run at the old size.
    properties.push({ localName: 'szCs', attributes: { val: String(halfPoints) } });
  }
  if (request.color !== undefined) {
    const colour = request.color;
    if (typeof colour !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(colour.trim()))
      return { ok: false, detail: 'color: not a #RRGGBB triplet' };
    properties.push({
      localName: 'color',
      attributes: { val: colour.trim().slice(1).toUpperCase() },
    });
  }
  if (properties.length === 0) return { ok: false, detail: 'no formatting was asked for' };
  return { ok: true, value: properties };
}

/**
 * The `w:pPr` children a paragraph-format request authors.
 *
 * `w:ind` and `w:spacing` are single elements carrying several attributes, so a request that
 * touches one attribute of either must carry the attributes the paragraph already had — a
 * property write REPLACES the element it names. The prior values are read from the tree here
 * rather than left to the caller, because a caller that had to read-modify-write would make
 * every indent change two round trips and a race. The same reasoning one level up gives the
 * whole-container merge at the end.
 */
export function paragraphFormatProperties(
  part: OoxmlPart,
  paragraphId: string,
  request: AutomationParagraphFormatWrite
): FormattingPlan<OoxmlProperty[]> {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return { ok: false, detail: 'not a paragraph' };
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const properties: OoxmlProperty[] = [];

  if (request.alignment !== undefined) {
    const jc = JC_BY_ALIGNMENT[request.alignment];
    if (jc === undefined) return { ok: false, detail: `alignment: ${String(request.alignment)}` };
    properties.push({ localName: 'jc', attributes: { val: jc } });
  }

  const indent = namedChild(pPr, 'ind');
  const indentAttributes: Record<string, string> = attributesOf(indent);
  let touchedIndent = false;
  if (request.firstLineIndent !== undefined) {
    const twips = twipsFor(request.firstLineIndent, 'firstLineIndent');
    if (!twips.ok) return twips;
    // Exactly one of the two may be present: `w:firstLine` and `w:hanging` are alternatives,
    // and leaving the other behind would let the paragraph carry both.
    delete indentAttributes.firstLine;
    delete indentAttributes.hanging;
    if (twips.value < 0) indentAttributes.hanging = String(-twips.value);
    else indentAttributes.firstLine = String(twips.value);
    touchedIndent = true;
  }
  for (const [field, attribute, alias] of [
    ['leftIndent', 'left', 'start'],
    ['rightIndent', 'right', 'end'],
  ] as const) {
    const asked = request[field];
    if (asked === undefined) continue;
    const twips = twipsFor(asked, field);
    if (!twips.ok) return twips;
    // The `w:start`/`w:end` spellings are the same measurement under a different name; keeping
    // a stale one beside the value just written would leave the paragraph self-contradictory.
    delete indentAttributes[alias];
    indentAttributes[attribute] = String(twips.value);
    touchedIndent = true;
  }
  if (touchedIndent) properties.push({ localName: 'ind', attributes: indentAttributes });

  const spacing = namedChild(pPr, 'spacing');
  const spacingAttributes: Record<string, string> = attributesOf(spacing);
  let touchedSpacing = false;
  for (const [field, attribute] of [
    ['spaceBefore', 'before'],
    ['spaceAfter', 'after'],
  ] as const) {
    const asked = request[field];
    if (asked === undefined) continue;
    const twips = twipsFor(asked, field);
    if (!twips.ok) return twips;
    if (twips.value < 0) return { ok: false, detail: `${field}: out of range` };
    spacingAttributes[attribute] = String(twips.value);
    touchedSpacing = true;
  }
  if (request.lineSpacing !== undefined) {
    const twips = twipsFor(request.lineSpacing, 'lineSpacing');
    if (!twips.ok) return twips;
    if (twips.value <= 0) return { ok: false, detail: 'lineSpacing: out of range' };
    spacingAttributes.line = String(twips.value);
    // The paragraph's own rule is kept when it has one, because `exact` and `auto` are
    // different documents and a write of one number must not silently change which.
    spacingAttributes.lineRule ??= 'auto';
    touchedSpacing = true;
  }
  if (touchedSpacing) properties.push({ localName: 'spacing', attributes: spacingAttributes });

  if (request.widowControl !== undefined) {
    if (typeof request.widowControl !== 'boolean')
      return { ok: false, detail: 'widowControl: not a boolean' };
    properties.push({
      localName: 'widowControl',
      ...(request.widowControl ? {} : { attributes: { val: '0' } }),
    });
  }

  if (properties.length === 0) return { ok: false, detail: 'no formatting was asked for' };
  // `setParagraphProperties` REPLACES the container: an authorable property the op does not name
  // is DROPPED. So the op has to carry the paragraph's existing bag forward, or setting alignment
  // would delete its style, its numbering and its spacing.
  return {
    ok: true,
    value: mergedProperties(directParagraphProperties(part, paragraphId), properties),
  };
}

/** A property element's `w:`-namespace attributes as a plain record, safe to copy from. */
function attributesOf(element: OoxmlElement | undefined): Record<string, string> {
  const record: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!element) return record;
  for (const entry of element.attributes) {
    // Attribute NAMES come from a file. Assigning one as an object key is the
    // prototype-pollution hazard the repository audits for; a null-prototype record has no
    // `__proto__` to reach, so the class of problem is absent rather than filtered.
    record[entry.localName] = entry.value;
  }
  return record;
}
