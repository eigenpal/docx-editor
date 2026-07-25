// Partial body editability, end to end (task M6P.1).
//
// A document with tables and SDTs used to open wholly read-only, because the session
// reduced the body to one boolean that returned at the first blocking block. The
// comprehensive Word element fixture has 12 tables and 8 SDTs, so 237 paragraphs were
// immutable to protect 20 blocks.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { parseDocx } from '@docx-editor.dev/engine-core';
import { openDocxSession } from '../src/session.ts';

const FIXTURE = path.resolve(import.meta.dir, '../../../e2e/fixtures/comprehensive-word-element-test.docx');
const bytes = () => new Uint8Array(readFileSync(FIXTURE));

/** Replace the text of the first editable paragraph, leaving every other node identical. */
function editFirstParagraph(session: ReturnType<typeof openDocxSession>, text: string) {
  const doc = session.projectDoc();
  const schema = doc.type.schema;
  let index = -1;
  doc.forEach((node, _offset, i) => {
    if (index === -1 && node.type.name === 'paragraph' && node.textContent.length > 0) index = i;
  });
  expect(index, 'no editable paragraph was projected').toBeGreaterThanOrEqual(0);
  const nodes: unknown[] = [];
  doc.forEach((node, _offset, i) => {
    nodes.push(i === index ? node.type.create(node.attrs, schema.text(text)) : node);
  });
  return { doc: schema.node('doc', null, nodes as never), index };
}

describe('partial body editability', () => {
  test('a document with tables and SDTs opens editable in partial mode', () => {
    const session = openDocxSession(bytes());
    expect(session.editable).toBe(true);
    expect(session.mode).toBe('partial');
    // No single blocking reason: a partial document is editable, so its per-region
    // diagnostics are the honest answer.
    expect(session.readOnlyReason).toBeNull();
    expect(session.readOnlyRegions.length).toBeGreaterThan(0);
  });

  test('read-only blocks project as immutable atoms, editable paragraphs do not', () => {
    const session = openDocxSession(bytes());
    const counts: Record<string, number> = {};
    session.projectDoc().forEach((node) => {
      counts[node.type.name] = (counts[node.type.name] ?? 0) + 1;
    });
    // Both must be present, or this is not a PARTIAL document.
    expect(counts.paragraph).toBeGreaterThan(100);
    expect(counts.blockEmbed).toBeGreaterThan(10);
  });

  test('editing one safe paragraph commits, and preserves every other part verbatim', () => {
    const session = openDocxSession(bytes());
    const { doc } = editFirstParagraph(session, 'EDITED BY M6P1');
    expect(session.applyPmDoc(doc)).toMatchObject({ committed: true, rejected: false });

    const saved = session.save();
    const before = parseDocx(bytes(), { preserveAll: true });
    const after = parseDocx(saved, { preserveAll: true });
    if (!before.ok || !after.ok) throw new Error('round-trip parse failed');

    const storyOf = (m: typeof before.model) => {
      const id = [...m.stories.keys()][0]!;
      return m.stories.get(id)!.blocks;
    };
    const kinds = (blocks: ReturnType<typeof storyOf>) =>
      blocks.reduce<Record<string, number>>((acc, b) => ((acc[b.kind] = (acc[b.kind] ?? 0) + 1), acc), {});

    // Structure is untouched: no table, SDT, or paragraph gained, lost, or retyped.
    expect(storyOf(after.model).length).toBe(storyOf(before.model).length);
    expect(kinds(storyOf(after.model))).toEqual(kinds(storyOf(before.model)));

    // Only the document part may differ. Relationships, media, styles, and every other
    // package part must be byte-identical.
    const p0 = before.model.preservation!;
    const p1 = after.model.preservation!;
    const changed = [...p0.originalParts.keys()].filter((k) => p0.originalParts.get(k) !== p1.originalParts.get(k));
    expect(changed).toEqual(['/word/document.xml']);

    // And the edit actually survived, so this is not passing by doing nothing.
    const edited = storyOf(after.model).some(
      (b) => b.kind === 'paragraph' && b.runs.some((r) => r.text.includes('EDITED BY M6P1')),
    );
    expect(edited).toBe(true);
  });

  test('structural mutation is rejected atomically in partial mode', () => {
    const session = openDocxSession(bytes());
    expect(session.structuralMutationAllowed).toBe(false);
    const revisionBefore = session.revision();

    // A SPLIT of an editable paragraph, not a dropped node.
    //
    // The first version deleted block 0, which `mapDocToOps` refuses on its own, so it
    // proved nothing. A split is the case the reverse lane CAN express (`trySplit`) and
    // that a `full`-mode document commits — asserted below — so the difference measured
    // here is genuinely partial mode refusing structural mutation.
    //
    // What this does NOT claim: that the `structuralMutationAllowed` preflight in
    // `applyPmDoc` is what rejects THIS doc — for a tail split the reverse matcher gets
    // there first. The preflight is still load-bearing for other shapes: security review
    // showed that with it disabled, a join deleting a read-only paragraph committed. That
    // specific hole is now closed in the join lane and asserted in
    // `read-only-blocks.test.ts`.
    const doc = session.projectDoc();
    const schema = doc.type.schema;
    // The LAST editable paragraph, with no read-only block after it. Splitting an
    // interior paragraph shifts every following block, so the read-only matcher rejects
    // it on its own and the preflight is never reached — which is why an interior split
    // still passed with the preflight deleted. At the tail, only the preflight stands
    // between this doc and a commit (a tail split commits in `full` mode).
    let splitIndex = -1;
    let readOnlyAfter = false;
    doc.forEach((node, _offset, i) => {
      if (node.type.name === 'paragraph' && node.textContent.length > 6) {
        splitIndex = i;
        readOnlyAfter = false;
      } else if (node.type.name === 'blockEmbed') {
        readOnlyAfter = true;
      }
    });
    expect(splitIndex, 'fixture has no splittable paragraph').toBeGreaterThanOrEqual(0);
    expect(readOnlyAfter, 'no tail paragraph: the preflight would not be reached').toBe(false);

    const nodes: unknown[] = [];
    doc.forEach((node, _offset, i) => {
      if (i !== splitIndex) {
        nodes.push(node);
        return;
      }
      const text = node.textContent;
      const cut = Math.floor(text.length / 2);
      nodes.push(node.type.create(node.attrs, schema.text(text.slice(0, cut))));
      nodes.push(node.type.create(node.attrs, schema.text(text.slice(cut))));
    });
    const split = schema.node('doc', null, nodes as never);
    expect(split.childCount, 'the doc must really have one more block').toBe(doc.childCount + 1);

    expect(session.applyPmDoc(split)).toMatchObject({ committed: false, rejected: true, opCount: 0 });
    // Atomically: the store must not have advanced.
    expect(session.revision()).toBe(revisionBefore);
    // And the canonical model still holds the unsplit paragraph.
    expect(session.projectDoc().childCount).toBe(doc.childCount);

    // The control: the SAME structural edit commits in a `full`-mode document. Without
    // this, "rejected" could just mean "splits never work", which would make the
    // assertion above true for the wrong reason.
    const fullPath = path.resolve(import.meta.dir, '../../../e2e/fixtures/editable-sample.docx');
    const full = openDocxSession(new Uint8Array(readFileSync(fullPath)));
    expect(full.mode).toBe('full');
    const fullDoc = full.projectDoc();
    const fullSchema = fullDoc.type.schema;
    let fullIndex = -1;
    fullDoc.forEach((node, _offset, i) => {
      if (fullIndex === -1 && node.type.name === 'paragraph' && node.textContent.length > 6) fullIndex = i;
    });
    const fullNodes: unknown[] = [];
    fullDoc.forEach((node, _offset, i) => {
      if (i !== fullIndex) {
        fullNodes.push(node);
        return;
      }
      const text = node.textContent;
      const cut = Math.floor(text.length / 2);
      fullNodes.push(node.type.create(node.attrs, fullSchema.text(text.slice(0, cut))));
      fullNodes.push(node.type.create(node.attrs, fullSchema.text(text.slice(cut))));
    });
    expect(full.applyPmDoc(fullSchema.node('doc', null, fullNodes as never))).toMatchObject({
      committed: true,
      rejected: false,
    });
  });

  test('every read-only region names the block it locks', () => {
    const session = openDocxSession(bytes());
    for (const region of session.readOnlyRegions) {
      expect(region.story.length).toBeGreaterThan(0);
      if (region.code === 'non-editable-kind' || region.code === 'unmodeled-content') {
        expect(region.blockId, region.message).toBeDefined();
      }
    }
  });
});

