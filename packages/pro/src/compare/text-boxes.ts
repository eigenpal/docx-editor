/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Text boxes inside inline objects (`w:txbxContent` in a drawing or a VML shape).
 *
 * The object compares by its shape without the box content. A matched object compares each
 * box's content as a container; an inserted or deleted object marks its box content inserted
 * or deleted too, so accepting or rejecting the object leaves no stray box text.
 */
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { EmitContext } from './emit.ts';
import { compareContainer } from './story-compare.ts';
import { MARK, unitsOf, type Atom, type SideContext } from './units.ts';
import { isElement, type ElementNode } from './xml-fragments.ts';

const MARKER = (index: number) => `${MARK}TXBX:${index}§`;

/** Every `w:txbxContent` under `node`, in document order. */
export function textBoxesOf(node: OoxmlNode): ElementNode[] {
  const out: ElementNode[] = [];
  const visit = (current: OoxmlNode) => {
    if (!isElement(current)) return;
    if (current.localName === 'txbxContent') {
      out.push(current);
      return;
    }
    for (const child of current.children) visit(child);
  };
  visit(node);
  return out;
}

/** `node` with each box's content replaced by a text marker. */
export function withBoxMarkers(node: ElementNode): ElementNode {
  let index = 0;
  const map = (current: OoxmlNode): OoxmlNode => {
    if (!isElement(current)) return current;
    if (current.localName === 'txbxContent') {
      return {
        ...current,
        children: [{ id: `${current.id}:marker`, kind: 'textValue', value: MARKER(index++) }],
      } as unknown as OoxmlNode;
    }
    return { ...current, children: current.children.map(map) } as OoxmlNode;
  };
  return map(node) as ElementNode;
}

/**
 * The object's XML with compared box content. `base` and `revised` are the two objects of a
 * matched pair; one of them is null for a deleted or inserted object.
 */
export function objectWithBoxes(base: Atom | null, revised: Atom | null, ctx: EmitContext): string {
  const own = (revised ?? base)!;
  const side: SideContext = revised ? ctx.revised : ctx.base;
  const node = own.node!;
  const xml = side.serialize(withBoxMarkers(node));
  const baseBoxes = base?.node ? textBoxesOf(base.node) : [];
  const revisedBoxes = revised?.node ? textBoxesOf(revised.node) : [];
  const count = Math.max(baseBoxes.length, revisedBoxes.length);
  const contents: string[] = [];
  for (let i = 0; i < count; i++) {
    const before = baseBoxes[i];
    const after = revisedBoxes[i];
    contents.push(
      compareContainer(
        before ? unitsOf(before, ctx.base) : [],
        after ? unitsOf(after, ctx.revised) : [],
        ctx
      )
    );
  }
  // One pass over the object: a replace per box would scan it again for every box.
  const markers = new RegExp(`${MARK}TXBX:(\\d+)§`, 'g');
  return xml.replace(markers, (whole, index: string) => contents[Number(index)] ?? whole);
}
