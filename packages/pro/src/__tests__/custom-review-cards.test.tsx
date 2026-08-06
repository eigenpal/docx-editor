/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Custom nodes in the review surfaces: `reviewCard` contributes a sidebar card anchored at
// the node's range, and the context menu shows the node's data plus its Edit action at the
// top when the right-click lands on the chip.
//
// These tests paint through the BUILT react adapter (`@docx-editor.dev/react` resolves to
// packages/react/dist, which inlines the core painter) — rebuild it before trusting a
// failure on behaviour the source clearly implements.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  DocxEditorContent,
  DocxEditorContextMenu,
  DocxEditorRoot,
  DocxEditorViewport,
} from '@docx-editor.dev/react';
import { DocxEditorReview, CustomNodeContextMenu, useReviewItem } from '../react/index.ts';
import { reviewModule } from '../index.ts';
import { customNodesModule, defineCustomNode } from '../custom-nodes/define-custom-node.ts';
import { customItemsOf } from '../review/review-model.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** One paragraph holding a recognized citation SDT between two plain runs. */
const CITED = docx(
  '<w:p><w:r><w:t>see </w:t></w:r>' +
    '<w:sdt><w:sdtPr><w:tag w:val="acme:citation?sourceId=src_9f3&amp;locator=p.42"/></w:sdtPr>' +
    '<w:sdtContent><w:r><w:t>(Smith 2024, p. 42)</w:t></w:r></w:sdtContent></w:sdt>' +
    '<w:r><w:t> for details</w:t></w:r></w:p>'
);

const edits: string[] = [];
const citation = defineCustomNode({
  name: 'citation',
  tagPrefix: 'acme',
  label: 'Citation',
  reviewCard: ({ attrs, text }) => ({
    title: `Citation ${attrs['sourceId'] ?? ''}`,
    detail: text || (attrs['locator'] ?? ''),
  }),
  onEdit: (node) => edits.push(node.attrs['sourceId'] ?? ''),
});

afterEach(() => {
  cleanup();
  edits.length = 0;
});

describe('customItemsOf', () => {
  test('derives one anchored custom item per recognized node with a reviewCard', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: CITED,
      modules: [customNodesModule({ nodes: [citation] })],
    });
    const part = editor.surface!.session.part();
    const items = customItemsOf(part, [citation]);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.kind).toBe('custom');
    expect(item.title).toBe('Citation src_9f3');
    expect(item.detail).toBe('(Smith 2024, p. 42)');
    expect(item.range).not.toBeNull();
    // Anchored over the SDT's own text: "see " is 4 characters, the label 19.
    expect(item.range!.start.offset).toBe(4);
    expect(item.range!.end.offset).toBe(23);
  });

  test('a definition without reviewCard is recognized but asks for no card', () => {
    // It used to contribute nothing at all, which meant the chip's own surfaces — click, hover,
    // the context menu's Edit row — got no `text` and no `data`, because those are read off the
    // review item. Now the item exists and says `carded: false`; the rail is what filters it.
    const bare = defineCustomNode({ name: 'citation', tagPrefix: 'acme' });
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: CITED,
      modules: [customNodesModule({ nodes: [bare] })],
    });
    const items = customItemsOf(editor.surface!.session.part(), [bare]);
    expect(items).toHaveLength(1);
    expect(items[0]?.carded).toBe(false);
    expect(items[0]?.title).toBe('');
    expect(items[0]?.text).toBe('(Smith 2024, p. 42)');
  });

  test('a reviewCard veto (null) skips that node', () => {
    const vetoing = defineCustomNode({
      name: 'citation',
      tagPrefix: 'acme',
      reviewCard: () => null,
    });
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: CITED,
      modules: [customNodesModule({ nodes: [vetoing] })],
    });
    expect(customItemsOf(editor.surface!.session.part(), [vetoing])).toEqual([]);
  });
});

describe('the review rail', () => {
  test('shows the custom card, informational only, and refuses review verbs on it', () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={CITED}
        modules={[reviewModule(), customNodesModule({ nodes: [citation] })]}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const card = view.container.querySelector(
      '[data-testid="review-card"][data-kind="custom"]'
    ) as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Citation src_9f3');
    expect(card.textContent).toContain('(Smith 2024, p. 42)');
    // Informational: no accept/reject, and the engine refuses the verbs by key.
    expect(card.querySelector('[data-testid="review-accept"]')).toBeNull();
    const placement = instance!.getReviewItems().find((entry) => entry.kind === 'custom')!;
    expect(placement.readOnly).toBe(true);
    expect(placement.anchorY).not.toBeNull();
    expect(instance!.acceptReviewItem(placement.key).ok).toBe(false);
    expect(instance!.replyToReviewItem(placement.key, 'hello', 'A').ok).toBe(false);
  });
});

