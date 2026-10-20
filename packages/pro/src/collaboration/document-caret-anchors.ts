/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The local selection, carried across remote changes on the shared characters beside it.
 *
 * Before shared state changes, while it still holds what the editor shows, each endpoint is
 * anchored on the character beside it (`selection-anchors.ts`). After the session publishes
 * the change, each endpoint stands beside that character again, wherever it shows. The
 * editor reads the result and falls back to mapping by text when there is none.
 *
 * Endpoints are kept in the editor's paragraph node ids, and paragraphs are read by node id.
 * A paragraph's stable id is its `w14:paraId`: two participants can mint the same one, and
 * the editor then renames one of them in its own tree while shared state keeps both.
 */
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type {
  CollaborationEditorSelection,
  CollaborationLocalSelection,
  CollaborationSelectionMove,
} from '@docx-editor.dev/core/collaboration';
import type { CollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import type { EncodedCharacter } from './document-awareness.ts';
import type { DocumentRegistry } from './document/registry.ts';
import type { LogicalId } from './document/identity.ts';
import {
  anchorAt,
  offsetIn,
  paragraphLayout,
  type CaretAnchor,
} from './document/selection-anchors.ts';

type EditorPoint = CollaborationEditorSelection['anchor'];

interface AnchoredPoint {
  /** The paragraph it was anchored in, or null when this replica no longer has it. */
  readonly paragraph: LogicalId | null;
  readonly anchor: CaretAnchor;
}

export interface CaretAnchorDeps {
  readonly registry: DocumentRegistry;
  readonly port: () => CollaborationDocumentPort | null;
  /** The logical ID of a node of the editor's tree. */
  readonly logicalIdOf: (nodeId: string) => LogicalId;
  /** An embedded node as last built. */
  readonly embedOf: (id: LogicalId) => OoxmlNode | null;
  /** Whether the editor shows what shared state holds, so a layout of it means what it shows. */
  readonly viewIsCurrent: () => boolean;
}

export class CaretAnchors {
  /** The selection the editor published, in its node ids. */
  private selection: CollaborationEditorSelection | null = null;
  private anchored: {
    readonly anchor: AnchoredPoint;
    readonly head: AnchoredPoint;
  } | null = null;
  private stale = true;
  private carried: CollaborationSelectionMove | null = null;

  constructor(private readonly deps: CaretAnchorDeps) {}

  /**
   * The editor published its selection. Its stable ids name its paragraphs only right now.
   * The same selection published again, as presence is, keeps its anchors: the characters
   * beside it still hold it, across any number of remote changes.
   */
  track(selection: CollaborationLocalSelection | null): void {
    const port = this.deps.port();
    const point = (address: CollaborationLocalSelection['anchor']): EditorPoint | null => {
      const paragraph = port?.paragraphByStableId(address.paragraphId);
      return paragraph ? { nodeId: paragraph.nodeId, offset: address.offset } : null;
    };
    const anchor = selection ? point(selection.anchor) : null;
    const head = selection ? point(selection.head) : null;
    const next = anchor && head ? { anchor, head } : null;
    if (next && this.selection && sameSelection(next, this.selection)) return;
    this.selection = next;
    this.stale = true;
    this.anchored = null;
    this.carried = null;
  }

  /**
   * This participant changes shared state. Its characters can move or go, so the selection is
   * anchored again at the next remote change, from what the editor then shows, even when the
   * editor publishes the same offsets again.
   */
  localChange(): void {
    this.stale = true;
    this.anchored = null;
    this.carried = null;
  }

  /** Shared state is about to change: anchor the selection on what the editor shows. */
  beforeChange(): void {
    if (!this.stale) return;
    this.stale = false;
    this.anchored = null;
    const selection = this.selection;
    if (!selection || !this.deps.viewIsCurrent()) return;
    const anchor = this.anchorOf(selection.anchor);
    const head = this.anchorOf(selection.head);
    if (anchor && head) this.anchored = { anchor, head };
  }

  /** The editor shows the change: carry the selection onto the characters it was beside. */
  afterPublish(): void {
    const { anchored, selection } = this;
    if (!anchored || !selection || !this.deps.viewIsCurrent()) {
      this.carried = null;
      return;
    }
    const anchor = this.resolve(anchored.anchor);
    const head = this.resolve(anchored.head);
    this.carried = anchor && head ? { from: selection, to: { anchor, head } } : null;
  }

  /** Where the last remote change carried the selection, or null to map it by text. */
  move(): CollaborationSelectionMove | null {
    return this.carried;
  }

  /** The shared character an endpoint the editor publishes stands beside, for peers. */
  characterOf(point: CollaborationLocalSelection['anchor']): EncodedCharacter | undefined {
    const paragraph = this.deps.port()?.paragraphByStableId(point.paragraphId);
    if (!paragraph || !this.deps.viewIsCurrent()) return undefined;
    const anchored = this.anchorOf({ nodeId: paragraph.nodeId, offset: point.offset });
    if (!anchored) return undefined;
    const { character, after } = anchored.anchor;
    return {
      item: character.item,
      ...(character.identity !== null ? { identity: character.identity } : {}),
      after,
    };
  }

  /**
   * Where a peer's endpoint stands here: beside the character it published, wherever that
   * shows. Null when this replica does not show it yet; the peer's offset then stands.
   */
  find(paragraphId: string, character: EncodedCharacter): EditorPoint | null {
    if (!this.deps.viewIsCurrent()) return null;
    // A paragraph a join or deletion removed: the character can still show in another.
    const paragraph = this.deps.port()?.paragraphByStableId(paragraphId);
    return this.resolve({
      paragraph: paragraph ? this.deps.logicalIdOf(paragraph.nodeId) : null,
      anchor: {
        character: { item: character.item, identity: character.identity ?? null },
        after: character.after,
      },
    });
  }

  /** As `find`, by the stable id of the paragraph that shows the character. */
  findStable(
    paragraphId: string,
    character: EncodedCharacter
  ): CollaborationLocalSelection['anchor'] | null {
    const found = this.find(paragraphId, character);
    const shown = found ? this.deps.port()?.paragraphByNodeId(found.nodeId) : null;
    return found && shown ? { paragraphId: shown.paragraphId, offset: found.offset } : null;
  }

  private anchorOf(point: EditorPoint): AnchoredPoint | null {
    const paragraph = this.deps.logicalIdOf(point.nodeId);
    const text = this.shownText(point.nodeId);
    if (text === null) return null;
    const layout = paragraphLayout(this.deps.registry, paragraph, this.deps.embedOf, text);
    const anchor = layout ? anchorAt(layout, point.offset) : null;
    return anchor ? { paragraph, anchor } : null;
  }

  private resolve(point: AnchoredPoint): EditorPoint | null {
    const { registry } = this.deps;
    const follow = registry.inline.follow;
    // An original character is its own identity; its copies carry its item key.
    const identity = point.anchor.character.identity ?? point.anchor.character.item;
    // Where the character can show: its paragraph, and wherever a copy of it shows.
    const candidates = new Set<LogicalId>(point.paragraph ? [point.paragraph] : []);
    const shown = follow.shownCopy(identity);
    if (shown) candidates.add(shown);
    for (const holder of follow.holdersOf(identity)) candidates.add(holder);
    for (const candidate of candidates) {
      if (registry.inline.isDeletedParagraph(candidate)) continue;
      // After a publish, the editor's node id of a paragraph is its logical id.
      const text = this.shownText(candidate);
      if (text === null) continue;
      const layout = paragraphLayout(registry, candidate, this.deps.embedOf, text);
      const offset = layout ? offsetIn(layout, point.anchor) : null;
      if (offset !== null) return { nodeId: candidate, offset };
    }
    return null;
  }

  /** The text the editor shows for the paragraph with this node id, or null. */
  private shownText(nodeId: string): string | null {
    return this.deps.port()?.paragraphTextOf?.(nodeId) ?? null;
  }
}

function sameSelection(
  left: CollaborationEditorSelection,
  right: CollaborationEditorSelection
): boolean {
  return (
    left.anchor.nodeId === right.anchor.nodeId &&
    left.anchor.offset === right.anchor.offset &&
    left.head.nodeId === right.head.nodeId &&
    left.head.offset === right.head.offset
  );
}
