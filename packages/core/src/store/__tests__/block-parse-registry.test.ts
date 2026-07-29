// Feature-lane contract (document-engine): a new top-level block kind registers its
// element parser through the registry, and the parse-entry dispatch (blockFromText, and
// therefore parseDocx's preservation path) recognizes it WITHOUT editing a central switch.
// The built-in kinds (w:p / w:tbl / w:sdt) are registered the same way.

import { describe, expect, test } from 'bun:test';
import {
  registerBlockElementParser,
  blockElementParser,
  IdentityAllocator,
  type Block,
} from '../index.ts';
import { blockFromText } from '../package/wml-parse.ts';

describe('block-kind parse registry', () => {
  test('the built-in block kinds are registered', () => {
    for (const el of ['w:p', 'w:tbl', 'w:sdt']) expect(blockElementParser(el)).toBeInstanceOf(Function);
  });

  test('an unregistered root element yields undefined (caller fails closed)', () => {
    expect(blockFromText('<w:foreign xmlns:w="http://x"/>', new IdentityAllocator())).toBeUndefined();
  });

  test('a NEW block kind is recognized after registration, no central switch touched', () => {
    // A fictional block element the engine has never heard of.
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    registerBlockElementParser(
      'w:altChunkStub',
      (elx, alloc) => ({
        kind: 'paragraph' as const,
        id: alloc.allocate('paragraph'),
        runs: [{ text: `[${(elx as { name: string }).name}]` }],
      }),
      'paragraph',
    );
    const block = blockFromText(`<w:altChunkStub xmlns:w="${W}"/>`, new IdentityAllocator());
    expect(block?.kind).toBe('paragraph');
    expect((block as { runs: { text: string }[] }).runs[0].text).toBe('[w:altChunkStub]');
  });
});
