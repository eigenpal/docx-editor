import { alignDropCap } from './paragraph-drop-cap.ts';
import { sha256FontBytes } from '../store/package/sha256.ts';
import { framedTokenJoin } from './layout-cache.ts';
import {
  paragraphFrameOrigin,
  positionParagraphFrame,
  type ParagraphFrame,
  type ParagraphFrameOrigins,
} from './paragraph-frame.ts';
import { fragmentSignature } from './semantic-fragment-signature.ts';
import type { LineRecord, ParagraphFragmentRecord } from './semantic-records.ts';

function shiftFragmentX(
  fragment: ParagraphFragmentRecord,
  dx: number,
  width: number
): ParagraphFragmentRecord {
  const move = <T extends { readonly x: number }>(box: T): T => ({ ...box, x: box.x + dx });
  return {
    ...fragment,
    box: { ...fragment.box, width },
    ...(fragment.shadingBox
      ? {
          shadingBox: { ...fragment.shadingBox, width: Math.max(fragment.shadingBox.width, width) },
        }
      : {}),
    ...(fragment.marker
      ? {
          marker: {
            ...fragment.marker,
            box: move(fragment.marker.box),
            ...(fragment.marker.picture
              ? { picture: { ...fragment.marker.picture, box: move(fragment.marker.picture.box) } }
              : {}),
          },
        }
      : {}),
    lines: fragment.lines.map((line) => ({
      ...line,
      box: { ...line.box, width },
      contentX: line.contentX + dx,
      spans: line.spans.map((span) => ({ ...span, box: move(span.box) })),
    })),
  };
}

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

  /** Reserve the cap's full occupied line band before placing its anchor paragraph. */
  requiredAnchorBand(
    lines: readonly { readonly height: number; readonly exclusionSkipBefore?: number }[]
  ): number {
    let count = 0;
    for (let node = this.pending; node; node = node.previous)
      count = Math.max(count, node.item.frame.dropCapLines ?? 0);
    let height = 0;
    for (let index = 0; index < count; index++) {
      const line = lines[Math.min(index, lines.length - 1)];
      height += (line?.height ?? 0) + (line?.exclusionSkipBefore ?? 0);
    }
    return height;
  }

  publish(
    origins: ParagraphFrameOrigins,
    anchorId: string,
    columnIndex: number,
    anchorLines: readonly LineRecord[] = [],
    onPageParityRead?: () => void
  ): ParagraphFragmentRecord[] {
    if (!this.pending) return [];
    const pending = new Array<PendingParagraphFrame>(this.pending.length);
    for (let node: PendingParagraphFrames | undefined = this.pending; node; node = node.previous)
      pending[node.length - 1] = node.item;
    if (pending.some(({ frame }) => frame.xAlign === 'inside' || frame.xAlign === 'outside')) {
      onPageParityRead?.();
    }
    const locals = pending.map((item) => ({
      item,
      fragment: item.frame.dropCapLines
        ? alignDropCap(item.fragment, item.frame.dropCapLines, anchorLines, origins.text.y).fragment
        : item.fragment,
    }));
    const localGroups = new Map<
      string,
      {
        frame: ParagraphFrame;
        width: number;
        contentHeight: number;
        height: number;
      }
    >();
    for (const { item, fragment } of locals) {
      const group = localGroups.get(item.groupId);
      const bottom = fragment.box.y + fragment.box.height;
      if (group) {
        group.width = Math.max(group.width, item.frame.width);
        group.contentHeight = Math.max(group.contentHeight, bottom);
      } else {
        localGroups.set(item.groupId, {
          frame: item.frame,
          width: item.frame.width,
          contentHeight: bottom,
          height: 0,
        });
      }
    }
    const groups = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const [groupId, group] of localGroups) {
      group.height =
        group.frame.heightRule === 'exact'
          ? group.frame.height!
          : group.frame.heightRule === 'atLeast'
            ? Math.max(group.contentHeight, group.frame.height ?? 0)
            : group.contentHeight;
      const origin = paragraphFrameOrigin(group.frame, origins, group);
      groups.set(groupId, { ...origin, width: group.width, height: group.height });
    }
    const positioned = locals.map(({ item, fragment: source }) => {
      const group = localGroups.get(item.groupId)!;
      let local = source;
      if (item.frame.autoWidth && group.width > item.frame.width) {
        const extra = group.width - item.frame.width;
        const dx =
          local.alignment === 'right' ? extra : local.alignment === 'center' ? extra / 2 : 0;
        local = shiftFragmentX(local, dx, local.box.width + extra);
      }
      const fragment = positionParagraphFrame(local, item.frame, origins, group);
      return { item, fragment };
    });
    this.pending = undefined;
    return positioned.map(({ item, fragment }) => {
      const positionedFrame = {
        anchorId,
        columnIndex,
        groupId: item.groupId,
        sourceOrder: item.sourceOrder,
        ...(item.frame.dropCapLines ? { dropCapLines: item.frame.dropCapLines } : {}),
        wrap: item.frame.wrap,
        hSpace: item.frame.hSpace,
        vSpace: item.frame.vSpace,
        box: groups.get(item.groupId)!,
      };
      if (item.frame.heightRule !== 'exact') return { ...fragment, positionedFrame };
      const top = Math.max(fragment.box.y, positionedFrame.box.y);
      const bottom = Math.min(
        fragment.box.y + fragment.box.height,
        positionedFrame.box.y + positionedFrame.box.height
      );
      return {
        ...fragment,
        clipToBox: true,
        box: {
          x: positionedFrame.box.x,
          y: Math.min(top, positionedFrame.box.y + positionedFrame.box.height),
          width: positionedFrame.box.width,
          height: Math.max(0, bottom - top),
        },
        positionedFrame,
      };
    });
  }
}
