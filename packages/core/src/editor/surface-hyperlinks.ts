// The surface's hyperlink lane (paginated-surface seam).
//
// Insert, retarget, unlink and "what link is the caret in" — every one expressed as ONE
// `transact` so it is one undo step, which is what makes editing a URL feel like editing a
// word rather than like a script that ran.
//
// The trust boundary stays where it was. A URL arriving here is HOST-supplied (a popover
// input, an agent call) and is written to the package only through
// `session.ensureHyperlinkRelationship`, which refuses anything `sanitizeHref` refuses. What
// comes BACK — for the popover to show, for a click to open — is always the sanitized
// projection layout already resolved, never the authored string.

import type { TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import {
  hyperlinkTargetOf,
  type OoxmlNode,
  type OoxmlPart,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core-contract/store';
import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core-contract/layout';

/**
 * A hyperlink as the surface reports it: its identity, where it sits, and the SANITIZED
 * target. `href: null` is an inert link — a refused scheme or a dangling relationship — which
 * a UI shows and offers to edit but must never offer to open.
 */
export interface SurfaceHyperlink {
  /** Canonical node id of the `w:hyperlink`. */
  readonly id: string;
  readonly paragraphId: string;
  /** UTF-16 range of the link's display text within its paragraph. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly kind: 'external' | 'internal' | 'unresolved';
  /** Sanitized projection: an absolute URL, `#anchor`, or null when inert. */
  readonly href: string | null;
  /** The authored target, for an editor to seed its input with. */
  readonly authored: string;
  readonly anchor?: string;
  readonly tooltip?: string;
}

/** Every run under a node, at any depth — a `w:r`, or the runs inside a link. */
function runsUnder(node: OoxmlNode): OoxmlNode[] {
  if (node.kind === 'run') return [node];
  if (node.kind !== 'hyperlink') return [];
  return node.children.flatMap((child) => runsUnder(child));
}

/** The measurable length of one inline node, in `paragraphTextOf`'s vocabulary. */
function inlineLength(node: OoxmlNode): number {
  if (node.kind === 'textValue') return node.value.length;
  if (node.kind === 'tab' || node.kind === 'hardBreak') return 1;
  if (node.kind === 'runProperties' || node.kind === 'generic') return 0;
  let total = 0;
  for (const child of node.children) total += inlineLength(child);
  return total;
}

/**
 * Every typed hyperlink in one paragraph, with the offsets it covers.
 *
 * Walks the paragraph's inline children in order, accumulating the same offsets `segmentsOf`
 * produces, so a range reported here is a range the ops accept.
 */
export function hyperlinksInParagraph(
  part: OoxmlPart,
  paragraphId: string,
  resolve: (relationshipId: string) => { target: string; external: boolean } | null,
  textOf: (paragraphId: string) => string
): SurfaceHyperlink[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const text = textOf(paragraphId);
  const found: SurfaceHyperlink[] = [];
  let offset = 0;
  for (const child of paragraph.children) {
    if (child.kind === 'run') {
      offset += inlineLength(child);
      continue;
    }
    if (child.kind !== 'hyperlink') continue;
    const start = offset;
    for (const run of runsUnder(child)) offset += inlineLength(run);
    const target = hyperlinkTargetOf(child, resolve);
    found.push({
      id: child.id,
      paragraphId,
      start,
      end: offset,
      text: text.slice(start, offset),
      kind: target.kind,
      href: target.href,
      authored: target.authored,
      ...(target.anchor !== undefined ? { anchor: target.anchor } : {}),
      ...(target.tooltip !== undefined ? { tooltip: target.tooltip } : {}),
    });
  }
  return found;
}

/** A node by id, without importing the store's private walk. */
function findNode(part: OoxmlPart, nodeId: string): OoxmlNode | null {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return node.id === nodeId ? node : null;
    if (node.id === nodeId) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(part.root);
}

/**
 * The link a position sits in, or null.
 *
 * INCLUSIVE OF BOTH EDGES, deliberately. A caret at the very end of a link is still "in" it
 * for the purposes of Ctrl+K and the popover, because that is where the caret lands after
 * clicking the last character — and Word treats it the same way. It is NOT inclusive for
 * typing (that is the ops' business, and they append outside the link, as Word does).
 */
export function hyperlinkAtPosition(
  links: readonly SurfaceHyperlink[],
  position: SemanticPosition
): SurfaceHyperlink | null {
  for (const link of links) {
    if (link.paragraphId !== position.paragraphId) continue;
    if (position.offset >= link.start && position.offset <= link.end) return link;
  }
  return null;
}

export interface HyperlinkOpsDeps {
  readonly session: TreeDocxSession;
  /** Active story for reads/writes — body, header/footer, or notes part. */
  storyScope(): StoryScope;
  readonly selection: () => SemanticSelection;
  readonly orderedRange: () => { from: SemanticPosition; to: SemanticPosition };
  readonly selectionMark: () => { paragraphId: string; start: number; end: number } | null;
  readonly textOf: (paragraphId: string) => string;
  readonly commit: (
    run: () => ReturnType<TreeDocxSession['applyTreeOps']> | boolean,
    selectionAfter?: () => SemanticSelection | null
  ) => void;
}

export interface HyperlinkOps {
  /** Every link in the paragraph the caret is in. */
  linksInCaretParagraph(): SurfaceHyperlink[];
  /** The link the caret sits in, or null. */
  linkAtCaret(): SurfaceHyperlink | null;
  /** The link with this node id, or null. */
  linkById(linkId: string): SurfaceHyperlink | null;
  /**
   * Apply a link to the selection, or retarget the one the caret is already in.
   *
   * `text` replaces the display text when supplied. Returns whether anything committed;
   * a refusal leaves the document exactly as it was.
   */
  applyHyperlink(input: {
    readonly url?: string;
    readonly anchor?: string;
    readonly text?: string;
    readonly tooltip?: string;
  }): boolean;
  /** Take the link off the one at the caret (or a named one). Returns whether it committed. */
  removeHyperlink(linkId?: string): boolean;
}

export function createHyperlinkOps(deps: HyperlinkOpsDeps): HyperlinkOps {
  const scope = () => deps.storyScope();
  const storyPart = (): OoxmlPart | null => deps.session.partFor(scope());
  const resolve = (relationshipId: string) =>
    deps.session.relationshipTarget(relationshipId, scope());
  const applyOps = (
    ops: Parameters<TreeDocxSession['applyTreeOps']>[0],
    before?: Parameters<TreeDocxSession['applyTreeOps']>[1],
    after?: Parameters<TreeDocxSession['applyTreeOps']>[2]
  ) => deps.session.applyTreeOps(ops, before, after, scope());

  const linksIn = (paragraphId: string): SurfaceHyperlink[] => {
    const part = storyPart();
    if (!part) return [];
    return hyperlinksInParagraph(part, paragraphId, resolve, deps.textOf);
  };

  const linkAtCaret = (): SurfaceHyperlink | null =>
    hyperlinkAtPosition(linksIn(deps.selection().head.paragraphId), deps.selection().head);

  const linkById = (linkId: string): SurfaceHyperlink | null => {
    // The link's own paragraph is the one holding it; walking the caret's paragraph first
    // covers every real caller in one lookup, and the full scan is the fallback.
    const caretParagraph = deps.selection().head.paragraphId;
    const near = linksIn(caretParagraph).find((link) => link.id === linkId);
    if (near) return near;
    for (const paragraphId of deps.session.paragraphIdsIn(scope())) {
      const found = linksIn(paragraphId).find((link) => link.id === linkId);
      if (found) return found;
    }
    return null;
  };

  return {
    linksInCaretParagraph: () => linksIn(deps.selection().head.paragraphId),
    linkAtCaret,
    linkById,

    applyHyperlink(input) {
      const wantsExternal = input.url !== undefined && input.url.length > 0;
      const wantsInternal = input.anchor !== undefined && input.anchor.length > 0;
      // Exactly one target, matching the op's own rule — a caller that supplies both does
      // not know which it wants, and picking one for it writes a link nobody chose.
      if (wantsExternal === wantsInternal) return false;

      // Refuse before minting when the active story cannot be resolved: a scoped insert that
      // fell back to the body would leave a stray main-document relationship behind.
      const active = scope();
      if (!storyPart()) return false;

      // The relationship is minted BEFORE the transaction: it lives on the package, outside
      // the undo stack, and a refused URL must not leave a half-applied edit behind.
      let relationshipId: string | undefined;
      if (wantsExternal) {
        const minted = deps.session.ensureHyperlinkRelationship(input.url!, active);
        if (!minted) return false;
        relationshipId = minted;
      }
      const target = {
        ...(relationshipId !== undefined ? { relationshipId } : {}),
        ...(wantsInternal ? { anchor: input.anchor! } : {}),
        ...(input.tooltip !== undefined ? { tooltip: input.tooltip } : {}),
      };

      const existing = linkAtCaret();
      const range = deps.orderedRange();
      const collapsed =
        range.from.paragraphId === range.to.paragraphId && range.from.offset === range.to.offset;

      // RETARGET when the caret is inside a link and the selection adds nothing: this is
      // Ctrl+K on an existing link, and replacing the element would throw away its authored
      // `w:history` / `w:tgtFrame` and its identity.
      if (existing && (collapsed || withinLink(existing, range))) {
        const ops: TreeDocOp[] = [{ op: 'setHyperlinkTarget', linkId: existing.id, ...target }];
        // Replacing the display text is a delete plus an insert over the link's own range;
        // both land inside the link because the range is strictly inside it.
        if (input.text !== undefined && input.text !== existing.text) {
          const replaced = replaceTextOps(
            existing.paragraphId,
            existing.start,
            existing.end,
            input.text
          );
          if (!replaced) return false;
          ops.push(...replaced);
        }
        let committed = false;
        deps.commit(
          () => {
            const result = applyOps(ops, deps.selectionMark());
            committed = result.committed;
            return result;
          },
          () => null
        );
        return committed;
      }

      // INSERT. A collapsed caret has no text to wrap, so the display text — the URL itself
      // when the caller supplied none — is inserted first and then wrapped, in one
      // transaction. That is Word's behaviour and it is what makes Ctrl+K on an empty caret
      // produce a usable link rather than nothing at all.
      const paragraphId = range.from.paragraphId;
      if (range.to.paragraphId !== paragraphId) return false; // a link cannot span paragraphs
      const ops: TreeDocOp[] = [];
      let start = range.from.offset;
      let end = range.to.offset;

      if (collapsed) {
        const display = input.text ?? input.url ?? input.anchor ?? '';
        if (display.length === 0) return false;
        ops.push({ op: 'insertText', paragraphId, offset: start, text: display });
        end = start + display.length;
      } else if (
        input.text !== undefined &&
        input.text !== deps.textOf(paragraphId).slice(start, end)
      ) {
        const replaced = replaceTextOps(paragraphId, start, end, input.text);
        if (!replaced) return false;
        ops.push(...replaced);
        end = start + input.text.length;
      }
      if (end <= start) return false;
      // Word marks a new link's text with the `Hyperlink` CHARACTER STYLE, and without it
      // the user gets a link indistinguishable from the words around it — no way to tell
      // the command worked. The op carries it, so wrapping and marking are one step and one
      // undo. Only when the document actually declares the style: a reference to a style
      // that is not there is a dangling one, and a link with the surrounding appearance is
      // the honest fallback.
      const styleId = hyperlinkStyleId(deps.session);
      ops.push({
        op: 'insertHyperlink',
        paragraphId,
        start,
        end,
        ...target,
        ...(styleId ? { styleId } : {}),
      });

      let committed = false;
      const after = { paragraphId, offset: end };
      deps.commit(
        () => {
          const result = applyOps(ops, deps.selectionMark(), {
            paragraphId,
            start: end,
            end,
          });
          committed = result.committed;
          return result;
        },
        () => ({ anchor: after, head: after })
      );
      return committed;
    },

    removeHyperlink(linkId) {
      if (!storyPart()) return false;
      const link = linkId ? linkById(linkId) : linkAtCaret();
      if (!link) return false;
      let committed = false;
      // The caret stays where the text is: unlinking must not move it, because the user's
      // next keystroke is aimed at the word they were just looking at.
      const after = { paragraphId: link.paragraphId, offset: link.end };
      deps.commit(
        () => {
          const result = applyOps(
            [{ op: 'removeHyperlink', linkId: link.id }],
            deps.selectionMark()
          );
          committed = result.committed;
          return result;
        },
        () => ({ anchor: after, head: after })
      );
      return committed;
    },
  };
}

/**
 * The document's own hyperlink character style, or null when it declares none.
 *
 * Matched by STYLE ID (`Hyperlink`, Word's own, case-insensitively) among the character
 * styles. Creating the style when it is absent belongs to a styles-editing lane; until then
 * a document without it gets a working link with the surrounding appearance, which is
 * lossless and honest — rather than a reference to a style that does not exist.
 */
function hyperlinkStyleId(session: TreeDocxSession): string | null {
  for (const style of session.documentStyles()) {
    if (style.type !== 'character') continue;
    if (style.styleId.toLowerCase() === 'hyperlink') return style.styleId;
  }
  return null;
}

/** Whether a selection lies entirely within one link's display text. */
function withinLink(
  link: SurfaceHyperlink,
  range: { from: SemanticPosition; to: SemanticPosition }
): boolean {
  return (
    range.from.paragraphId === link.paragraphId &&
    range.to.paragraphId === link.paragraphId &&
    range.from.offset >= link.start &&
    range.to.offset <= link.end
  );
}

/**
 * Replace one range's text, INSERT FIRST.
 *
 * Delete-then-insert reads more naturally and destroys a link. Deleting a link's whole
 * display text empties every run inside it, the delete's own cleanup then removes the
 * emptied `w:hyperlink`, and the insert that follows lands in a plain run — so editing the
 * display text of an existing link silently unlinked it while reporting success. That is
 * the ordinary Ctrl+K-then-change-the-text flow.
 *
 * Inserting at `start` first puts the new text inside the link (the offset is a boundary of
 * the link's first run), and the old text — now shifted right by the inserted length — is
 * deleted after. The link is never empty at any point, so nothing sweeps it away.
 */
function replaceTextOps(
  paragraphId: string,
  start: number,
  end: number,
  text: string
): TreeDocOp[] | null {
  if (text.length === 0) return null;
  const ops: TreeDocOp[] = [{ op: 'insertText', paragraphId, offset: start, text }];
  if (end > start) {
    ops.push({
      op: 'deleteText',
      paragraphId,
      start: start + text.length,
      end: end + text.length,
    });
  }
  return ops;
}
