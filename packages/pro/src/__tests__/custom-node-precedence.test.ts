/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What a write derives, what it carries, and what it refuses.
//
// `insertCustomNode` and `updateCustomNode` each mix four sources — the caller's `attrs` and
// `text`, and the definition's `text` and `tagAttrs` hooks — over a node that may already exist.
// Every cell below was a real defect at some point; the ones that destroy data silently are the
// reason this file exists.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { z } from 'zod';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { contentControlPropertiesOf, contentControlsIn } from '@docx-editor.dev/core/store';
import {
  customNodesModule,
  defineCustomNode,
  insertCustomNode,
  updateCustomNode,
  type AnyCustomNodeDefinition,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const Cite = z.object({ sourceId: z.string().min(1), page: z.string() });

/** Derives both halves from the payload. */
const Derived = defineCustomNode({
  name: 'derived',
  tagPrefix: 'acme',
  schema: Cite,
  text: (data) => `(${data.sourceId} ${data.page})`,
  tagAttrs: (data) => ({ sourceId: data.sourceId }),
});

/** No hooks: everything is passed by the caller. The pre-payload shape. */
const Tagged = defineCustomNode({ name: 'tagged', tagPrefix: 'acme' });

/** A schema whose OUTPUT differs from its input — the case that exposed a real bug. */
const Defaulted = defineCustomNode({
  name: 'defaulted',
  tagPrefix: 'acme',
  schema: z.object({ n: z.string(), tier: z.string().default('gold') }),
  text: (data) => `${data.tier}/${data.n}`,
});

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"></Relationships>`),
  });
}

function mount(nodes: readonly AnyCustomNodeDefinition[]): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(),
    modules: [customNodesModule({ nodes })],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function at(editor: DocxEditorInstance) {
  const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
  return { paragraphId: fragment.paragraphId, offset: 1 };
}

/** The control as the document holds it: tag, text, alias and lock. */
function control(editor: DocxEditorInstance) {
  const entry = contentControlsIn(editor.surface!.session.part().root)[0];
  if (!entry) throw new Error('no control');
  const properties = contentControlPropertiesOf(entry.node);
  return {
    id: entry.node.id,
    tag: properties.tag,
    alias: properties.alias,
    lock: properties.lock,
    text: editor.surface!.session.bodyText(),
  };
}

describe('insert derives from the schema output, not the argument', () => {
  test('a default is applied before the text is computed', () => {
    // The hook is typed on the schema's OUTPUT. Deriving from the caller's argument wrote a
    // document whose text described a value the payload did not hold.
    const editor = mount([Defaulted]);
    expect(insertCustomNode(editor, Defaulted, { data: { n: 'a' }, at: at(editor) }).ok).toBe(true);
    expect(control(editor).text).toContain('gold/a');
  });

  test('a hook that throws is a refusal, not an exception', () => {
    const Fragile = defineCustomNode({
      name: 'fragile',
      tagPrefix: 'acme',
      schema: z.object({ items: z.array(z.string()) }),
      text: (data) => data.items[0]!.toUpperCase(),
    });
    const editor = mount([Fragile]);
    const result = insertCustomNode(editor, Fragile, { data: { items: [] }, at: at(editor) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('could not describe this payload');
  });

  test('a payload the schema refuses never reaches the hook', () => {
    const editor = mount([Derived]);
    const result = insertCustomNode(editor, Derived, {
      // @ts-expect-error -- sourceId is a string
      data: { sourceId: 1, page: 'p.1' },
      at: at(editor),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues?.[0]?.pointer).toBe('sourceId');
  });
});

describe('insert precedence', () => {
  test('explicit text overrides the hook, and the attrs are still derived', () => {
    const editor = mount([Derived]);
    insertCustomNode(editor, Derived, {
      data: { sourceId: 's1', page: 'p.1' },
      text: 'ibid.',
      at: at(editor),
    });
    expect(control(editor).text).toContain('ibid.');
    expect(control(editor).tag).toContain('sourceId=s1');
  });

  test('explicit text with no payload is refused rather than writing an empty tag', () => {
    // A definition that puts identity in the tag must not end up with a bare one because the
    // caller supplied its own words.
    const editor = mount([Derived]);
    const result = insertCustomNode(editor, Derived, { text: 'ibid.', at: at(editor) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('tag attrs');
  });

  test('a definition with no hooks needs its text passed', () => {
    const editor = mount([Tagged]);
    const result = insertCustomNode(editor, Tagged, { attrs: { id: 'x' }, at: at(editor) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('declares no `text`');
  });
});

describe('an update carries forward everything it was not told to change', () => {
  function inserted() {
    const editor = mount([Tagged]);
    insertCustomNode(editor, Tagged, {
      attrs: { id: 'x', kind: 'note' },
      text: 'first',
      alias: 'Note',
      lock: false,
      at: at(editor),
    });
    return editor;
  }

  test('changing the text keeps the tag attrs', () => {
    // These carry the node's identity. Losing them left a node nothing could recognize again.
    const editor = inserted();
    expect(updateCustomNode(editor, Tagged, control(editor).id, { text: 'second' }).ok).toBe(true);
    expect(control(editor).tag).toContain('id=x');
    expect(control(editor).tag).toContain('kind=note');
    expect(control(editor).text).toContain('second');
  });

  test('it keeps the alias and the lock', () => {
    const editor = inserted();
    expect(control(editor).alias).toBe('Note');
    expect(control(editor).lock).toBe('unlocked');
    updateCustomNode(editor, Tagged, control(editor).id, { text: 'second' });
    expect(control(editor).alias).toBe('Note');
    // An update that only touched the text must not lock a node the author left unlocked.
    expect(control(editor).lock).toBe('unlocked');
  });

  test('a label-only update re-derives the text from the carried payload', () => {
    const editor = mount([Derived]);
    insertCustomNode(editor, Derived, { data: { sourceId: 's1', page: 'p.1' }, at: at(editor) });
    updateCustomNode(editor, Derived, control(editor).id, { alias: 'Citation' });
    expect(control(editor).text).toContain('(s1 p.1)');
    expect(control(editor).tag).toContain('sourceId=s1');
  });

  test('a node belonging to another definition is refused, not converted', () => {
    // The id came from a review item or an activation carrying several definitions' nodes.
    const editor = mount([Derived, Tagged]);
    insertCustomNode(editor, Derived, { data: { sourceId: 's1', page: 'p.1' }, at: at(editor) });
    const result = updateCustomNode(editor, Tagged, control(editor).id, {
      attrs: { id: 'y' },
      text: 'hijacked',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('acme:derived');
    expect(control(editor).tag).toContain('acme:derived');
  });
});

describe('what a definition refuses at the line it was written', () => {
  test('a namespace that cannot go in an XPath throws at defineCustomNode', () => {
    expect(() =>
      defineCustomNode({ name: 'x', tagPrefix: 'acme', payloadNamespace: `urn:a"b` })
    ).toThrow(/payloadNamespace/);
  });

  test('two definitions claiming one identity throw at registration', () => {
    const a = defineCustomNode({ name: 'dup', tagPrefix: 'acme' });
    const b = defineCustomNode({ name: 'dup', tagPrefix: 'acme' });
    expect(() => customNodesModule({ nodes: [a, b] })).toThrow(/two definitions claim/);
  });
});
