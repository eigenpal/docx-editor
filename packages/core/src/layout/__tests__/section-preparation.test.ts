import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, TreeDocumentStore, type OoxmlElement } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, createLayoutSession, layoutSemanticDocument } from '../index.ts';
import type { SectionPrepass, SemanticLayoutOptions } from '../semantic-layout.ts';
import { prepareSectionBlocks, sameSectionParagraphOrder } from '../section-preparation.ts';

describe('section preparation reuses immutable inputs', () => {
  test('one replacement prepares one block, even in a large section', () => {
    const bodies = Array.from({ length: 10_000 }, (_, id) => ({ id }));
    const prepared = bodies.map((body) => ({ body }));
    const edited = [...bodies];
    edited[5000] = { id: 5000 };
    let calls = 0;
    const result = prepareSectionBlocks(edited, { bodies, prepared }, (body) => {
      calls += 1;
      return { body };
    });
    expect(calls).toBe(1);
    expect(result[4999]).toBe(prepared[4999]);
    expect(result[5000]).not.toBe(prepared[5000]);
    expect(result[5001]).toBe(prepared[5001]);
  });

  test('insertion reuses the shifted tail and removal never retains deleted entries', () => {
    const bodies = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const prepared = bodies.map((body) => ({ body }));
    const inserted = { id: 4 };
    let calls = 0;
    const next = [bodies[0]!, inserted, ...bodies.slice(1)];
    const result = prepareSectionBlocks(next, { bodies, prepared }, (body) => {
      calls += 1;
      return { body };
    });
    expect(calls).toBe(1);
    expect(result[2]).toBe(prepared[1]);
    const removed = prepareSectionBlocks(bodies, { bodies: next, prepared: result }, () => {
      throw new Error('all surviving nodes were prepared');
    });
    expect(removed).toEqual(prepared);
  });

  test('changed context prepares every block', () => {
    const bodies = [{}, {}];
    let calls = 0;
    prepareSectionBlocks(bodies, null, () => ++calls);
    expect(calls).toBe(2);
  });

  test('paragraph order survives text edits, but table mutations and reorders invalidate it', () => {
    const p = { kind: 'paragraph', id: 'p' };
    const t = { kind: 'table', id: 't' };
    expect(sameSectionParagraphOrder([p, t], [{ ...p }, t])).toBe(true);
    expect(sameSectionParagraphOrder([p, t], [p, { ...t }])).toBe(false);
    expect(sameSectionParagraphOrder([p, t], [t, p])).toBe(false);
  });
});

function store() {
  const loaded = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      Array.from(
        { length: 80 },
        (_, i) => `<w:p><w:r><w:t>paragraph ${i} word word word</w:t></w:r></w:p>`
      ).join('') +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return new TreeDocumentStore(loaded.part);
}

test('retained preparation survives text edits and invalidates on projection epochs', () => {
  const document = store();
  const session = createLayoutSession();
  const projectedIds = new Set<string>();
  const options: SemanticLayoutOptions = {
    measurer: createFixedMeasurer(6, 14),
    session,
    projectionEpoch: 'initial',
    projectionTokenForParagraph: (node) => {
      projectedIds.add(node.id);
      return 'initial';
    },
  };
  layoutSemanticDocument(document.part, 1, options);
  const before = session.prepass as SectionPrepass;
  const paragraph = before.bodies[40]!;
  expect(
    document.transact((tx) =>
      tx.apply({ op: 'insertText', paragraphId: paragraph.id, offset: 0, text: 'X' })
    ).ok
  ).toBe(true);
  projectedIds.clear();
  const after = layoutSemanticDocument(document.part, 2, options);
  expect(projectedIds.has(before.bodies[0]!.id)).toBe(false);
  expect(projectedIds.has(paragraph.id)).toBe(true);
  const prepared = session.prepass as SectionPrepass;
  expect(prepared.prepared[0]).toBe(before.prepared[0]);
  expect(prepared.paragraphDocumentOrder).toBe(before.paragraphDocumentOrder);
  expect(after.pages).toEqual(
    layoutSemanticDocument(structuredClone(document.part), 2, { ...options, session: undefined })
      .pages
  );
  const changed = {
    ...options,
    projectionEpoch: 'changed',
    projectionTokenForParagraph: () => 'changed',
  };
  const projected = layoutSemanticDocument(document.part, 3, changed);
  expect((session.prepass as SectionPrepass).prepared[0]).not.toBe(prepared.prepared[0]);
  expect(projected.pages).toEqual(
    layoutSemanticDocument(structuredClone(document.part), 3, { ...changed, session: undefined })
      .pages
  );
});

test('a column-policy transition cannot reuse a paragraph with frames disabled', () => {
  const part = (columns: number, text: string) => {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:framePr w:x="4000" w:y="0" w:w="1000" /></w:pPr><w:r><w:t>Frame</w:t></w:r></w:p><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr><w:cols w:num="${columns}" w:space="0"/></w:sectPr></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    return parsed.part;
  };
  const first = part(2, 'Anchor');
  const next = part(1, 'Edited anchor');
  const beforeBody = first.root.children[0] as OoxmlElement;
  const nextBody = next.root.children[0] as OoxmlElement;
  const edited = {
    ...next,
    root: {
      ...next.root,
      children: [
        { ...nextBody, children: [beforeBody.children[0]!, ...nextBody.children.slice(1)] },
      ],
    },
  };
  const session = createLayoutSession();
  const measurer = createFixedMeasurer(5, 20);
  const geometry = (width: number) => ({
    width,
    height: 200,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  layoutSemanticDocument(first, 0, { session, measurer, geometry: geometry(200) });
  const previous = session.prepass as SectionPrepass;
  expect(previous.prepared[0]!.kind === 'paragraph' && previous.prepared[0]!.frame).toBeUndefined();
  const options = { session, measurer, geometry: geometry(100), drawingExclusionConverged: true };
  const warm = layoutSemanticDocument(edited, 1, options);
  const current = session.prepass as SectionPrepass;
  expect(current.prepared[0]).not.toBe(previous.prepared[0]);
  expect(current.prepared[0]!.kind === 'paragraph' && current.prepared[0]!.frame).toBeDefined();
  expect(warm.pages).toEqual(
    layoutSemanticDocument(structuredClone(edited), 1, {
      ...options,
      session: createLayoutSession(),
    }).pages
  );
});
