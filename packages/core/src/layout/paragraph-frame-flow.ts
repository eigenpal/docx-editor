import { sha256FontBytes } from '../store/package/sha256.ts';
import { framedTokenJoin } from './layout-cache.ts';
import {
  positionParagraphFrame,
  type ParagraphFrame,
  type ParagraphFrameOrigins,
} from './paragraph-frame.ts';
import { fragmentSignature } from './semantic-fragment-signature.ts';
import type { ParagraphFragmentRecord } from './semantic-records.ts';

export interface PendingParagraphFrame {
  readonly frame: ParagraphFrame;
  readonly fragment: ParagraphFragmentRecord;
  readonly groupId: string;
  readonly sourceOrder: number;
}

/** Frames and their next ordinary anchor share flow dependencies, including intervening tables. */
export function paragraphFrameFlowKeys(
  keys: string[],
  blocks: readonly { readonly kind: string; readonly frame?: ParagraphFrame }[]
): string[] {
  let out = keys;
  let start = -1;
  for (let index = 0; index <= blocks.length; index++) {
    const block = blocks[index];
    if (block?.frame && start < 0) start = index;
    if (start < 0 || (block && (block.frame || block.kind !== 'paragraph'))) continue;
    const end = Math.min(index, keys.length - 1);
    // Bound each member key even when a reconstructed page has thousands of frames.
    const token = sha256FontBytes(
      new TextEncoder().encode(framedTokenJoin(keys.slice(start, end + 1)))
    );
    if (out === keys) out = [...keys];
    for (let member = start; member <= end; member++)
      out[member] = framedTokenJoin([keys[member]!, token]);
    start = -1;
  }
  return out;
}

/** Immutable prefix shared by every checkpoint; one node per pending paragraph. */
export interface PendingParagraphFrames {
  readonly item: PendingParagraphFrame;
  readonly previous: PendingParagraphFrames | undefined;
  readonly length: number;
  readonly signature: string;
}

export function samePendingParagraphFrames(
  left: PendingParagraphFrames | undefined,
  right: PendingParagraphFrames | undefined
): boolean {
  return left === right || (left?.length === right?.length && left?.signature === right?.signature);
}

/** Local frame paragraphs wait for the actual page and origin of their next regular paragraph. */
export class ParagraphFrameFlow {
  private pending: PendingParagraphFrames | undefined;

  checkpoint(): PendingParagraphFrames | undefined {
    return this.pending;
  }
  restore(pending: PendingParagraphFrames | undefined): void {
    this.pending = pending;
  }
  same(pending: PendingParagraphFrames | undefined): boolean {
    return samePendingParagraphFrames(this.pending, pending);
  }

  start(
    frame: ParagraphFrame,
    previousParagraphId: string | undefined
  ): { cursorY: number; previousSpaceAfter: number; groupId?: string } {
    const last = this.pending?.item;
    return last &&
      last.fragment.paragraphId === previousParagraphId &&
      last.frame.token === frame.token
      ? {
          cursorY: last.fragment.box.y + last.fragment.box.height,
          previousSpaceAfter: last.fragment.spacing.after,
          groupId: last.groupId,
        }
      : { cursorY: 0, previousSpaceAfter: 0 };
  }

  add(
    frame: ParagraphFrame,
    fragment: ParagraphFragmentRecord,
    groupId = fragment.paragraphId,
    sourceOrder = 0
  ): void {
    const last = this.pending?.item;
    const group = last?.groupId === groupId ? last : undefined;
    const item = { frame, fragment, groupId, sourceOrder: group?.sourceOrder ?? sourceOrder };
    const signature = sha256FontBytes(
      new TextEncoder().encode(
        framedTokenJoin([
          this.pending?.signature ?? '',
          frame.token,
          groupId,
          String(item.sourceOrder),
          fragmentSignature(fragment),
        ])
      )
    );
    this.pending = {
      item,
      previous: this.pending,
      length: (this.pending?.length ?? 0) + 1,
      signature,
    };
  }

  publish(
    origins: ParagraphFrameOrigins,
    anchorId: string,
    columnIndex: number
  ): ParagraphFragmentRecord[] {
    if (!this.pending) return [];
    const pending = new Array<PendingParagraphFrame>(this.pending.length);
    for (let node: PendingParagraphFrames | undefined = this.pending; node; node = node.previous)
      pending[node.length - 1] = node.item;
    const groups = new Map<string, { x: number; y: number; width: number; height: number }>();
    const positioned = pending.map((item) => {
      const fragment = positionParagraphFrame(item.fragment, item.frame, origins);
      const frameBox = {
        x: origins[item.frame.horizontalAnchor].x + item.frame.x,
        y: fragment.box.y,
        width: item.frame.width,
        height: fragment.box.height,
      };
      const box = groups.get(item.groupId);
      if (box) {
        const right = Math.max(box.x + box.width, frameBox.x + frameBox.width);
        const bottom = Math.max(box.y + box.height, frameBox.y + frameBox.height);
        box.x = Math.min(box.x, frameBox.x);
        box.y = Math.min(box.y, frameBox.y);
        box.width = right - box.x;
        box.height = bottom - box.y;
      } else groups.set(item.groupId, frameBox);
      return { item, fragment };
    });
    this.pending = undefined;
    return positioned.map(({ item, fragment }) => ({
      ...fragment,
      positionedFrame: {
        anchorId,
        columnIndex,
        groupId: item.groupId,
        sourceOrder: item.sourceOrder,
        wrap: item.frame.wrap,
        hSpace: item.frame.hSpace,
        vSpace: item.frame.vSpace,
        box: groups.get(item.groupId)!,
      },
    }));
  }
}
