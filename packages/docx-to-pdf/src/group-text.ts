/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  paragraphFragmentsOfBlocks,
  type GroupTextboxStoryRecord,
  type ParagraphFragmentRecord,
  type SemanticDrawingVisit,
} from '@docx-editor.dev/core/layout';
import { number as n, rect } from './context.ts';

type GroupOwner = SemanticDrawingVisit['drawing'];
type MemberStory = GroupTextboxStoryRecord['story'];

const membersByOwner = new WeakMap<object, Map<ParagraphFragmentRecord, MemberStory>>();

/**
 * The member story a paragraph of a group drawing belongs to, or null when the drawing is no
 * group or the paragraph is in none of its members. Span buffers key on it, so each member's
 * text is emitted with that member's own clip and turn.
 */
export function groupMemberStoryOf(
  owner: object,
  paragraph: ParagraphFragmentRecord | null | undefined
): MemberStory | null {
  if (!paragraph) return null;
  const members = (owner as Partial<GroupOwner>).groupTextboxStories;
  if (!members) return null;
  let index = membersByOwner.get(owner);
  if (!index) {
    index = new Map();
    for (const member of members) {
      for (const fragment of paragraphFragmentsOfBlocks(member.story.fragments, true)) {
        index.set(fragment, member.story);
      }
    }
    membersByOwner.set(owner, index);
  }
  return index.get(paragraph) ?? null;
}

/**
 * The commands that open one member's clip: its turn about the member box center, when it
 * has one, then its content box. `x`/`y` are the member box origin in page coordinates; the
 * caller closes the clip with `Q`.
 */
export function openMemberClip(
  member: GroupTextboxStoryRecord,
  x: number,
  y: number,
  pageHeight: number
): string[] {
  const out = ['q'];
  const turn = member.rotationDegrees;
  if (turn !== 0 && Number.isFinite(turn)) {
    // Clockwise on the page is a negative angle in PDF space, whose y axis points up.
    const radians = (turn * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const cx = x + member.box.width / 2;
    const cy = pageHeight - (y + member.box.height / 2);
    const e = cx - (cos * cx + sin * cy);
    const f = cy - (-sin * cx + cos * cy);
    out.push(`${n(cos)} ${n(-sin)} ${n(sin)} ${n(cos)} ${n(e)} ${n(f)} cm`);
  }
  const story = member.story;
  const content = {
    x: x + story.contentOffset.x,
    y: y + story.contentOffset.y,
    width: story.contentWidth,
    height: Math.max(0, story.contentHeight),
  };
  out.push(`${rect(content, 0, 0, pageHeight)} W n`);
  return out;
}
