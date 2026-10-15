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

/** The painted surface: 100px below the container's top, its right edge at x = 1116. */
const SURFACE_RECT = { top: 140, left: 300, right: 1116, bottom: 1140 };
/** Everything else, including the scroll container. */
const FRAME_RECT = { top: 40, left: 20, right: 1420, bottom: 1040 };
const CLIENT_WIDTH = 1400;

/** The metrics both adapters must report at 100% zoom for this geometry. */
export const EXPECTED_AT_100 = {
  scale: 96 / 72,
  top: SURFACE_RECT.top - FRAME_RECT.top,
  left: SURFACE_RECT.right - FRAME_RECT.left + 16,
  compactCardLeft: CLIENT_WIDTH - (SURFACE_RECT.right - FRAME_RECT.left + 16) - 300 - 12,
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

/** Install the geometry; returns the restore function. */
export function installRailGeometry(): () => void {
  const proto = HTMLElement.prototype;
  const saved = (['clientWidth', 'offsetParent', 'getBoundingClientRect'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const
  );
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => CLIENT_WIDTH });
  Object.defineProperty(proto, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
  Object.defineProperty(proto, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      return rect(this.classList.contains('docx-paginated-surface') ? SURFACE_RECT : FRAME_RECT);
    },
  });
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, key, descriptor);
      else delete (proto as unknown as Record<string, unknown>)[key];
    }
  };
}

/** Parse the metrics a probe wrote into `data-metrics`. */
export function readMetrics(node: Element | null): Record<string, number | null> | null {
  const raw = node?.getAttribute('data-metrics');
  return raw ? (JSON.parse(raw) as Record<string, number | null>) : null;
}
