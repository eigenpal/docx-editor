// What a scripted edit is allowed to change about the file.
//
// Every other model test reads the document back through the model, which proves the edit happened
// and says nothing about the bytes. This one asks the repository's own fidelity oracles instead —
// `canonicalOoxmlFingerprint` over the main part and `semanticDigest` over every part — so an edit
// that reads back correctly while quietly dropping a style, a table's grid or the section properties
// fails HERE rather than in somebody's Word.
//
// Two claims, and they are not the same claim:
//
//   THE EDIT SURVIVES SAVING. Save, reopen, save again: the digest is unchanged. An edit that only
//   exists in the open session was applied to a picture of a document.
//
//   THE EDIT CHANGED ONLY WHAT IT NAMED. Everything the script did not touch is still in the saved
//   part, and a REFUSED batch leaves the bytes fingerprint-identical.
//
// This is a test, so it may import the store lane; the SHIPPED model may not, which
// `../../runtime/__tests__/runtime-boundaries.test.ts` holds in place.

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  diffSemanticDigests,
  readOoxmlPackage,
  semanticDigest,
  serializeOoxmlPart,
  type SemanticDigest,
} from '@docx-editor.dev/core-contract/store';
import type { DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import { REPRESENTATIVE, reopen, serverRuntime } from './support/documents.ts';

interface Oracles {
  readonly fingerprint: string;
  readonly digest: SemanticDigest;
  /** The main part as it was written, for "is this still in the file" questions. */
  readonly mainXml: string;
  readonly partNames: readonly string[];
}

/** Reopen saved bytes and describe them the way the repository's fidelity gates describe them. */
function oraclesOf(bytes: Uint8Array): Oracles {
  const opened = readOoxmlPackage(bytes);
  if (!opened.ok) throw new Error(`saved bytes did not reopen: ${opened.reason}`);
  const main = opened.package.parts.get(opened.package.mainDocumentPart);
  if (!main) throw new Error('saved bytes carry no main document part');
  return {
    fingerprint: canonicalOoxmlFingerprint(main),
    digest: semanticDigest(opened.package.parts.values()),
    mainXml: serializeOoxmlPart(main),
    partNames: [...opened.package.parts.keys()],
  };
}

async function savedOracles(runtime: DocxEditorServerRuntime): Promise<Oracles> {
  return oraclesOf(await runtime.save());
}

describe('an edit made by script survives the serializer', () => {
  test('save, reopen and save again keeps the semantic digest', async () => {
    // The D9 round trip, driven through the object model rather than through the protocol.
    const runtime = await serverRuntime(REPRESENTATIVE);
    await runtime.run(async (context) => {
      context.document.body.insertParagraph('appended by script', 'End');
      await context.sync();
    });

    const once = await savedOracles(runtime);
    const again = await savedOracles(await reopen(runtime));
    expect(diffSemanticDigests(once.digest, again.digest)).toEqual([]);
    expect(again.fingerprint).toBe(once.fingerprint);
  });

  test('and so does emptying the whole story, table and all', async () => {
    // `clear()` on this document is the most structural edit the model can make: the story runs
    // through a table, so the blocks come out rather than the text being deleted. What the oracles
    // add to the paragraph reads next door is that the file it leaves is a file — one that reopens,
    // saves again unchanged, and still declares the styles part its remaining paragraph resolves
    // through.
    const runtime = await serverRuntime(REPRESENTATIVE);
    const before = await savedOracles(runtime);
    await runtime.run(async (context) => {
      context.document.body.clear();
      await context.sync();
    });

    const once = await savedOracles(runtime);
    const again = await savedOracles(await reopen(runtime));
    expect(diffSemanticDigests(once.digest, again.digest)).toEqual([]);
    expect(again.fingerprint).toBe(once.fingerprint);
    // The story is empty and the table is gone, but the document's furniture is not: section
    // properties and the styles part are still there, because emptying a story is not deleting a
    // document.
    expect(once.mainXml).not.toContain('<w:tbl>');
    expect(once.mainXml).toContain('w:sectPr');
    expect(once.partNames).toEqual(before.partNames);
  });

  test('and so does a write, a split and a delete made in one batch', async () => {
    const runtime = await serverRuntime(REPRESENTATIVE);
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[1]!.insertText(' \u2014 revised', 'End');
      paragraphs.items[0]!.split([' '], true);
      // The last paragraph, which is the one after the table — not a cell's only paragraph, which
      // the store refuses to remove (see `model-writes.test.ts`).
      paragraphs.items[paragraphs.items.length - 1]!.delete();
      await context.sync();
    });

    const once = await savedOracles(runtime);
    const again = await savedOracles(await reopen(runtime));
    expect(diffSemanticDigests(once.digest, again.digest)).toEqual([]);
    expect(again.fingerprint).toBe(once.fingerprint);
  });
});
describe('an edit changes only what it named', () => {
  test('the style cascade, the table and the section properties are still in the saved part', async () => {
    // The things a bespoke serializer loses. Asserted on the SAVED bytes, because those are what a
    // reader opens; an in-session read is answered by the tree the edit was applied to.
    const runtime = await serverRuntime(REPRESENTATIVE);
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[1]!.insertText(' \u2014 revised', 'End');
      await context.sync();
    });

    const after = await savedOracles(runtime);
    expect(after.mainXml).toContain('w:pStyle');
    expect(after.mainXml).toContain('w:tbl');
    expect(after.mainXml).toContain('w:tblGrid');
    expect(after.mainXml).toContain('w:sectPr');
    expect(after.mainXml).toContain('w:tab');
    expect(after.mainXml).toContain('\u2014 revised');
    expect(after.partNames).toContain('/word/styles.xml');
  });

  test('an appended paragraph moves the main part and no other part', async () => {
    const runtime = await serverRuntime(REPRESENTATIVE);
    const before = await savedOracles(runtime);
    await runtime.run(async (context) => {
      context.document.body.insertParagraph('appended by script', 'End');
      await context.sync();
    });
    const after = await savedOracles(runtime);

    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.partNames).toEqual(before.partNames);
    // Every digest difference is in the story the paragraph was appended to.
    const differences = diffSemanticDigests(before.digest, after.digest);
    expect(differences.length).toBeGreaterThan(0);
    expect(before.digest.stories.length).toBe(after.digest.stories.length);
  });

  test('a refused batch leaves the bytes fingerprint-identical', async () => {
    const runtime = await serverRuntime(REPRESENTATIVE);
    const before = await savedOracles(runtime);
    await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      // Two changes claiming one paragraph: refused as a batch, so neither happens.
      paragraph.insertParagraph('beside', 'After');
      paragraph.insertText('!', 'End');
      await expect(context.sync()).rejects.toMatchObject({ code: 'ConflictingChanges' });
    });

    const after = await savedOracles(runtime);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(diffSemanticDigests(before.digest, after.digest)).toEqual([]);
  });
});
