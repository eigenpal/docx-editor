// Assign files before duration-based scheduling: runner-local caches must never
// change shard membership, or CI could omit files or execute them twice.
//
// `weights` (file → milliseconds) balances the shards by measured time instead of file count.
// Every shard of one run must receive the SAME weights, or the shards stop partitioning the
// suite: CI hands all of them one copy through a workflow artifact. A file without a weight
// counts as the median weight, so a new file lands where it does the least harm.
export function selectShard(files, value = '1/1', weights) {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || index > count) {
    throw new Error(`Invalid shard "${value}"; expected INDEX/TOTAL with 1 <= INDEX <= TOTAL`);
  }
  const sorted = [...files].sort();
  if (!weights) return sorted.filter((_, position) => position % count === index - 1);

  const known = sorted
    .map((file) => weights[file])
    .filter((weight) => Number.isFinite(weight) && weight >= 0)
    .sort((a, b) => a - b);
  const fallback = known.length > 0 ? known[Math.floor(known.length / 2)] : 1;
  const weightOf = (file) => {
    const weight = weights[file];
    return Number.isFinite(weight) && weight >= 0 ? weight : fallback;
  };
  // Longest first, each to the lightest shard so far; ties break by name and shard number,
  // so the assignment depends only on the file list and the weights.
  const heaviest = sorted
    .map((file) => ({ file, weight: weightOf(file) }))
    .sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : 1));
  const loads = Array.from({ length: count }, () => 0);
  const selected = [];
  for (const { file, weight } of heaviest) {
    let lightest = 0;
    for (let shard = 1; shard < count; shard += 1) {
      if (loads[shard] < loads[lightest]) lightest = shard;
    }
    loads[lightest] += weight;
    if (lightest === index - 1) selected.push(file);
  }
  return selected.sort();
}
