/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  commentsPartNameForStory,
  numberingRootOf,
  resolveNotesPart,
  settingsPartOf,
  stylesPartOf,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';

/** A document-level part a compare reads and writes. */
export type RelatedPartKind =
  | 'styles'
  | 'numbering'
  | 'settings'
  | 'footnotes'
  | 'endnotes'
  | 'comments';

/**
 * The part of `kind` that the editor's own readers use, with their relationship resolution and
 * fallbacks, so the compare merges into exactly the part the editor paints with. A part's
 * declared content type alone decides nothing.
 */
export function relatedPart(pkg: OoxmlPackage, kind: RelatedPartKind): OoxmlPart | undefined {
  switch (kind) {
    case 'styles':
      return stylesPartOf(pkg);
    case 'numbering': {
      const root = numberingRootOf(pkg);
      if (!root) return undefined;
      for (const part of pkg.parts.values()) if (part.root === root) return part;
      return undefined;
    }
    case 'settings':
      return settingsPartOf(pkg) ?? undefined;
    case 'footnotes':
      return resolveNotesPart(pkg, 'footnote') ?? undefined;
    case 'endnotes':
      return resolveNotesPart(pkg, 'endnote') ?? undefined;
    case 'comments': {
      const name = commentsPartNameForStory(pkg, pkg.mainDocumentPart);
      return name === null ? undefined : pkg.parts.get(name);
    }
  }
}

/** `wanted`, or `wanted` numbered (`styles2.xml`), whichever no part of `pkg` holds. */
export function freePartName(pkg: OoxmlPackage, wanted: string): string {
  const taken = (name: string) =>
    pkg.parts.has(name) || pkg.partBytes.has(name) || pkg.partBytes.has(name.slice(1));
  if (!taken(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const name = wanted.replace(/\.xml$/, `${n}.xml`);
    if (!taken(name)) return name;
  }
}

/** The content type a new WordprocessingML part of `kind` is written with. */
export const wordprocessingType = (kind: string) =>
  `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`;
