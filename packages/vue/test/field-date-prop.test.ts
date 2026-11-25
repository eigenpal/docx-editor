// The `fieldDate` prop reaches the editor from `DocxEditorRoot` and the `DocxEditor` sugar. The
// editor reads it once: a new `Date` with the same time does not warn, a changed time is ignored
// and warns once.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, shallowRef, type Component } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { runInNewContext } from 'node:vm';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { resetFieldDateWarningForTests } from '../src/editor/field-date-warning';
import { flush } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Thursday 5 March 2026, 14:07 local time. */
const MOMENT = new Date(2026, 2, 5, 14, 7);

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('Dated ')}` +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> DATE \\@ "d MMMM yyyy" </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      run('1 January 2020') +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:p></w:body></w:document>'
  ),
});

afterEach(() => {
  document.body.innerHTML = '';
});

/** Mount `component`; `props` is read on every render, so a test can swap it reactively. */
async function mount(component: Component, props: () => Record<string, unknown>) {
  const container = document.createElement('div');
  document.body.append(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        component,
        {
          document: SOURCE,
          ...props(),
          onReady: (editor: unknown) => ready.push(editor as DocxEditorInstance),
        },
        component === DocxEditorRoot
          ? {
              default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
            }
          : undefined
      ),
  });
  app.mount(container);
  await flush();
  return { ready, unmount: () => app.unmount() };
}

/** The text of the first page as laid out. */
function shown(editor: DocxEditorInstance): string {
  return editor
    .surface!.layout()
    .pages[0]!.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? (fragment as { lines: readonly { spans: readonly { text: string }[] }[] }).lines.flatMap(
            (line) => line.spans.map((span) => span.text)
          )
        : []
    )
    .join('');
}

describe('fieldDate prop', () => {
  for (const [host, component] of [
    ['root', DocxEditorRoot],
    ['sugar', DocxEditor],
  ] as const) {
    for (const fieldDate of [MOMENT, undefined] as const) {
      test(`${host} ${fieldDate ? 'with' : 'without'} a date`, async () => {
        const mounted = await mount(component, () => (fieldDate ? { fieldDate } : {}));
        try {
          expect(shown(mounted.ready.at(-1)!)).toBe(
            fieldDate ? 'Dated 5 March 2026' : 'Dated 1 January 2020'
          );
        } finally {
          mounted.unmount();
        }
      });
    }
  }

  test('accepts a Date from another realm without a prop warning', async () => {
    const foreign = runInNewContext(`new Date(${MOMENT.getTime()})`) as Date;
    expect(foreign instanceof Date).toBe(false);
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      const mounted = await mount(DocxEditorRoot, () => ({ fieldDate: foreign }));
      try {
        expect(shown(mounted.ready.at(-1)!)).toBe('Dated 5 March 2026');
        expect(warnings.filter((message) => message.includes('Invalid prop'))).toHaveLength(0);
      } finally {
        mounted.unmount();
      }
    } finally {
      console.warn = original;
    }
  });

  test('a new Date with the same time does not warn; a changed time is ignored and warns once', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    const dateWarnings = () => warnings.filter((message) => message.includes('fieldDate changed'));
    const date = shallowRef<Date | undefined>(MOMENT);
    resetFieldDateWarningForTests();
    try {
      const mounted = await mount(DocxEditorRoot, () =>
        date.value ? { fieldDate: date.value } : {}
      );
      try {
        const first = mounted.ready.at(-1)!;
        date.value = new Date(MOMENT.getTime());
        await flush();
        expect(dateWarnings()).toHaveLength(0);

        date.value = new Date(2030, 0, 1);
        await flush();
        expect(dateWarnings()).toHaveLength(1);

        // Removing the date is a change too.
        date.value = MOMENT;
        await flush();
        resetFieldDateWarningForTests();
        date.value = undefined;
        await flush();
        expect(dateWarnings()).toHaveLength(2);
        expect(mounted.ready.at(-1)).toBe(first);
        expect(shown(first)).toBe('Dated 5 March 2026');
      } finally {
        mounted.unmount();
      }
    } finally {
      console.warn = original;
    }
  });
});
