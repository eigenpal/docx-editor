/**
 * Set-diff + formatted report helpers shared by parity gate scripts.
 *
 * `diffSets(left, right, allowed?)` returns the symmetric difference, optionally
 * filtered through an opt-out set. `formatDiff(opts)` writes a `✗`/`ⓘ` report
 * block to the given stream and returns whether the gate failed.
 */

/**
 * @param {Set<string>} left
 * @param {Set<string>} right
 * @param {Set<string>} [allowed]
 * @returns {{ leftOnly: string[], rightOnly: string[] }}
 */
export function diffSets(left, right, allowed = new Set()) {
  return {
    leftOnly: [...left].filter((k) => !right.has(k) && !allowed.has(k)),
    rightOnly: [...right].filter((k) => !left.has(k) && !allowed.has(k)),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.label - report header (e.g. "subpath parity")
 * @param {string} opts.leftLabel - what "left-only" means (e.g. "React-only")
 * @param {string} opts.rightLabel - same for right (e.g. "Vue-only")
 * @param {string[]} opts.leftOnly
 * @param {string[]} opts.rightOnly
 * @param {boolean} [opts.strict=true] - if false, log informationally and don't fail
 * @param {string} [opts.informationalNote] - extra line printed when !strict
 * @param {number} [opts.truncate=25] - max entries to print per side
 * @returns {boolean} true iff the gate failed (strict + drift)
 */
export function formatDiff({
  label,
  leftLabel,
  rightLabel,
  leftOnly,
  rightOnly,
  strict = true,
  informationalNote,
  truncate = 25,
}) {
  const total = leftOnly.length + rightOnly.length;
  if (total === 0) return false;

  const failed = strict;
  const sym = strict ? '✗' : 'ⓘ';
  const stream = strict ? console.error : console.log;
  stream(`${sym} ${label}: drift (${leftOnly.length} ${leftLabel}, ${rightOnly.length} ${rightLabel})`);
  if (!strict) {
    if (informationalNote) stream(`  ${informationalNote}`);
    stream('');
    return false;
  }

  if (leftOnly.length) {
    stream(`  ${leftLabel} (${leftOnly.length}):`);
    for (const k of leftOnly.slice(0, truncate)) stream(`    ${k}`);
    if (leftOnly.length > truncate) stream(`    ... and ${leftOnly.length - truncate} more`);
  }
  if (rightOnly.length) {
    stream(`${leftOnly.length ? '\n' : ''}  ${rightLabel} (${rightOnly.length}):`);
    for (const k of rightOnly.slice(0, truncate)) stream(`    ${k}`);
    if (rightOnly.length > truncate) stream(`    ... and ${rightOnly.length - truncate} more`);
  }
  stream('');
  return failed;
}
