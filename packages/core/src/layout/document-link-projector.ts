// Shared sanitized hyperlink projection for body and secondary stories.

import {
  hyperlinkTargetOf,
  relationshipTargetIn,
  type HeadlessDocumentView,
} from '@docx-editor.dev/core/store';
import type { HyperlinkProjector } from './field-projection.ts';

function projector(
  resolveRelationship: Parameters<typeof hyperlinkTargetOf>[1]
): HyperlinkProjector {
  return (link) => {
    if (link.kind === 'textValue') return null;
    const target = hyperlinkTargetOf(link, resolveRelationship);
    return {
      id: link.id,
      kind: target.kind,
      href: target.href,
      ...(target.anchor !== undefined ? { anchor: target.anchor } : {}),
      ...(target.tooltip !== undefined ? { tooltip: target.tooltip } : {}),
    };
  };
}

/** Sanitized body and per-part link projectors over one neutral document view. @public */
export function createDocumentLinkProjectors(view: HeadlessDocumentView): {
  readonly projectLink: HyperlinkProjector;
  readonly projectLinkForPart: (partName: string) => HyperlinkProjector;
} {
  return {
    projectLink: projector((relationshipId) => view.relationshipTarget(relationshipId)),
    projectLinkForPart: (partName) =>
      projector((relationshipId) =>
        relationshipTargetIn(view.currentPackage(), partName, relationshipId)
      ),
  };
}
