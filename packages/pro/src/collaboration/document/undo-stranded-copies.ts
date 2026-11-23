/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Text an undo of a split puts back shows after the text it followed.
 *
 * A split copies the text after its split point into its new paragraph. When two peers split
 * one paragraph at once, the text after both points has a copy in both new paragraphs, and
 * the later one shows it (`copy-holder-order.ts`). A later split of the other new paragraph
 * moves only what that paragraph shows, so its hidden copy of that text stays behind, after
 * the text the later split moved away. An undo of the split that showed the text puts its
 * characters back in their first place, and the copy left behind shows them, in the wrong
 * paragraph.
 *
 * So before the undo, the undoing replica records what each paragraph the step listed shows.
 * After it, a moved copy of such a character that shows in a paragraph other than the one
 * the text joins is removed, when the undo put the character back elsewhere. The character
 * that the undo put back then follows the text it was typed after
 * (`paragraph-text-follow.ts`), as it does when no copy was left behind.
 */
import type { Identity } from './paragraph-text-identity.ts';
import { textIdentities } from './paragraph-text-identity.ts';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { undonePlaces } from './undo-kept-properties.ts';

/** What one paragraph an undo unlists showed, and the paragraph its text joins. */
export interface UndoneText {
  readonly paragraph: LogicalId;
  readonly target: LogicalId;
  readonly shown: readonly Identity[];
}

/** Before an undo of `step`: the characters each paragraph it listed shows. */
export function undoneTexts(registry: DocumentRegistry, step: unknown): UndoneText[] {
  const out: UndoneText[] = [];
  for (const { paragraph, target } of undonePlaces(registry, step)) {
    const text = registry.inline.textOf(paragraph);
    if (!text) continue;
    const { identities, hidden } = registry.inline.follow.shown(paragraph, text);
    const shown = identities.ids.filter(
      (id, position): id is Identity => id !== null && !hidden.has(position)
    );
    if (shown.length > 0) out.push({ paragraph, target, shown });
  }
  return out;
}

/** For each paragraph read, the identities of the characters an undo put back in it. */
type RestoredCache = Map<LogicalId, ReadonlySet<Identity>>;

/** Whether a listed paragraph other than `except` holds `id` as a character an undo put back. */
function restoredElsewhere(
  registry: DocumentRegistry,
  id: Identity,
  except: LogicalId,
  cache: RestoredCache
): boolean {
  for (const holder of registry.inline.follow.holdersOf(id)) {
    if (holder === except || registry.parentOf(holder) === null) continue;
    let restored = cache.get(holder);
    if (!restored) {
      const text = registry.inline.textOf(holder);
      const identities = text ? textIdentities(text) : null;
      restored = new Set(
        identities?.ids.filter((other, at): other is Identity => !!other && identities.restored[at])
      );
      cache.set(holder, restored);
    }
    if (restored.has(id)) return true;
  }
  return false;
}

/**
 * After the undo: remove each moved copy that shows a character an unlisted paragraph showed,
 * in another paragraph than the one its text joins, when the undo put that character back.
 * Returns whether it removed any.
 */
export function removeStrandedCopies(
  registry: DocumentRegistry,
  texts: readonly UndoneText[]
): boolean {
  const stranded = new Map<LogicalId, Set<Identity>>();
  const cache: RestoredCache = new Map();
  for (const { paragraph, target, shown } of texts) {
    if (registry.parentOf(paragraph) !== null || registry.parentOf(target) === null) continue;
    for (const id of shown) {
      const holder = registry.inline.follow.shownCopy(id);
      if (holder === null || holder === target || holder === paragraph) continue;
      if (registry.parentOf(holder) === null || !restoredElsewhere(registry, id, holder, cache))
        continue;
      const ids = stranded.get(holder) ?? new Set<Identity>();
      ids.add(id);
      stranded.set(holder, ids);
    }
  }
  let removed = false;
  for (const [holder, ids] of stranded) {
    const text = registry.inline.textOf(holder);
    if (!text) continue;
    const identities = textIdentities(text);
    // Positions of the moved copies to remove, deleted from the end so positions hold.
    const positions = identities.ids.flatMap((id, at) =>
      id !== null && ids.has(id) && identities.moved[at] && !identities.restored[at] ? [at] : []
    );
    for (let end = positions.length; end > 0;) {
      let start = end - 1;
      while (start > 0 && positions[start - 1] === positions[start]! - 1) start -= 1;
      text.delete(positions[start]!, positions[end - 1]! - positions[start]! + 1);
      removed = true;
      end = start;
    }
  }
  return removed;
}
