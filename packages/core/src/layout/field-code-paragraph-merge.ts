// One line for the paragraph that opens a field and the paragraph where its field codes end.
//
// A complex field runs from a `w:fldChar` (CT_FldChar, §17.16.18) of `ST_FldCharType` `begin`
// to its `end` (§17.18.29), and its field codes run up to the `separate` character, or to `end`
// when there is none. When those field codes hold paragraph marks, the mark of the paragraph
// that holds `begin` is field code too, like the marks of the paragraphs wholly inside (see
// `field-instruction-paragraphs.ts`). Only the field result displays, so the text before
// `begin` and the text after the field codes show as ONE paragraph: "before Result after".
//
// This is display only. The tree keeps both paragraphs, and the merged paragraph is a merge
// group like the one a resolved revision view builds (`story-roots.ts`), so every span maps
// back to the paragraph that holds it.
//
// The merged line takes the properties of the paragraph that holds `begin`: its alignment,
// indentation, and space before. The paragraph mark that ends the line is the last one, so its
// direct space after applies. The first paragraph's list item counts nothing, because its mark
// is field code (see `listCountingBlocks`). The last paragraph's list item still counts, but
// shows no number: the line is laid out with the first paragraph's properties.
//
// This rule differs on purpose from the merge a resolved revision view builds, where the LAST
// paragraph's properties govern. There a deleted paragraph mark goes away, and the paragraph
// whose mark survives keeps its properties. Here no mark goes away: the first paragraph's mark
// is field code, so the line continues the first paragraph, and the last mark only ends it.
// Taking the last paragraph's properties would move the line's alignment and indentation to
// a paragraph whose start is hidden inside the field codes. The counted, unshown number of the
// last paragraph can leave a gap in a list ("1." then "3."); that gap is what the document's
// own numbering says.
//
// Content that stays inside the crossing field's codes is field code too, and displays nothing:
// a field nested in the instruction (`IF { QUOTE "A" } = "A" "...`) shows no result. Each run
// whose content lies wholly in those codes is hidden (`w:vanish`) in the merged copy. It keeps
// its offsets, so the store and the merged line still count the same. A run that mixes field
// code with displayed content keeps showing.
//
// The two halves join only where the result stays addressable. The field that crosses the
// mark would close inside the merged paragraph and take one atomic offset there, while the
// store counts each half on its own. So the crossing field's own characters and instruction
// are left out of the merged copy. That copy must then count exactly what the store counts for
// each half, and hold no other field that crosses into a third paragraph. When either check
// fails, the two paragraphs keep their own lines.

import type { OoxmlElement, OoxmlNode, OoxmlParagraphNode } from '@docx-editor.dev/core/store';
import { fldCharType, isInstrText } from '../store/package/field-nodes.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';

/** Content a field instruction cannot reach into: a drawing or text box is its own story. */
const OWN_STORIES = new Set(['drawing', 'pict', 'object', 'AlternateContent', 'txbxContent']);

/** Spacing attributes that belong to the paragraph mark at the end of the line. */
const AFTER_ATTRIBUTES = new Set(['after', 'afterLines', 'afterAutospacing']);

/** What the caller supplies from the story collector. */
export interface FieldCodeMergeHooks {
  /** Names the view `addressable` answers for; a merge is reused only in the same view. */
  readonly viewKey: string;
  /** True when layout can address the paragraph's content at the store's offsets. */
  readonly addressable: (paragraph: OoxmlElement) => boolean;
  /** True when every field the paragraph opens also closes inside it. */
  readonly balanced: (paragraph: OoxmlElement) => boolean;
  /** Record `merged` as one paragraph standing for `members`. */
  readonly register: (merged: OoxmlElement, members: readonly OoxmlElement[]) => void;
}

function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function isParagraphProperties(node: OoxmlNode): boolean {
  return node.kind !== 'textValue' && (node.kind === 'paragraphProperties' || isWml(node, 'pPr'));
}

