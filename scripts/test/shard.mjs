// Assign files before duration-based scheduling: runner-local caches must never
// change shard membership, or CI could omit files or execute them twice.
export function selectShard(files, value = '1/1') {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || index > count) {
    throw new Error(`Invalid shard "${value}"; expected INDEX/TOTAL with 1 <= INDEX <= TOTAL`);
  }
  return [...files].sort().filter((_, position) => position % count === index - 1);
}