// --- Assistive coverage (M6P.1 regression guard) -----------------------------------
//
// Partial editability projects an unpatchable paragraph as a read-only ATOM. The atom
// carried no text and the painted pages are `aria-hidden`, so those paragraphs vanished
// from the ONLY assistive representation of the document: independent review measured
// 1,833 of 8,601 body characters (21.3%) unreachable, including every section heading.
// This asserts the reviewer's own metric on the real fixture, and fails if a future
// change reintroduces a text-free atom or re-clears a paragraph atom's textContent.
describe('assistive coverage of read-only blocks', () => {
  test('every body paragraph is reachable in the accessibility projection', async () => {
    await import('./dom-setup.ts');
    const { DOMSerializer } = await import('prosemirror-model');
    const { applyAtomAccessibilityLabels } = await import('../src/accessibility-projection.ts');

    const { bodyStoryId } = await import('@docx-editor.dev/engine-core');
    const model = parseDocx(bytes()).model;
    // What the DOCUMENT says: every body paragraph's text, from the canonical model.
    const wanted = (model.stories.get(bodyStoryId(model))?.blocks ?? [])
      .filter((b) => b.kind === 'paragraph')
      .map((b) => (b as { runs: { text: string }[] }).runs.map((r) => r.text).join(''))
      .filter((t) => t.trim().length > 0);
    expect(wanted.length).toBeGreaterThan(100);

    const session = openDocxSession(bytes());
    const doc = session.projectDoc();
    // Sanity: this fixture must actually EXERCISE the atom path, or the guard is vacuous.
    let atoms = 0;
    doc.forEach((n) => {
      if (n.type.name === 'blockEmbed') atoms += 1;
    });
    expect(atoms, 'fixture projects no read-only atoms').toBeGreaterThan(10);

    const root = document.createElement('div');
    root.append(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content));
    applyAtomAccessibilityLabels(root, { table: 'Table' });
    const reachable = root.textContent ?? '';

    const missing = wanted.filter((t) => !reachable.includes(t));
    const missingChars = missing.reduce((n, t) => n + t.length, 0);
    const totalChars = wanted.reduce((n, t) => n + t.length, 0);
    expect(
      missingChars,
      `${missingChars}/${totalChars} chars unreachable; first: ${JSON.stringify(missing[0]?.slice(0, 60))}`,
    ).toBe(0);
  });
});