/**
 * The paragraph without the crossing field's own characters and instruction.
 *
 * `side` names where the crossing field sits: `opens` for the paragraph that holds its `begin`
 * (the field is still open at the paragraph's end), `closes` for the paragraph where its field
 * codes end (the field is open, in its field codes, at the paragraph's start). Fields nested in
 * the crossing field's instruction stay. Null when nothing crosses as expected.
 */
function withoutCrossingField(
  paragraph: OoxmlElement,
  side: 'opens' | 'closes'
): OoxmlElement | null {
  // `depth` counts the open fields, and the crossing field is depth 1. `crossing` is true while
  // the crossing field is open, and `inCodes` while it is in its field codes.
  let depth = side === 'opens' ? 0 : 1;
  let crossing = side === 'closes';
  let inCodes = crossing;
  let removedAny = false;
  const drop = new Set<OoxmlNode>();
  /** Runs whose content lies wholly in the crossing field's codes; hidden in the copy. */
  const hide = new Set<OoxmlNode>();
  let run: { node: OoxmlNode; codes: number; other: number } | null = null;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'run' && run === null) {
      run = { node, codes: 0, other: 0 };
      for (const child of node.children) {
        if (child.kind === 'runProperties') continue;
        if (crossing && inCodes) run.codes += 1;
        else run.other += 1;
        visit(child);
      }
      if (run.codes > 0 && run.other === 0) hide.add(node);
      run = null;
      return;
    }
    const type = fldCharType(node);
    if (type === 'begin') {
      depth += 1;
      if (side === 'opens' && depth === 1) {
        // Any earlier top-level field closed already; this one is the new candidate.
        drop.clear();
        hide.clear();
        crossing = true;
        inCodes = true;
        drop.add(node);
      }
      return;
    }
    if (type === 'separate') {
      if (crossing && depth === 1 && inCodes) {
        drop.add(node);
        inCodes = false;
      }
      return;
    }
    if (type === 'end') {
      if (crossing && depth === 1) {
        // In the first paragraph, a field that closes there does not cross.
        if (side === 'closes') drop.add(node);
        else {
          drop.clear();
          hide.clear();
        }
        crossing = false;
        inCodes = false;
      }
      if (depth > 0) depth -= 1;
      return;
    }
    if (isInstrText(node)) {
      if (crossing && depth === 1 && inCodes) drop.add(node);
      return;
    }
    if (OWN_STORIES.has(node.localName)) return;
    for (const child of node.children) visit(child);
  };
  visit(paragraph);
  if (side === 'opens' && !(crossing && depth === 1)) return null;
  if (drop.size === 0) return null;
  const rebuild = (node: OoxmlNode): OoxmlNode | null => {
    if (drop.has(node)) {
      removedAny = true;
      return null;
    }
    if (node.kind === 'textValue' || OWN_STORIES.has(node.localName)) return node;
    let changed = false;
    const children: OoxmlNode[] = [];
    for (const child of node.children) {
      const next = rebuild(child);
      if (next !== child) changed = true;
      if (next !== null) children.push(next);
    }
    const rebuilt = changed ? ({ ...node, children } as OoxmlElement) : node;
    return hide.has(node) ? hiddenRun(rebuilt as OoxmlElement) : rebuilt;
  };
  const rebuilt = rebuild(paragraph) as OoxmlElement;
  return removedAny ? rebuilt : null;
}

/** `run` with a direct `w:vanish` (17.3.2.41) in its run properties, for the merged copy only. */
function hiddenRun(run: OoxmlElement): OoxmlElement {
  const vanish = {
    id: `${run.id}~field-code-vanish`,
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'vanish',
    prefix: run.prefix,
    namespaceBindings: [],
    attributes: [],
    children: [],
  } as unknown as OoxmlNode;
  const index = run.children.findIndex((child) => child.kind === 'runProperties');
  const properties = run.children[index] as OoxmlElement | undefined;
  const children = properties
    ? run.children.map((child, at) =>
        at === index
          ? ({
              ...properties,
              children: [...properties.children.filter((entry) => !isWml(entry, 'vanish')), vanish],
            } as OoxmlElement)
          : child
      )
    : [
        {
          id: `${run.id}~field-code-rPr`,
          kind: 'runProperties',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'rPr',
          prefix: run.prefix,
          namespaceBindings: [],
          attributes: [],
          children: [vanish],
        } as unknown as OoxmlNode,
        ...run.children,
      ];
  return { ...run, children } as OoxmlElement;
}

