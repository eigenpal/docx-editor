// Bidi trust policy for keyboard navigation (interactive-paginated-editing 5.5).

import type { ViewScope } from '@docx-editor.dev/core-contract/editor';
import type { InteractionFrame, SemanticIdentity, SemanticSelection, SemanticTarget } from '@docx-editor.dev/core-contract/interaction';

/** Strong RTL scripts — keyboard navigation rejects all content containing these (fail closed). */
const STRONG_RTL = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export type ParagraphTextResolver = (identity: SemanticIdentity, scope: ViewScope) => string;

export function scopesEqual(a: ViewScope, b: ViewScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'headerFooter' && b.kind === 'headerFooter') return a.rId === b.rId;
  if (a.kind === 'note' && b.kind === 'note') return a.id === b.id;
  if (a.kind === 'frame' && b.kind === 'frame') return a.id === b.id;
  return true;
}

export function blockContainsStrongRtl(text: string): boolean {
  return STRONG_RTL.test(text);
}

function clusterDirectionsForBlock(frame: InteractionFrame, identity: SemanticIdentity, scope: ViewScope): Set<'ltr' | 'rtl'> {
  const directions = new Set<'ltr' | 'rtl'>();
  for (const page of frame.display) {
    for (const item of page.items) {
      if (item.kind !== 'text' || item.semantic.identity.blockId !== identity.blockId) continue;
      if (item.semantic.identity.storyId !== identity.storyId) continue;
      if (!scopesEqual(item.scope, scope)) continue;
      for (const cluster of item.clusters) directions.add(cluster.direction);
    }
  }
  return directions;
}

function validateClusterDirectionTrust(
  frame: InteractionFrame,
  identity: SemanticIdentity,
  scope: ViewScope,
  text: string,
): { ok: true } | { ok: false; reason: string } {
  const directions = clusterDirectionsForBlock(frame, identity, scope);
  if (directions.size > 1) {
    return { ok: false, reason: 'mixed-direction cluster geometry is not supported for keyboard navigation' };
  }
  if (blockContainsStrongRtl(text)) {
    return { ok: false, reason: 'strong RTL script content is not supported for keyboard navigation in task 5.5' };
  }
  const onlyRtl = directions.size === 1 && directions.has('rtl');
  if (onlyRtl && !blockContainsStrongRtl(text)) {
    return { ok: false, reason: 'RTL cluster metadata without trustworthy RTL script content is not supported' };
  }
  return { ok: true };
}

/** Fail closed: strong RTL script and untrusted cluster direction metadata reject keyboard navigation. */
export function validateKeyboardBidiTrust(
  frame: InteractionFrame,
  selection: SemanticSelection,
  paragraphText: ParagraphTextResolver,
  extraTargets: readonly Extract<SemanticTarget, { kind: 'text' }>[] = [],
): { ok: true } | { ok: false; reason: string } {
  if (selection.anchor.kind !== 'text' || selection.head.kind !== 'text') {
    return { ok: false, reason: 'keyboard navigation requires text selection endpoints' };
  }
  const seen = new Set<string>();
  for (const target of [selection.anchor, selection.head, ...extraTargets]) {
    const key = `${target.identity.storyId}:${target.identity.blockId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = paragraphText(target.identity, target.scope);
    const trusted = validateClusterDirectionTrust(frame, target.identity, target.scope, text);
    if (!trusted.ok) return trusted;
  }
  return { ok: true };
}
