// Forgotten-export policy for `api:check`.
//
// A forgotten export is a type a public signature hands a consumer that the entry point does
// not export, so the consumer cannot name it. Two lists excuse one:
//
// - the reviewed ALLOWLIST in `scripts/lib/packages.mjs`, for symbols that are meant to stay
//   unexported here (owned by another package, or internal machinery), with a reason beside it;
// - the BASELINE in `scripts/api-forgotten-exports.baseline.json`, for warnings that existed
//   when the gate was introduced. It only shrinks: `api:extract` drops entries that no longer
//   warn, and a new warning fails until the type is exported (or, after review, recorded with
//   `node scripts/api-extractor.mjs --local --record-forgotten-exports`).

const FORGOTTEN_EXPORT_RE =
  /^(?<entry>[^:]+): The symbol "(?<symbol>[^"]+)" needs to be exported by the entry point /;

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
    // `Foo$1` and `Foo_2` are the declaration bundler's renames for a second declaration
    // named `Foo`. Which copy gets the suffix depends on emit order, so the baseline keys on
    // the name a reader wrote.
    symbol: match.groups.symbol.replace(/(?:\$\d+|_\d+)$/, ''),
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
  const allowlisted = new Map(
    Object.entries(allowlist).map(([entry, symbols]) => [entry, new Set(symbols)])
  );

  const baselined = new Map(
    Object.entries(baseline).map(([entry, symbols]) => [entry, new Set(symbols)])
  );

  const seen = new Map();
  const unallowlisted = [];
  for (const message of messages) {
    const parsed = parseForgottenExportMessage(message);
    if (!parsed) {
      unallowlisted.push({ entry: '<unparsed>', symbol: message });
      continue;
    }
    const perEntry = seen.get(parsed.entry) ?? new Set();
    perEntry.add(parsed.symbol);
    seen.set(parsed.entry, perEntry);
    if (
      !allowlisted.get(parsed.entry)?.has(parsed.symbol) &&
      !baselined.get(parsed.entry)?.has(parsed.symbol)
    ) {
      unallowlisted.push(parsed);
    }
  }

  const staleAllowlist = [];
  const forbiddenAllowlist = [];
  for (const [entry, symbols] of allowlisted) {
    const seenForEntry = seen.get(entry) ?? new Set();
    for (const symbol of symbols) {
      if (protectedSet.has(symbol)) {
        forbiddenAllowlist.push({ entry, symbol });
      }
      if (!seenForEntry.has(symbol)) {
        staleAllowlist.push({ entry, symbol });
      }
    }
  }

  const staleBaseline = [];
  for (const [entry, symbols] of baselined) {
    const seenForEntry = seen.get(entry) ?? new Set();
    for (const symbol of symbols) {
      if (protectedSet.has(symbol)) forbiddenAllowlist.push({ entry, symbol });
      if (!seenForEntry.has(symbol)) staleBaseline.push({ entry, symbol });
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
  const next = new Map(
    Object.entries(baseline).map(([entry, symbols]) => [entry, new Set(symbols)])
  );
  for (const { entry, symbol } of policy.staleBaseline) next.get(entry)?.delete(symbol);
  if (record) {
    for (const { entry, symbol } of policy.unallowlisted) {
      if (entry === '<unparsed>') continue;
      const symbols = next.get(entry) ?? new Set();
      symbols.add(symbol);
      next.set(entry, symbols);
    }
  }
  const result = {};
  for (const entry of [...next.keys()].sort()) {
    const symbols = [...next.get(entry)].sort();
    if (symbols.length > 0) result[entry] = symbols;
  }
  return result;
}
