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
    symbol: match.groups.symbol,
  };
}

export function evaluateForgottenExportPolicy({
  packageName,
  isLocal,
  allowlist,
  messages,
  protectedSymbols = [],
}) {
  void packageName;
  void isLocal;

  const protectedSet = new Set(protectedSymbols);
  const allowlisted = new Map(
    Object.entries(allowlist).map(([entry, symbols]) => [entry, new Set(symbols)])
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
    if (!allowlisted.get(parsed.entry)?.has(parsed.symbol)) {
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

  return {
    staleAllowlist: toSortedPairs(staleAllowlist),
    unallowlisted: toSortedPairs(unallowlisted),
    forbiddenAllowlist: toSortedPairs(forbiddenAllowlist),
  };
}
