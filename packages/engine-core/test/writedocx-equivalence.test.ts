// Full writeDocx -> parseDocx equivalence (document-engine task 2.7/3.6, queue item 1).
// A parsed table document retains its whole package, so writeDocx re-emits every part
// byte-for-byte (main document patched from the preservation index) and reopening
// yields an equivalent model.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { parseDocx, writeDocx, bodyStoryId, encodeModel, decodeModel, fingerprint } from '../src/index.ts';

function fixture(name: string) {
  return readFileSync(`${import.meta.dir}/../../../e2e/fixtures/${name}`);
}
function parse(bytes: Uint8Array) {
  const r = parseDocx(bytes);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.model;
}

describe('writeDocx -> parseDocx equivalence', () => {
  for (const name of ['with-tables.docx', 'repeated-table-header.docx']) {
    test(`${name}: every package part round-trips and reopen is equivalent`, () => {
      const orig = fixture(name);
      const model = parse(orig);
      const written = writeDocx(model);

      const origParts = unzipSync(orig);
      const outParts = unzipSync(written);
      // Every original FILE part is present and byte-identical after write (zip
      // directory-marker entries like "word/" are cosmetic and not compared).
      const files = (o: Record<string, Uint8Array>) => Object.keys(o).filter((k) => !k.endsWith('/'));
      expect(files(outParts).sort()).toEqual(files(origParts).sort());
      for (const part of files(origParts)) {
        expect(Array.from(outParts[part])).toEqual(Array.from(origParts[part]));
      }
      // document.xml specifically is byte-identical (verbatim preservation).
      expect(strFromU8(outParts['word/document.xml'])).toBe(strFromU8(origParts['word/document.xml']));

      // Reopening the written bytes yields an equivalent authored model.
      const reopened = parse(written);
      const bid = bodyStoryId(model);
      expect(reopened.stories.get(bodyStoryId(reopened))!.blocks.map((b) => b.kind)).toEqual(
        model.stories.get(bid)!.blocks.map((b) => b.kind),
      );
      expect(fingerprint('authoredState', { body: reopened.stories.get(bodyStoryId(reopened))!.blocks })).toBe(
        fingerprint('authoredState', { body: model.stories.get(bid)!.blocks }),
      );
    });
  }

  test('preservation package parts survive a snapshot encode/decode', () => {
    const model = parse(fixture('with-tables.docx'));
    const restored = decodeModel(encodeModel(model));
    const orig = model.preservation!.packageParts!;
    const back = restored.preservation!.packageParts!;
    expect([...back.keys()].sort()).toEqual([...orig.keys()].sort());
    for (const [k, v] of orig) expect(Array.from(back.get(k)!)).toEqual(Array.from(v));
  });
});
