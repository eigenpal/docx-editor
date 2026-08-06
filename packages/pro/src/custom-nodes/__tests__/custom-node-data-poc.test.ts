/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// End to end, with a real zod schema, against a real `.docx`.
//
// The whole payload story in one file: a host declares the shape of what its node carries,
// the payload is written into a customXml data part with the binding address an SDT will
// quote, it survives a save and reopen, it comes back validated as the type the host declared,
// and a node declared `preserveOnExport: false` leaves NOTHING behind in the exported file.
//
// zod is a devDependency here and nowhere in what ships. `parseCustomNodeData` takes the
// Standard Schema interface, which zod implements, so a host brings its own copy.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { readOoxmlPackage, writeOoxmlPackage } from '@docx-editor.dev/core/store';
import {
  customXmlLabelXPath,
  customXmlNodes,
  customXmlPrefixMappings,
  findCustomXmlDataPart,
  readCustomXmlNode,
  withCustomXmlDataPart,
  withCustomXmlNode,
  withoutCustomXmlDataPart,
  withoutOrphanCustomXmlNodes,
} from '@docx-editor.dev/core/store';
import { sanitizeHref } from '@docx-editor.dev/core/store';
import { parseCustomNodeData, serializeCustomNodeData } from '../data-schema.ts';

const STORY = '/word/document.xml';
const NS = 'https://example.test/nodes';
const ROOT = 'nodes';

/** What a host declares its node carries. An ordinary zod schema, nothing adapted. */
const Citation = z.object({
  sourceId: z.string().min(1),
  locator: z.string(),
  authors: z.array(z.string()).max(64),
  year: z.number().int().gte(0).lte(3000),
  // Optional, and the badge shows a thumbnail for it. Both halves of that are hostile input:
  // the string is the sender's, and so is whatever the URL would fetch.
  url: z.url().optional(),
});
type Citation = z.infer<typeof Citation>;

const CITATION: Citation = {
  sourceId: 'src_9f3',
  locator: 'p.42',
  authors: ['Smith, J.', 'Okonkwo, A.'],
  year: 2024,
  url: 'https://example.test/papers/9f3.pdf',
};

function document(): ReturnType<typeof readOoxmlPackage> {
  const path = resolve(
    import.meta.dir,
    '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
  );
  return readOoxmlPackage(new Uint8Array(readFileSync(path)));
}

function openedWithCitation(): {
  bytes: Uint8Array;
  partName: string;
  storeItemId: string;
} {
  const read = document();
  if (!read.ok) throw new Error(read.reason);
  const authored = withCustomXmlDataPart(read.package, STORY, NS, ROOT);
  if (!authored.part) throw new Error('no store authored');

  const payload = serializeCustomNodeData(CITATION);
  if (!payload.ok) throw new Error(payload.issues.join(', '));
  const written = withCustomXmlNode(authored.pkg, authored.part.partName, {
    id: 'cx1',
    label: '(Smith 2024)',
    data: payload.value,
  });
  return {
    bytes: writeOoxmlPackage(written),
    partName: authored.part.partName,
    storeItemId: authored.part.itemId,
  };
}

describe('a payload larger than w:tag, defined by a zod schema', () => {
  test('it survives a save and reopen, and validates as the declared type', () => {
    const { bytes, partName } = openedWithCitation();
    const reopened = readOoxmlPackage(bytes);
    if (!reopened.ok) throw new Error(reopened.reason);

    const node = readCustomXmlNode(reopened.package, partName, 'cx1');
    expect(node?.label).toBe('(Smith 2024)');

    const parsed = parseCustomNodeData(Citation, node?.data ?? '');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Typed, not `unknown`: the host reads `.year` without a cast or a guard.
    expect(parsed.value.year).toBe(2024);
    expect(parsed.value.authors).toEqual(['Smith, J.', 'Okonkwo, A.']);
    expect(parsed.value).toEqual(CITATION);
  });

  test('the payload is far past what the tag could have held', () => {
    const payload = serializeCustomNodeData(CITATION);
    expect(payload.ok).toBe(true);
    // 64 is the whole `w:tag` budget, prefix and name included.
    if (payload.ok) expect(payload.value.length).toBeGreaterThan(64);
  });

  test('a payload the sender tampered with is refused, not handed over half-typed', () => {
    const { bytes, partName } = openedWithCitation();
    const reopened = readOoxmlPackage(bytes);
    if (!reopened.ok) throw new Error(reopened.reason);
    // The file is the sender's: nothing stops `year` arriving as a string.
    const tampered = withCustomXmlNode(reopened.package, partName, {
      id: 'cx1',
      label: '(Smith 2024)',
      data: '{"sourceId":"src_9f3","locator":"p.42","authors":[],"year":"2024"}',
    });
    const node = readCustomXmlNode(tampered, partName, 'cx1');
    const parsed = parseCustomNodeData(Citation, node?.data ?? '');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('invalid');
      expect(parsed.issues.length).toBeGreaterThan(0);
    }
  });

  test('the binding address the SDT will carry is well formed', () => {
    const { storeItemId } = openedWithCitation();
    expect(storeItemId).toMatch(
      /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/
    );
    expect(customXmlLabelXPath('ns0', ROOT, 'cx1')).toBe(
      "/ns0:nodes/ns0:node[@id='cx1']/ns0:label"
    );
    expect(customXmlPrefixMappings('ns0', NS)).toBe(`xmlns:ns0='${NS}'`);
  });
});

