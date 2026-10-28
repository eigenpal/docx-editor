// Note reference formatting belongs to the reference, not to the next character. Text typed
// after a reference takes the face of the text around it instead (`noteTypingSourceRun`).

import { withFreshIds } from '../package/hf-lifecycle-shell.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { replaceChildren, type EditOptions, type OoxmlEditResult } from '../package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { NOT_INHERITED } from './mark-character-style-run.ts';
import {
  isRunPropertiesNode,
  paragraphPropertiesNodeOf,
  parentOf,
  runPropertiesNodeOf,
} from './tree-op-nodes.ts';
import { build } from './tree-op-tracked-builders.ts';
import { paragraphOffsetIndex, type OffsetSpan } from './tree-op-segments.ts';
import { isFieldChrome } from '../package/field-nodes.ts';

/** The canonical body-side note reference immediately before this caret, if any. */
export function noteReferenceEndingAt(paragraph: OoxmlParagraphNode, offset: number) {
  return paragraphOffsetIndex(paragraph).segments.find(
    (segment) => segment.end === offset && segment.node.kind === 'noteReference'
  );
}

/** Text runs per paragraph revision; paragraph nodes are immutable. */
const textRunsCache = new WeakMap<OoxmlParagraphNode, readonly OoxmlNode[]>();

/**
 * Runs that hold text, in document order. A run that holds a note reference, field chrome,
 * or deleted text does not count. The walk stops at each run, so text box content inside a
 * drawing never counts.
 */
function textRunsOf(paragraph: OoxmlParagraphNode): readonly OoxmlNode[] {
  const cached = textRunsCache.get(paragraph);
  if (cached) return cached;
  const runs: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') return;
    if (node.kind !== 'run') {
      for (const child of node.children) walk(child);
      return;
    }
    const { children } = node;
    if (
      children.some((child) => child.kind === 'text') &&
      !children.some((child) => child.kind === 'noteReference' || isFieldChrome(child))
    ) {
      runs.push(node);
    }
  };
  for (const child of paragraph.children) walk(child);
  textRunsCache.set(paragraph, runs);
  return runs;
}

/**
 * The run whose face text typed at `offset` after a note reference takes: the nearest text
 * run before the caret, past any note references, or else the first text run after it.
 * `null` when the paragraph has no such run, so the text takes the paragraph mark's face.
 */
export function noteTypingSourceRun(
  paragraph: OoxmlParagraphNode,
  offset: number
): OoxmlNode | null {
  const offsets = paragraphOffsetIndex(paragraph);
  let before: OoxmlNode | null = null;
  for (const run of textRunsOf(paragraph)) {
    const span = offsets.spanOf(run);
    if (span === null || span.start === span.end) continue;
    if (span.end <= offset) before = run;
    else if (span.start >= offset) return before ?? run;
  }
  return before;
}

/** The offsets of `noteTypingSourceRun`, for a reader that resolves formatting by offset. */
export function noteTypingSourceRange(
  paragraph: OoxmlParagraphNode,
  offset: number
): OffsetSpan | null {
  const run = noteTypingSourceRun(paragraph, offset);
  return run ? paragraphOffsetIndex(paragraph).spanOf(run) : null;
}

/**
 * The run properties for text typed at `offset` after a note reference: the face of
 * `noteTypingSourceRun`, or the paragraph mark's face when there is no such run. Never the
 * reference's own run properties, and never revision or hidden-text properties.
 */
export function noteTypingProperties(
  paragraph: OoxmlParagraphNode,
  offset: number,
  mint: () => string
): OoxmlNode[] {
  const holder = noteTypingSourceRun(paragraph, offset) ?? paragraphPropertiesNodeOf(paragraph);
  const properties = holder ? runPropertiesNodeOf(holder) : undefined;
  if (!properties) return [];
  const children = properties.children.filter(
    (node) =>
      node.kind === 'textValue' ||
      node.namespaceUri !== WML_NAMESPACE_URI ||
      !NOT_INHERITED.has(node.localName)
  );
  return children.length ? [withFreshIds({ ...properties, children } as OoxmlNode, mint)] : [];
}

/** Split a shared reference run without changing its reference or remaining text. */
export function insertAfterNoteInRun(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  run: OoxmlNode,
  index: number,
  nodes: readonly OoxmlNode[],
  mint: () => string,
  options?: EditOptions
): OoxmlEditResult | null {
  const parent = parentOf(part, run.id);
  if (!parent || run.kind !== 'run') return null;
  const head = { ...run, children: run.children.slice(0, index) } as OoxmlNode;
  const remaining = run.children.slice(index);
  const tail = remaining.length
    ? [
        {
          ...run,
          id: mint(),
          children: [
            ...run.children.filter(isRunPropertiesNode).map((node) => withFreshIds(node, mint)),
            ...remaining,
          ],
        } as OoxmlNode,
      ]
    : [];
  const inserted = build(
    mint(),
    'run',
    'r',
    [],
    [...noteTypingProperties(paragraph, offset, mint), ...nodes]
  );
  return replaceChildren(
    part,
    parent.id,
    parent.children.flatMap((child) => (child.id === run.id ? [head, inserted, ...tail] : [child])),
    options
  );
}
