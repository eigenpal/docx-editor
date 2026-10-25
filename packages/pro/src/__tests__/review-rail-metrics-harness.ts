/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One fixed rail geometry for the React and Vue rail-metrics tests, so both adapters must
// report the same numbers for the same layout. happy-dom lays nothing out, so the scroll
// container and the painted surface report these rects instead.

import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

/** One paragraph with one open comment over its text. */
export const COMMENTED_SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:commentRangeStart w:id="7"/>` +
      '<w:r><w:t>hello</w:t></w:r><w:commentRangeEnd w:id="7"/>' +
      '<w:r><w:commentReference w:id="7"/></w:r></w:p></w:body></w:document>'
  ),
  'word/comments.xml': strToU8(
    `<w:comments xmlns:w="${W}"><w:comment w:id="7" w:author="Ada">` +
      '<w:p><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment></w:comments>'
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
  ),
});

/**
 * The adjustable part of the layout. Defaults: the page's right edge at x = 1116 and a
 * 1400px-wide scroll container, which affords a full review column.
 */
export const railGeometry = { surfaceRight: 1116, clientWidth: 1400 };

/** The scroll container's rect. Everything outside the surface reports this too. */
const FRAME_RECT = { top: 40, left: 20, right: 1420, bottom: 1040 };
/** The loading placeholder sits somewhere else entirely, so binding to it shows. */
const LOADING_RECT = { top: 400, left: 0, right: 500, bottom: 900 };
/** How far a `.test-banner` inside the scroll container pushes the pages down. */
export const BANNER_HEIGHT = 50;

/** The class every scroll container (`DocxEditor.Viewport`) carries in both adapters. */
const SCROLLER = 'docx-editor__scroll-container';

/** The metrics both adapters must report at 100% zoom for the default geometry. */
export const EXPECTED_AT_100 = {
  scale: 96 / 72,
  top: 140 - FRAME_RECT.top,
  left: 1116 - FRAME_RECT.left + 16,
  side: 'right',
  compactCardLeft: 1400 - (1116 - FRAME_RECT.left + 16) - 300 - 12,
  compact: false,
} as const;

function rect(box: { top: number; left: number; right: number; bottom: number }): DOMRect {
  return {
    ...box,
    x: box.left,
    y: box.top,
    width: box.right - box.left,
    height: box.bottom - box.top,
    toJSON: () => box,
  } as DOMRect;
}

function surfaceRect(surface: HTMLElement) {
  const scroller = surface.closest(`.${SCROLLER}`);
  const top = 140 + (scroller?.querySelector('.test-banner') ? BANNER_HEIGHT : 0);
  return { top, left: 300, right: railGeometry.surfaceRight, bottom: top + 1000 };
}

/**
 * Work around a happy-dom defect: it holds each MutationObserver's delivery function only
 * through a `WeakRef`, so a garbage collection in the middle of a test silently stops an
 * observer that is still connected. While installed, `WeakRef` holds its target strongly.
 * Returns the restore function.
 */
function keepHappyDomObserversAlive(): () => void {
  const NativeWeakRef = globalThis.WeakRef;
  globalThis.WeakRef = class StrongRef<T extends object> {
    readonly #target: T;
    constructor(target: T) {
      this.#target = target;
    }
    deref(): T {
      return this.#target;
    }
  } as unknown as WeakRefConstructor;
  return () => {
    globalThis.WeakRef = NativeWeakRef;
  };
}

/**
 * Install the geometry; returns the restore function.
 *
 * `offsetParent` follows the real rule closely enough for these tests: an element inside a
 * scroll container is positioned against it (the container is `position: relative`), and
 * anything else falls back to its parent.
 */
export function installRailGeometry(): () => void {
  const proto = HTMLElement.prototype;
  const saved = (['clientWidth', 'offsetParent', 'getBoundingClientRect'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const
  );
  railGeometry.surfaceRight = 1116;
  railGeometry.clientWidth = 1400;
  const releaseObservers = keepHappyDomObserversAlive();
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get: () => railGeometry.clientWidth,
  });
  Object.defineProperty(proto, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.isConnected) return null;
      return this.parentElement?.closest(`.${SCROLLER}`) ?? this.parentElement;
    },
  });
  Object.defineProperty(proto, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      if (this.classList.contains('docx-editor__loading-surface')) return rect(LOADING_RECT);
      if (this.classList.contains('docx-paginated-surface')) return rect(surfaceRect(this));
      return rect(FRAME_RECT);
    },
  });
  return () => {
    releaseObservers();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, key, descriptor);
      else delete (proto as unknown as Record<string, unknown>)[key];
    }
  };
}

/** Insert a banner above the pages, as a host's notice inside the viewport would be. */
export function insertBanner(scroller: Element): HTMLElement {
  const banner = scroller.ownerDocument.createElement('div');
  banner.className = 'test-banner';
  scroller.insertBefore(banner, scroller.firstChild);
  return banner;
}

/** Parse the metrics a probe wrote into `data-metrics`. */
export function readMetrics(
  node: Element | null
): Record<string, number | boolean | string | null> | null {
  const raw = node?.getAttribute('data-metrics');
  return raw ? (JSON.parse(raw) as Record<string, number | boolean | string | null>) : null;
}