describe('host content inside cards', () => {
  test('a rail child renders inside the card and reads the item via useReviewItem', () => {
    function Probe() {
      const item = useReviewItem();
      if (!item || item.kind !== 'custom' || item.item.kind !== 'custom') return null;
      return (
        <button type="button" data-testid="probe-action">
          {item.item.attrs['sourceId']}
        </button>
      );
    }
    const view = render(
      <DocxEditorRoot
        document={CITED}
        modules={[reviewModule(), customNodesModule({ nodes: [citation] })]}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            <Probe />
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const card = view.container.querySelector(
      '[data-testid="review-card"][data-kind="custom"]'
    ) as HTMLElement;
    const probe = card.querySelector('[data-testid="probe-action"]') as HTMLElement;
    expect(probe).not.toBeNull();
    expect(probe.textContent).toBe('src_9f3');
  });
});

describe('the context menu section', () => {
  test('right-clicking the chip shows the card data and the Edit row on top', async () => {
    const view = render(
      <DocxEditorRoot
        document={CITED}
        modules={[reviewModule(), customNodesModule({ nodes: [citation] })]}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorContextMenu
            t={(key: string) => (key === 'contextMenu.editCustomNode' ? 'Edit {label}' : key)}
          >
            {/* No `nodes` prop: the section defaults to the definitions registered on
                the Root — the register-once contract. */}
            <CustomNodeContextMenu />
          </DocxEditorContextMenu>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const boundary = view.container.querySelector(
      '.docx-content-control-chrome[data-tag^="acme:citation"] .docx-content-control-boundary'
    ) as HTMLElement;
    expect(boundary).not.toBeNull();
    await act(async () => {
      fireEvent.contextMenu(boundary, { clientX: 40, clientY: 40 });
    });
    const info = view.container.querySelector('[data-testid="custom-node-info"]') as HTMLElement;
    expect(info).not.toBeNull();
    expect(info.textContent).toContain('Citation src_9f3');
    // The section renders ABOVE the packaged rows.
    const panel = info.closest('.docx-contextmenu')!;
    const first = panel.firstElementChild;
    expect(first).toBe(info);
    // Selecting Edit hands the node to the definition.
    const editRow = panel.querySelector('.docx-contextmenu__custom-edit') as HTMLElement;
    expect(editRow).not.toBeNull();
    await act(async () => {
      fireEvent.click(editRow);
    });
    expect(edits).toEqual(['src_9f3']);
  });

  test('no edit hook, no Edit row — the HOST owns the edit screen', async () => {
    // The library never invents an editor for a node it does not understand: the row
    // exists only when the definition's `onEdit` or the component's `onEditNode` says
    // there is somewhere for it to go. Info block and Remove are independent of it.
    const uneditable = defineCustomNode({
      name: 'citation',
      tagPrefix: 'acme',
      label: 'Citation',
      reviewCard: ({ attrs }) => ({ title: `Citation ${attrs['sourceId'] ?? ''}` }),
    });
    const view = render(
      <DocxEditorRoot
        document={CITED}
        modules={[reviewModule(), customNodesModule({ nodes: [uneditable] })]}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorContextMenu>
            <CustomNodeContextMenu />
          </DocxEditorContextMenu>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const boundary = view.container.querySelector(
      '.docx-content-control-chrome[data-tag^="acme:citation"] .docx-content-control-boundary'
    ) as HTMLElement;
    await act(async () => {
      fireEvent.contextMenu(boundary, { clientX: 40, clientY: 40 });
    });
    expect(view.container.querySelector('[data-testid="custom-node-info"]')).not.toBeNull();
    expect(view.container.querySelector('.docx-contextmenu__custom-edit')).toBeNull();
    expect(view.container.querySelector('.docx-contextmenu__custom-remove')).not.toBeNull();
  });

  test('right-clicking plain text shows no custom section', async () => {
    const view = render(
      <DocxEditorRoot document={CITED} modules={[customNodesModule({ nodes: [citation] })]}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorContextMenu>
            <CustomNodeContextMenu nodes={[citation]} />
          </DocxEditorContextMenu>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const scroller = view.container.querySelector('.docx-editor__scroll-container') as HTMLElement;
    await act(async () => {
      fireEvent.contextMenu(scroller, { clientX: 40, clientY: 40 });
    });
    expect(view.container.querySelector('.docx-contextmenu')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="custom-node-info"]')).toBeNull();
  });
});
