/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Drawing ids (`wp:docPr/@id`) and floating drawing z-orders (`wp:anchor/@relativeHeight`) are
 * unique in a document; a repeated value is renumbered when the file opens, and a rejected
 * drawing then differs from the original's. Content taken from the revised document keeps its
 * own value when the output does not use it, and takes a free one otherwise.
 */
import type { OoxmlPackage } from '@docx-editor.dev/core/store';
import { DRAWING_ID_PLACEHOLDER, fromPlaceholder, Z_ORDER_PLACEHOLDER } from './units.ts';
import { escapeAttribute, isElement, type ElementNode } from './xml-fragments.ts';

const ID_PLACEHOLDER = new RegExp(`${DRAWING_ID_PLACEHOLDER}([^§"]*)§`, 'g');
const ORDER_PLACEHOLDER = new RegExp(`${Z_ORDER_PLACEHOLDER}([^§"]*)§`, 'g');
const WRITTEN_ID = /<(?:[A-Za-z_][\w.-]*:)?docPr\b[^>]*?\sid="([^"]*)"/g;
const WRITTEN_ORDER = /<(?:[A-Za-z_][\w.-]*:)?anchor\b[^>]*?\srelativeHeight="([^"]*)"/g;

/** Largest value of the unsigned 32-bit attributes both values are. */
const MAX_VALUE = 0xffffffff;
/** Step between z-orders, as editors space them, so new drawings keep room between them. */
const Z_ORDER_STEP = 1024;

/** Hands out drawing ids and z-orders that the output does not use. */
export class DrawingIds {
  readonly #ids = new Set<string>();
  readonly #orders = new Set<string>();
  #nextId = 1;

  /** Starts from the values in the original's parts that `replaced` does not name. */
  constructor(base: OoxmlPackage, replaced: ReadonlySet<string>) {
    for (const [name, part] of base.parts) {
      if (replaced.has(name) || !part.root || !isElement(part.root)) continue;
      const stack: ElementNode[] = [part.root];
      for (let node = stack.pop(); node; node = stack.pop()) {
        const own = (attribute: string) =>
          node!.attributes.find((a) => a.localName === attribute && !a.namespaceUri)?.value;
        if (node.localName === 'docPr') {
          const id = own('id');
          if (id !== undefined) this.#ids.add(id);
        } else if (node.localName === 'anchor') {
          const order = own('relativeHeight');
          if (order !== undefined) this.#orders.add(order);
        }
        for (const child of node.children) if (isElement(child)) stack.push(child);
      }
    }
  }

  /** Records the values a story writes as they are (the original's content). */
  reserveWritten(xml: string): void {
    for (const match of xml.matchAll(WRITTEN_ID)) this.#ids.add(match[1]!);
    for (const match of xml.matchAll(WRITTEN_ORDER)) this.#orders.add(match[1]!);
  }

  /** `xml` with every revised drawing id and z-order numbered. */
  resolve(xml: string): string {
    return xml
      .replace(ID_PLACEHOLDER, (_, encoded: string) => {
        const id = fromPlaceholder(encoded);
        if (isValue(id) && !this.#ids.has(id)) {
          this.#ids.add(id);
          return escapeAttribute(id);
        }
        while (this.#ids.has(String(this.#nextId))) this.#nextId++;
        const fresh = String(this.#nextId);
        this.#ids.add(fresh);
        return fresh;
      })
      .replace(ORDER_PLACEHOLDER, (_, encoded: string) => {
        const order = fromPlaceholder(encoded);
        if (!isValue(order)) return escapeAttribute(order);
        // Above the revised value, so the drawing keeps its place among the new ones.
        let value = Number(order);
        while (this.#orders.has(String(value)) && value + Z_ORDER_STEP <= MAX_VALUE)
          value += Z_ORDER_STEP;
        const fresh = String(value);
        this.#orders.add(fresh);
        return fresh;
      });
  }
}

const isValue = (value: string) => /^\d{1,10}$/.test(value) && Number(value) <= MAX_VALUE;