function spacingOf(properties: OoxmlElement | undefined): OoxmlElement | undefined {
  return properties?.children.find((child) => isWml(child, 'spacing')) as OoxmlElement | undefined;
}

/** The first paragraph's properties, with the last paragraph's direct space after. */
function mergedProperties(first: OoxmlElement, last: OoxmlElement): OoxmlNode[] {
  const firstProperties = first.children.find(isParagraphProperties) as OoxmlElement | undefined;
  const lastProperties = last.children.find(isParagraphProperties) as OoxmlElement | undefined;
  const firstSpacing = spacingOf(firstProperties);
  const lastAfter = (spacingOf(lastProperties)?.attributes ?? []).filter((attribute) =>
    AFTER_ATTRIBUTES.has(attribute.localName)
  );
  const firstAfter = (firstSpacing?.attributes ?? []).some((attribute) =>
    AFTER_ATTRIBUTES.has(attribute.localName)
  );
  if (lastAfter.length === 0 && !firstAfter) return firstProperties ? [firstProperties] : [];
  const template = firstSpacing ?? spacingOf(lastProperties)!;
  const spacing = {
    ...template,
    attributes: [
      ...(firstSpacing?.attributes ?? []).filter(
        (attribute) => !AFTER_ATTRIBUTES.has(attribute.localName)
      ),
      ...lastAfter,
    ],
  } as OoxmlElement;
  const holder = firstProperties ?? lastProperties!;
  const children: OoxmlNode[] = firstProperties
    ? firstProperties.children.map((child: OoxmlNode) => (child === firstSpacing ? spacing : child))
    : [spacing];
  if (firstProperties && !firstSpacing) children.push(spacing);
  return [{ ...holder, children } as OoxmlElement];
}

const offsetLength = (paragraph: OoxmlElement): number =>
  paragraphOffsetIndex(paragraph as OoxmlParagraphNode).length;

/** Merges already built, per first paragraph node and view, while the last stays the same. */
const mergedByFirst = new WeakMap<
  OoxmlElement,
  Map<string, { readonly last: OoxmlElement; readonly merged: OoxmlElement | null }>
>();

/** Views remembered per first paragraph; display modes and author filters are few. */
const MAX_VIEWS = 8;

/**
 * `first`, which holds a field's `begin`, and `last`, where its field codes end, as one
 * paragraph for layout; null when the two cannot be addressed as one.
 */
export function fieldCodeMergedParagraph(
  first: OoxmlElement,
  last: OoxmlElement,
  hooks: FieldCodeMergeHooks
): OoxmlElement | null {
  let perView = mergedByFirst.get(first);
  const cached = perView?.get(hooks.viewKey);
  if (cached && cached.last === last) return cached.merged;
  const merged = buildMerged(first, last, hooks);
  if (!perView) mergedByFirst.set(first, (perView = new Map()));
  if (perView.size >= MAX_VIEWS) perView.clear();
  perView.set(hooks.viewKey, { last, merged });
  return merged;
}

function buildMerged(
  first: OoxmlElement,
  last: OoxmlElement,
  hooks: FieldCodeMergeHooks
): OoxmlElement | null {
  const opening = withoutCrossingField(first, 'opens');
  const closing = withoutCrossingField(last, 'closes');
  if (!opening || !closing) return null;
  for (const [original, copy] of [
    [first, opening],
    [last, closing],
  ] as const) {
    if (!hooks.balanced(copy) || !hooks.addressable(copy)) return null;
    if (offsetLength(copy) !== offsetLength(original)) return null;
  }
  const content = [opening, closing].flatMap((member) =>
    member.children.filter((child) => !isParagraphProperties(child))
  );
  const merged = {
    ...first,
    children: [...mergedProperties(first, last), ...content],
  } as OoxmlElement;
  hooks.register(merged, [first, last]);
  return merged;
}
