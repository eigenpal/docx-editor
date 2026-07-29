// Core block-capability registry (comprehensive 3.1–3.3). The built-in paragraph/table/SDT
// capabilities are registered when the model + package modules load; this proves the registry
// dispatches each core operation by kind, applies edit policy, and errors clearly for a missing op.

import { describe, expect, test } from 'bun:test';
import {
  blockHashContent,
  blockNormalize,
  blockSerialize,
  blockPatchEdited,
  isTopLevelEditable,
  hasBlockSerialize,
  blockSemanticOps,
  blockNestedBlocks,
  walkBlockTree,
  registerCoreBlockCapability,
  createEmptyModel,
  bodyStoryId,
  type Block,
} from '../model/index.ts';
// Loading the package layer registers serialize + patchEdited (it augments the model registry).
import '../package/wml-serialize.ts';
import '../package/wml-preserve.ts';

const para = (runs: { text: string; props?: { bold?: boolean } }[]): Block => ({ kind: 'paragraph', id: 'p1', runs });

describe('block-capability registry: core operations dispatch by kind', () => {
  test('normalize merges adjacent identical-prop runs via the paragraph capability', () => {
    const n = blockNormalize(para([{ text: 'a' }, { text: 'b' }]), (bs) => bs) as { runs: { text: string }[] };
    expect(n.runs).toEqual([{ text: 'ab' }]);
  });

  test('hashContent hashes NORMALIZED runs, so a re-segmented paragraph hashes equal', () => {
    const merged = blockHashContent(para([{ text: 'ab' }]), (b) => b);
    const split = blockHashContent(para([{ text: 'a' }, { text: 'b' }]), (b) => b);
    expect(JSON.stringify(merged)).toBe(JSON.stringify(split));
  });

  test('serialize regenerates a paragraph and fails closed for table/SDT', () => {
    expect(blockSerialize(para([{ text: 'hi' }]))).toBe('<w:p><w:r><w:t xml:space="preserve">hi</w:t></w:r></w:p>');
    expect(hasBlockSerialize('paragraph')).toBe(true);
    const table: Block = { kind: 'table', rows: [] };
    expect(() => blockSerialize(table)).toThrow(/table regeneration is not implemented/);
  });

  test('edit policy: paragraph is top-level editable, table/SDT are not', () => {
    expect(isTopLevelEditable('paragraph')).toBe(true);
    expect(isTopLevelEditable('table')).toBe(false);
    expect(isTopLevelEditable('sdt')).toBe(false);
  });

  test('patchEdited for a paragraph fails closed when the reparsed kind changed', () => {
    const block = para([{ text: 'x' }]);
    expect(() =>
      blockPatchEdited({ block, reparsed: { kind: 'table', rows: [] }, sliceText: '<w:p/>', rangeStart: 0, rangeEnd: 5 }),
    ).toThrow(/kind changed/);
  });

  test('paragraph declares its semantic ops; table/SDT declare none', () => {
    expect(blockSemanticOps('paragraph')).toContain('splitParagraph');
    expect(blockSemanticOps('paragraph')).toContain('setParagraphRuns');
    expect(blockSemanticOps('table')).toEqual([]);
  });

  test('nestedBlocks + walkBlockTree traverse containers without a switch', () => {
    const inner = para([{ text: 'cell' }]);
    const table: Block = { kind: 'table', rows: [{ cells: [{ blocks: [inner] }] }] };
    expect(blockNestedBlocks(table)).toEqual([inner]);
    expect(blockNestedBlocks(para([{ text: 'x' }]))).toEqual([]); // leaf
    const seen: string[] = [];
    walkBlockTree([table], (b) => seen.push(b.kind));
    expect(seen).toEqual(['table', 'paragraph']); // pre-order: container then its nested block
  });

  test('a missing operation errors clearly (never silently no-ops)', () => {
    // 'command' is not a registered op name; opFor throws a named error for an unknown kind too.
    const bogus = { kind: 'mystery' } as unknown as Block;
    expect(() => blockNormalize(bogus, (bs) => bs)).toThrow(/no core block capability .*mystery/);
  });

  test('re-registering an op a kind already owns is REJECTED (no silent global override)', () => {
    // sdt already owns normalize (built-in); a second normalize registration must throw rather
    // than clobber it, so one feature cannot silently replace another's core operation.
    expect(() => registerCoreBlockCapability({ kind: 'sdt', normalize: (b) => b })).toThrow(
      /duplicate core block capability op 'normalize'/,
    );
    // The built-in registrations still stand.
    const model = createEmptyModel();
    expect(isTopLevelEditable('paragraph')).toBe(true);
    expect(model.stories.get(bodyStoryId(model))).toBeDefined();
  });
});
