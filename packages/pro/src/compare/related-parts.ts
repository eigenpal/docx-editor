/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  commentsPartNameForStory,
  numberingRootOf,
  relationshipsOf,
  resolveRelationship,
  resolveNotesPart,
  settingsPartOf,
  stylesPartOf,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';

const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

/** A document-level part a compare reads and writes. */
export type RelatedPartKind =
  'styles' | 'numbering' | 'settings' | 'footnotes' | 'endnotes' | 'comments';

/**
 * The part of `kind` that the editor's own readers use, with their relationship resolution and
 * fallbacks, so the compare merges into exactly the part the editor paints with. A part's
 * declared content type alone decides nothing.
 */
export function relatedPart(pkg: OoxmlPackage, kind: RelatedPartKind): OoxmlPart | undefined {
  switch (kind) {
    case 'styles': {
      // The painting session reads the relationship, else exactly /word/styles.xml; the
      // indexes accept any part named styles.xml. Only a part both agree on is used, so
      // without one the compare adds a related styles part that every reader finds.
      const part = stylesPartOf(pkg);
      if (!part) return undefined;
      const related = relationshipsOf(pkg, pkg.mainDocumentPart).some((rel) => {
        if (rel.type !== STYLES_REL) return false;
        const resolved = resolveRelationship(rel);
        return (
          resolved.mode === 'Internal' &&
          resolved.target.ok &&
          resolved.target.partName === part.name
        );
      });
      return related || part.name === '/word/styles.xml' ? part : undefined;
    }
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

const takenNames = new WeakMap<OoxmlPackage, ReadonlySet<string>>();

/** A part name folded the way OPC compares names: ASCII letters ignore case. */
const foldName = (name: string): string =>
  (name.startsWith('/') ? name : `/${name}`).replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Whether a new part named `name` would collide in `pkg`: with a part whose name differs at
 * most in case, or with the target of an internal relationship, whether or not that part
 * exists. A broken reference stays broken.
 */
export function isPartNameTaken(pkg: OoxmlPackage, name: string): boolean {
  let names = takenNames.get(pkg);
  if (!names) {
    const out = new Set<string>();
    for (const part of pkg.parts.keys()) out.add(foldName(part));
    for (const part of pkg.partBytes.keys()) out.add(foldName(part));
    addRelationshipTargets(pkg, out);
    takenNames.set(pkg, (names = out));
  }
  return names.has(foldName(name));
}

function addRelationshipTargets(pkg: OoxmlPackage, out: Set<string>): void {
  for (const records of pkg.relationships.values()) {
    for (const record of records) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'Internal' && resolved.target.ok)
        out.add(foldName(resolved.target.partName));
    }
  }
}

/**
 * `wanted`, or `wanted` numbered (`styles2.xml`), whichever no part of `pkg` holds and no
 * relationship of `pkg` points at.
 */
export function freePartName(pkg: OoxmlPackage, wanted: string): string {
  const taken = (name: string) => isPartNameTaken(pkg, name);
  if (!taken(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const name = wanted.replace(/\.xml$/, `${n}.xml`);
    if (!taken(name)) return name;
  }
}

/** The content type a new WordprocessingML part of `kind` is written with. */
export const wordprocessingType = (kind: string) =>
  `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`;
