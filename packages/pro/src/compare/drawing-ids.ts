/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Drawing ids (`wp:docPr/@id`) are unique in a document. Content taken from the revised document
 * keeps its own id when the output does not use it, and takes the lowest free id otherwise.
 */
import type { OoxmlPackage } from '@docx-editor.dev/core/store';
import { DRAWING_ID_PLACEHOLDER, fromPlaceholder } from './units.ts';
import { escapeAttribute, isElement, type ElementNode } from './xml-fragments.ts';

const PLACEHOLDER = new RegExp(`${DRAWING_ID_PLACEHOLDER}([^§"]*)§`, 'g');
const WRITTEN_ID = /<(?:[A-Za-z_][\w.-]*:)?docPr\b[^>]*?\sid="([^"]*)"/g;

/** Hands out drawing ids that the output does not use. */
export class DrawingIds {
  readonly #used = new Set<string>();
  #next = 1;

  /** Starts from the ids in the original's parts that `replaced` does not name. */
  constructor(base: OoxmlPackage, replaced: ReadonlySet<string>) {
    for (const [name, part] of base.parts) {
      if (replaced.has(name) || !part.root || !isElement(part.root)) continue;
      const stack: ElementNode[] = [part.root];
      for (let node = stack.pop(); node; node = stack.pop()) {
        if (node.localName === 'docPr') {
          const id = node.attributes.find((a) => a.localName === 'id' && !a.namespaceUri);
          if (id) this.#used.add(id.value);
        }
        for (const child of node.children) if (isElement(child)) stack.push(child);
      }
    }
  }

  /** Records the ids a story writes as they are (the original's content). */
  reserveWritten(xml: string): void {
    for (const match of xml.matchAll(WRITTEN_ID)) this.#used.add(match[1]!);
  }

  /** `xml` with every revised drawing id numbered. */
  resolve(xml: string): string {
    return xml.replace(PLACEHOLDER, (_, encoded: string) => {
      const id = fromPlaceholder(encoded);
      if (/^[1-9]\d{0,8}$/.test(id) && !this.#used.has(id)) {
        this.#used.add(id);
        return escapeAttribute(id);
      }
      while (this.#used.has(String(this.#next))) this.#next++;
      const fresh = String(this.#next);
      this.#used.add(fresh);
      return fresh;
    });
  }
}
