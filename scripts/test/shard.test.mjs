import { describe, expect, test } from 'bun:test';
import { selectShard } from './shard.mjs';

describe('CI test sharding', () => {
  const files = Array.from({ length: 103 }, (_, index) => `packages/core/${index}.test.ts`);

  test('shards cover every discovered file exactly once', () => {
    const shards = [1, 2, 3, 4].map((index) => selectShard(files, `${index}/4`));
    const all = shards.flat();
    expect(all.sort()).toEqual([...files].sort());
    expect(new Set(all).size).toBe(files.length);
    expect(
      Math.max(...shards.map((s) => s.length)) - Math.min(...shards.map((s) => s.length))
    ).toBe(1);
  });

  test('membership is independent of discovery order or timing cache', () => {
    expect(selectShard([...files].reverse(), '2/4')).toEqual(selectShard(files, '2/4'));
  });

  test('the default runs the entire suite without mutating discovery order', () => {
    const original = [...files];
    expect(selectShard(files)).toEqual([...files].sort());
    expect(files).toEqual(original);
  });

  test.each(['', '0/4', '5/4', '1/0', '-1/4', '1.5/4', '2', '1/4/2', '1/Infinity'])(
    'rejects invalid shard %s instead of silently skipping tests',
    (value) => expect(() => selectShard(files, value)).toThrow('Invalid shard')
  );
});
