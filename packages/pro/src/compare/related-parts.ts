/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { relationshipsOf, type OoxmlPackage, type OoxmlPart } from '@docx-editor.dev/core/store';

/**
 * The part the main document relates to with a `kind` relationship (`styles`, `numbering`,
 * `footnotes`, `endnotes`, `comments`, `settings`), as readers find it. A part's declared
 * content type is file data and decides nothing: an unrelated part of the right type is a
 * decoy. A matching relationship that is external, names no part, or names a part with
 * another root is skipped, so a bad first match cannot hide a usable later one.
 */
export function relatedPart(
  pkg: OoxmlPackage,
  kind: string,
  root: string = kind
): OoxmlPart | undefined {
  const owner = pkg.mainDocumentPart;
  const dir = owner.slice(0, owner.lastIndexOf('/') + 1);
  for (const rel of relationshipsOf(pkg, owner)) {
    if (!rel.type.endsWith(`/${kind}`) || rel.targetMode === 'External') continue;
    const target = rel.rawTarget.startsWith('/') ? rel.rawTarget : `${dir}${rel.rawTarget}`;
    const pieces: string[] = [];
    for (const piece of target.split('/')) {
      if (piece === '..') pieces.pop();
      else if (piece !== '.' && piece !== '') pieces.push(piece);
    }
    const part = pkg.parts.get(`/${pieces.join('/')}`);
    if (part && part.root.localName === root) return part;
  }
  return undefined;
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
