// Forgotten-export policy for `api:check`.
//
// A forgotten export is a type a public signature hands a consumer that the entry point does
// not export, so the consumer cannot name it. Two lists excuse one:
//
// - the reviewed ALLOWLIST in `scripts/lib/packages.mjs`, for symbols that are meant to stay
//   unexported here (owned by another package, or internal machinery), with a reason beside it;
// - the BASELINE in `scripts/api-forgotten-exports.baseline.json`, for warnings that existed
//   when the gate was introduced. A new warning fails until the type is exported. Only an
//   explicit `node scripts/api-extractor.mjs --local --record-forgotten-exports` run rewrites
//   the file: it drops entries that no longer warn and, after review, records new ones.
//
// MATCHING IS COUNTED. `Foo$1` is the declaration bundler's rename for a second declaration
// named `Foo`, and which copy gets the suffix depends on emit order, so `$N` is normalized away.
// The baseline then lists `Foo` once per declaration, and a run that reports more `Foo`s than
// the baseline lists fails: a new `Foo$1` cannot hide behind a baselined `Foo`. Every other
// suffix, such as `_2` or a real name like `Level_1`, is kept as written.

const FORGOTTEN_EXPORT_RE =
  /^(?<entry>[^:]+): The symbol "(?<symbol>[^"]+)" needs to be exported by the entry point /;

function counts(symbols) {
  const result = new Map();
  for (const symbol of symbols) result.set(symbol, (result.get(symbol) ?? 0) + 1);
  return result;
}

function toSortedPairs(entries) {
  return entries.sort((a, b) =>
    a.entry === b.entry ? a.symbol.localeCompare(b.symbol) : a.entry.localeCompare(b.entry)
  );
}

export function parseForgottenExportMessage(message) {
  const match = FORGOTTEN_EXPORT_RE.exec(message);
  if (!match?.groups) return null;
  return {
    entry: match.groups.entry,
    // Only the bundler's `$N` rename; see the counted matching above.
    symbol: match.groups.symbol.replace(/\$\d+$/, ''),
  };
}

export function evaluateForgottenExportPolicy({
  packageName,
  isLocal,
  allowlist,
  messages,
  protectedSymbols = [],
  baseline = {},
}) {
  void packageName;
  void isLocal;

  const protectedSet = new Set(protectedSymbols);
  // Counted like the baseline: listing `Foo` once excuses one `Foo`, so a second declaration
  // reported as `Foo$1` still fails until it is listed again.
  const allowlisted = new Map(
    Object.entries(allowlist).map(([entry, symbols]) => [entry, counts(symbols)])
  );
  const baselined = new Map(
    Object.entries(baseline).map(([entry, symbols]) => [entry, counts(symbols)])
  );

  const seen = new Map();
  const unparsed = [];
  for (const message of messages) {
    const parsed = parseForgottenExportMessage(message);
    if (!parsed) {
      unparsed.push({ entry: '<unparsed>', symbol: message });
      continue;
    }
    const perEntry = seen.get(parsed.entry) ?? new Map();
    perEntry.set(parsed.symbol, (perEntry.get(parsed.symbol) ?? 0) + 1);
    seen.set(parsed.entry, perEntry);
  }

  const unallowlisted = [...unparsed];
  for (const [entry, symbols] of seen) {
    for (const [symbol, count] of symbols) {
      const known =
        (allowlisted.get(entry)?.get(symbol) ?? 0) + (baselined.get(entry)?.get(symbol) ?? 0);
      for (let extra = known; extra < count; extra += 1) unallowlisted.push({ entry, symbol });
    }
  }

  const staleAllowlist = [];
  const forbiddenAllowlist = [];
  for (const [entry, symbols] of allowlisted) {
    for (const [symbol, count] of symbols) {
      if (protectedSet.has(symbol)) forbiddenAllowlist.push({ entry, symbol });
      const reported = seen.get(entry)?.get(symbol) ?? 0;
      for (let extra = reported; extra < count; extra += 1) staleAllowlist.push({ entry, symbol });
    }
  }

  const staleBaseline = [];
  for (const [entry, symbols] of baselined) {
    for (const [symbol, count] of symbols) {
      if (protectedSet.has(symbol)) forbiddenAllowlist.push({ entry, symbol });
      const reported = Math.max(
        0,
        (seen.get(entry)?.get(symbol) ?? 0) - (allowlisted.get(entry)?.get(symbol) ?? 0)
      );
      for (let extra = reported; extra < count; extra += 1) staleBaseline.push({ entry, symbol });
    }
  }

  return {
    staleAllowlist: toSortedPairs(staleAllowlist),
    staleBaseline: toSortedPairs(staleBaseline),
    unallowlisted: toSortedPairs(unallowlisted),
    forbiddenAllowlist: toSortedPairs(forbiddenAllowlist),
  };
}

/**
 * The baseline for one package after a run: stale entries dropped and, when `record` is set,
 * every new forgotten export added. Entries and symbols come back sorted so the committed file
 * diffs cleanly.
 */
export function nextForgottenExportBaseline({ baseline = {}, policy, record = false }) {
  const next = new Map(Object.entries(baseline).map(([entry, symbols]) => [entry, [...symbols]]));
  for (const { entry, symbol } of policy.staleBaseline) {
    const symbols = next.get(entry);
    const at = symbols?.indexOf(symbol) ?? -1;
    if (at >= 0) symbols.splice(at, 1);
  }
  if (record) {
    for (const { entry, symbol } of policy.unallowlisted) {
      if (entry === '<unparsed>') continue;
      const symbols = next.get(entry) ?? [];
      symbols.push(symbol);
      next.set(entry, symbols);
    }
  }
  const result = {};
  for (const entry of [...next.keys()].sort()) {
    const symbols = next.get(entry).sort();
    if (symbols.length > 0) result[entry] = symbols;
  }
  return result;
}
