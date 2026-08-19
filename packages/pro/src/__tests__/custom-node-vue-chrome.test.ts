/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { h } from 'vue';
import { strToU8, zipSync } from 'fflate';
import { DocxEditorContextMenu } from '@docx-editor.dev/vue';
import { mountEditorTree, flush } from '../../../vue/test/helpers/mount.ts';
import { customNodesModule, defineCustomNode } from '../custom-nodes/define-custom-node.ts';
import { CustomNodeChrome, CustomNodeContextMenu } from '../vue/index.ts';
import { waitFor } from './review-vue-harness.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const CITED = docx(
  '<w:p><w:r><w:t>see </w:t></w:r>' +
    '<w:sdt><w:sdtPr><w:tag w:val="acme:citation?sourceId=src_9f3&amp;locator=p.42"/></w:sdtPr>' +
    '<w:sdtContent><w:r><w:t>(Smith 2024, p. 42)</w:t></w:r></w:sdtContent></w:sdt>' +
    '<w:r><w:t> for details</w:t></w:r></w:p>'
);

const edits: string[] = [];
const clicks: string[] = [];
const hovers: string[] = [];
const citation = defineCustomNode({
  name: 'citation',
  tagPrefix: 'acme',
  label: 'Citation',
  chrome: { color: '#7c3aed' },
  reviewCard: ({ attrs, text }) => ({
    title: `Citation ${attrs['sourceId'] ?? ''}`,
    detail: text,
  }),
  onClick: (node) => clicks.push(node.attrs['sourceId'] ?? ''),
  onHover: (node) => hovers.push(node.attrs['sourceId'] ?? ''),
  onEdit: (node) => edits.push(node.attrs['sourceId'] ?? ''),
});

afterEach(() => {
  document.body.innerHTML = '';
  edits.length = 0;
  clicks.length = 0;
  hovers.length = 0;
});

describe('Vue custom-node chrome', () => {
  test('applies chip styles and dispatches click and hover activation', async () => {
    const hostClicks: string[] = [];
    const mounted = mountEditorTree(
      () => [
        h(CustomNodeChrome, {
          onNodeClick: (node) => hostClicks.push(node.attrs['sourceId'] ?? ''),
        }),
      ],
      CITED,
      () => [],
      [customNodesModule({ nodes: [citation] })]
    );
    const originalElementFromPoint = document.elementFromPoint.bind(document);
    try {
      await flush();
      await waitFor(
        () =>
          mounted.container.querySelector(
            '.docx-content-control-chrome[data-tag^="acme:citation"] .docx-content-control-boundary'
          ) !== null
      );
      const boundary = mounted.container.querySelector(
        '.docx-content-control-chrome[data-tag^="acme:citation"] .docx-content-control-boundary'
      ) as HTMLElement;
      expect(
        [...document.head.querySelectorAll('style')].some((style) =>
          style.textContent?.includes('acme:citation')
        )
      ).toBe(true);

      document.elementFromPoint = () => boundary;
      document.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 })
      );
      document.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 5, clientY: 5 })
      );
      boundary.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

      expect(clicks).toEqual(['src_9f3']);
      expect(hostClicks).toEqual(['src_9f3']);
      expect(hovers).toEqual(['src_9f3']);
    } finally {
      document.elementFromPoint = originalElementFromPoint;
      mounted.unmount();
    }
  });

  test('adds custom-node information and edit actions before packaged rows', async () => {
    const mounted = mountEditorTree(
      () => [],
      CITED,
      () => [
        h(DocxEditorContextMenu, null, {
          default: () => [h(CustomNodeContextMenu)],
        }),
      ],
      [customNodesModule({ nodes: [citation] })]
    );
    try {
      await flush();
      await waitFor(
        () =>
          mounted.container.querySelector(
            '.docx-content-control-chrome[data-tag^="acme:citation"] .docx-content-control-boundary'
          ) !== null
      );
      const boundary = mounted.container.querySelector(
        '.docx-content-control-chrome[data-tag^="acme:citation"] .docx-content-control-boundary'
      ) as HTMLElement;
      boundary.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 })
      );
      await flush();

      const info = mounted.container.querySelector('[data-testid="custom-node-info"]');
      expect(info?.textContent).toContain('Citation src_9f3');
      expect(info?.closest('.docx-contextmenu')?.firstElementChild).toBe(info);
      const edit = mounted.container.querySelector('.docx-contextmenu__custom-edit') as HTMLElement;
      edit.click();
      expect(edits).toEqual(['src_9f3']);
    } finally {
      mounted.unmount();
    }
  });

  test('renders no custom section for plain text', async () => {
    const mounted = mountEditorTree(
      () => [],
      CITED,
      () => [
        h(DocxEditorContextMenu, null, {
          default: () => [h(CustomNodeContextMenu, { nodes: [citation] })],
        }),
      ],
      [customNodesModule({ nodes: [citation] })]
    );
    try {
      await flush();
      const scroller = mounted.container.querySelector(
        '.docx-editor__scroll-container'
      ) as HTMLElement;
      scroller.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 })
      );
      await flush();
      expect(mounted.container.querySelector('.docx-contextmenu')).not.toBeNull();
      expect(mounted.container.querySelector('[data-testid="custom-node-info"]')).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  test('removes a custom node through the context menu', async () => {
    const mounted = mountEditorTree(
      () => [],
      CITED,
      () => [
        h(DocxEditorContextMenu, null, {
          default: () => [h(CustomNodeContextMenu)],
        }),
      ],
      [customNodesModule({ nodes: [citation] })]
    );
    try {
      await flush();
      await waitFor(
        () =>
          mounted.container.querySelector(
            '.docx-content-control-chrome[data-tag^="acme:citation"] .docx-content-control-boundary'
          ) !== null
      );
      const boundary = mounted.container.querySelector(
        '.docx-content-control-chrome[data-tag^="acme:citation"] .docx-content-control-boundary'
      ) as HTMLElement;
      boundary.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 })
      );
      await flush();
      (mounted.container.querySelector('.docx-contextmenu__custom-remove') as HTMLElement).click();
      await flush();
      await waitFor(
        () =>
          mounted.container.querySelector(
            '.docx-content-control-chrome[data-tag^="acme:citation"]'
          ) === null
      );
    } finally {
      mounted.unmount();
    }
  });
});