describe('a URL in the payload, for the badge thumbnail', () => {
  test('it round-trips and validates like any other field', () => {
    const { bytes, partName } = openedWithCitation();
    const reopened = readOoxmlPackage(bytes);
    if (!reopened.ok) throw new Error(reopened.reason);
    const parsed = parseCustomNodeData(
      Citation,
      readCustomXmlNode(reopened.package, partName, 'cx1')?.data ?? ''
    );
    expect(parsed.ok && parsed.value.url).toBe('https://example.test/papers/9f3.pdf');
  });

  test('the schema refuses what is not a URL, and names the field', () => {
    const parsed = parseCustomNodeData(
      Citation,
      '{"sourceId":"s","locator":"","authors":[],"year":2024,"url":"not a url"}'
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.join(' ')).toContain('url');
  });

  // A schema saying "this is a URL" is not the same as "this is safe to fetch". zod accepts
  // `javascript:` and `data:` as well-formed URLs; the allowlist is what refuses them.
  test('a scheme the allowlist rejects is inert before anything renders it', () => {
    for (const hostile of [
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'vbscript:x',
    ]) {
      expect(sanitizeHref(hostile).ok).toBe(false);
    }
    expect(sanitizeHref('https://example.test/a.png').ok).toBe(true);
    // Embedded control characters are how a blocked scheme gets smuggled past a naive check.
    expect(sanitizeHref('java\tscript:alert(1)').ok).toBe(false);
  });
});

describe('preserveOnExport: false', () => {
  // The PAYLOAD half only. Stripping the store leaves any `w:dataBinding` in the body pointing
  // at a store that is gone; unwrapping the control belongs to the export path and is not
  // built, so these assert what this layer actually removes and nothing more.
  test('exporting strips the store, its parts, its relationships and its content type', () => {
    const { bytes } = openedWithCitation();
    const reopened = readOoxmlPackage(bytes);
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(findCustomXmlDataPart(reopened.package, STORY, NS)).not.toBeNull();

    const exported = withoutCustomXmlDataPart(reopened.package, STORY, NS);
    // The refusal is the interesting half: a caller that reads `ok` as "nothing to strip"
    // ships the payload it meant to remove.
    expect(exported.ok).toBe(true);
    const written = writeOoxmlPackage(exported.pkg);
    const readBack = readOoxmlPackage(written);
    if (!readBack.ok) throw new Error(readBack.reason);

    expect(findCustomXmlDataPart(readBack.package, STORY, NS)).toBeNull();
    // Nothing named customXml anywhere: not a part, not a relationship, not an Override.
    const names = [...readBack.package.parts.keys(), ...readBack.package.partBytes.keys()];
    expect(names.filter((name) => /customxml/i.test(name))).toEqual([]);
    const zipText = new TextDecoder().decode(written);
    expect(zipText.includes('customXml/item')).toBe(false);
  });

  test('the document still opens, and its body is untouched', () => {
    const original = document();
    if (!original.ok) throw new Error(original.reason);
    const { bytes } = openedWithCitation();
    const withStore = readOoxmlPackage(bytes);
    if (!withStore.ok) throw new Error(withStore.reason);

    const stripped = withoutCustomXmlDataPart(withStore.package, STORY, NS);
    expect(stripped.ok).toBe(true);
    const exported = readOoxmlPackage(writeOoxmlPackage(stripped.pkg));
    if (!exported.ok) throw new Error(exported.reason);
    expect(exported.package.parts.has(STORY)).toBe(true);
    expect(exported.package.parts.size).toBe(original.package.parts.size);
  });
});

describe('preserveOnExport: true', () => {
  test('the store survives, and the sweep keeps only what is still bound', () => {
    const read = document();
    if (!read.ok) throw new Error(read.reason);
    const authored = withCustomXmlDataPart(read.package, STORY, NS, ROOT);
    if (!authored.part) throw new Error('no store');
    let pkg = withCustomXmlNode(authored.pkg, authored.part.partName, {
      id: 'kept',
      label: 'K',
      data: '{}',
    });
    pkg = withCustomXmlNode(pkg, authored.part.partName, {
      id: 'deletedInWord',
      label: 'D',
      data: '{}',
    });

    // What a control deleted in Word leaves behind: the node, with nothing binding it.
    const swept = withoutOrphanCustomXmlNodes(pkg, authored.part.partName, new Set(['kept']));
    expect(swept.removed).toEqual(['deletedInWord']);

    const reopened = readOoxmlPackage(writeOoxmlPackage(swept.pkg));
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(customXmlNodes(reopened.package, authored.part.partName).map((n) => n.id)).toEqual([
      'kept',
    ]);
  });
});
