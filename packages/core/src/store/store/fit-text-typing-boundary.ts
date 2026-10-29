// Text typed right after the last character of a fitted group (`w:fitText`) does not join
// the group. It starts a run with the same formatting minus `w:fitText`, so the group keeps
// its characters and its width. Text typed INSIDE the group joins it, which is the ordinary
// left-run rule. Layout reads the property in `layout/fit-text-groups.ts`.

import { withFreshIds } from '../package/hf-lifecycle-shell.ts';
import { insertChildren, type EditOptions, type OoxmlEditResult } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { parentOf, runPropertiesNodeOf } from './tree-op-nodes.ts';
import { build } from './tree-op-tracked-builders.ts';

/** The `w:fitText` element of a run's properties, or undefined. */
function fitTextOf(run: OoxmlNode | undefined): OoxmlElement | undefined {
  const properties = run ? runPropertiesNodeOf(run) : undefined;
  if (!properties) return undefined;
  for (const child of properties.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'fitText'
    )
      return child;
  }
  return undefined;
}

function idOf(fitText: OoxmlElement): string {
  return fitText.attributes.find((attribute) => attribute.localName === 'id')?.value ?? '';
}

/**
 * Whether typing between `left` and `right` (the runs on each side of the caret, `right`
 * absent at a paragraph end) is right after the last character of a fitted group.
 */
export function endsFitTextGroup(left: OoxmlNode, right: OoxmlNode | undefined): boolean {
  const own = fitTextOf(left);
  if (!own) return false;
  const next = fitTextOf(right);
  return !next || idOf(next) !== idOf(own);
}

/** Insert `nodes` in a new run right after `run`, with its properties minus `w:fitText`. */
export function insertAfterFitTextGroup(
  part: OoxmlPart,
  run: OoxmlNode,
  nodes: readonly OoxmlNode[],
  mint: () => string,
  options?: EditOptions
): OoxmlEditResult | null {
  const parent = parentOf(part, run.id);
  if (!parent || run.kind !== 'run') return null;
  const index = parent.children.findIndex((child) => child.id === run.id);
  if (index < 0) return null;
  const properties = runPropertiesNodeOf(run);
  const kept = properties?.children.filter(
    (child) =>
      child.kind === 'textValue' ||
      child.namespaceUri !== WML_NAMESPACE_URI ||
      child.localName !== 'fitText'
  );
  const runProperties =
    properties && kept && kept.length > 0
      ? [withFreshIds({ ...properties, children: kept } as OoxmlNode, mint)]
      : [];
  const inserted = build(mint(), 'run', 'r', [], [...runProperties, ...nodes]);
  return insertChildren(part, parent.id, index + 1, [inserted], options);
}
