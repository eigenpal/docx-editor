/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Whether shared state names a local edit's inline nodes differently from the editor.
 *
 * A local edit installs the tree the editor computed, not the one shared state shows. Shared
 * text names some nodes by rule: a run's property elements after the run's properties and
 * the property, a shell two paragraphs hold with a paragraph tag. The editor's tree keeps
 * the IDs it had, so after a formatting change, a join or a split it can name a node in a
 * way shared state does not, and the next local edit then addresses a node shared state
 * does not know. Comparing the IDs after each local edit tells the session to install the
 * shared view.
 */
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { embedPlaceholder } from './node-shapes.ts';
import { idOf, type LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { inlineChildren } from './paragraph-text-view.ts';
import type { InlinePlan } from './paragraph-text-writer.ts';

/** The IDs of inline nodes in order, not descending into records a text embeds. */
function inlineIds(registry: DocumentRegistry, nodes: readonly OoxmlNode[], out: string[]): void {
  for (const node of nodes) {
    out.push(node.id);
    if (node.kind === 'textValue' || registry.hasNode(idOf(node))) continue;
    inlineIds(registry, node.children, out);
  }
}

/**
 * Only the main document story is checked. A notes story the editor opened carries paragraph
 * identity shared state does not hold yet (#580), and installing the shared view would take
 * it from the author. A next edit there that names a node by an older ID still lands: the
 * router finds the paragraph that shows the node.
 */
export function viewRenamesPlan(registry: DocumentRegistry, plan: InlinePlan | null): boolean {
  if (!plan) return false;
  const main = registry.partEntries().find((entry) => entry.name === '/word/document.xml');
  for (const { id, after } of plan.paragraphs) {
    const text = registry.inline.textOf(id);
    if (!text || registry.isTombstoned(id)) continue;
    if (main && storyRootOf(registry, id) !== main.rootLogicalId) continue;
    const shown = inlineChildren(
      id,
      text,
      (embedded) => (registry.showsAsChild(embedded) ? embedPlaceholder(embedded) : null),
      registry.limits,
      registry.inline.viewOf(id)
    );
    const shownIds: string[] = [];
    inlineIds(registry, shown, shownIds);
    // Block children, the paragraph's own properties among them, are records on both sides.
    const editedIds: string[] = [];
    inlineIds(
      registry,
      after.children.filter(
        (child) => child.kind === 'textValue' || !isBlockChild(registry, child)
      ),
      editedIds
    );
    if (shownIds.length !== editedIds.length) return true;
    for (let at = 0; at < shownIds.length; at += 1) if (shownIds[at] !== editedIds[at]) return true;
  }
  return false;
}

function isBlockChild(registry: DocumentRegistry, node: OoxmlNode): boolean {
  return (
    node.kind === 'paragraphProperties' ||
    (registry.hasNode(idOf(node)) && !registry.inline.isEmbed(node.id))
  );
}

function storyRootOf(registry: DocumentRegistry, id: LogicalId): LogicalId {
  let at = id;
  for (let depth = 0; depth < registry.limits.maxTreeDepth; depth += 1) {
    const parent = registry.parentOf(at);
    if (parent === null) return at;
    at = parent;
  }
  return at;
}
