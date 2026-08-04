/**
 * Normalizes upstream Office.js conformance facts into the DocxEditor-owned
 * reference fixture format.
 *
 * This module never stores or transports Microsoft declaration *source* —
 * only the minimal facts needed for comparison (symbol/member names,
 * parameter/return shapes, requirement-set metadata, and upstream UIDs). It
 * is deliberately dependency-free and side-effect-free so it can run both in
 * the (network-capable, scheduled-only) fetch job and in offline unit tests.
 */

const SCHEMA_VERSION = 1;

function sortKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = obj[key];
  }
  return out;
}

function normalizeOverload(overload) {
  return {
    params: (overload.params ?? []).map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.optional ? { optional: true } : {}),
    })),
    returns: overload.returns,
  };
}

// `requirementSet: null` means the upstream `.d.ts` had no `[Api set: ...]`
// doc-comment tag on this declaration — it is NOT a claim that the member
// is universally available or requirement-free. Members inherited onto a
// symbol whose *class* itself carries a requirement set (e.g. every member
// of `Word.Body`) commonly have no per-member tag of their own; read the
// enclosing symbol's `requirementSet` for that case. `extract-word-reference.mjs`'s
// `getRequirementSet` is the sole place this fact is read from source.
function normalizeMember(member) {
  return {
    uid: member.uid,
    kind: member.kind,
    ...(member.readonly ? { readonly: true } : {}),
    requirementSet: member.requirementSet ?? null,
    overloads: (member.overloads ?? []).map(normalizeOverload),
  };
}

function normalizeSymbol(symbol) {
  const normalized = {
    uid: symbol.uid,
    kind: symbol.kind,
    // See the `requirementSet: null` note above `normalizeMember`; applies
    // identically at the symbol level.
    requirementSet: symbol.requirementSet ?? null,
  };
  if (symbol.kind === 'function') {
    normalized.overloads = (symbol.overloads ?? []).map(normalizeOverload);
  } else {
    const members = {};
    for (const key of Object.keys(symbol.members ?? {})) {
      members[key] = normalizeMember(symbol.members[key]);
    }
    normalized.members = sortKeys(members);
  }
  return normalized;
}

/**
 * Builds a deterministic, repository-owned reference fixture from raw
 * extracted symbol facts. Key order never depends on input order (sorted),
 * so the same logical input always serializes identically.
 */
export function buildReferenceFixture({ packageName, packageVersion, symbols }) {
  const normalizedSymbols = {};
  for (const key of Object.keys(symbols)) {
    normalizedSymbols[key] = normalizeSymbol(symbols[key]);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedFrom: {
      package: packageName,
      version: packageVersion,
    },
    symbols: sortKeys(normalizedSymbols),
  };
}

/**
 * Validates the shape of a reference fixture. Returns a list of
 * human-readable error strings (empty when valid). Never throws — callers
 * decide whether to fail loudly.
 */
export function validateReferenceFixture(fixture) {
  const errors = [];

  if (!fixture || typeof fixture !== 'object') {
    return ['fixture: expected an object'];
  }
  if (fixture.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${SCHEMA_VERSION}, got ${fixture.schemaVersion}`);
  }
  if (!fixture.generatedFrom || typeof fixture.generatedFrom.package !== 'string') {
    errors.push('generatedFrom.package: expected a string');
  }
  if (!fixture.generatedFrom || typeof fixture.generatedFrom.version !== 'string') {
    errors.push('generatedFrom.version: expected a string');
  }
  if (!fixture.symbols || typeof fixture.symbols !== 'object') {
    errors.push('symbols: expected an object');
    return errors;
  }

  for (const [symbolName, symbol] of Object.entries(fixture.symbols)) {
    if (typeof symbol.uid !== 'string' || symbol.uid.length === 0) {
      errors.push(`${symbolName}: uid: expected a non-empty string`);
    }
    if (!['class', 'interface', 'function'].includes(symbol.kind)) {
      errors.push(`${symbolName}: kind: unexpected value ${JSON.stringify(symbol.kind)}`);
    }
    if (symbol.kind === 'function') {
      validateOverloads(symbol.overloads, `${symbolName}`, errors);
      continue;
    }
    if (!symbol.members || typeof symbol.members !== 'object') {
      errors.push(`${symbolName}: members: expected an object`);
      continue;
    }
    for (const [memberName, member] of Object.entries(symbol.members)) {
      const label = `${symbolName}#${memberName}`;
      if (typeof member.uid !== 'string' || member.uid.length === 0) {
        errors.push(`${label}: uid: expected a non-empty string`);
      }
      if (!['property', 'method'].includes(member.kind)) {
        errors.push(`${label}: kind: unexpected value ${JSON.stringify(member.kind)}`);
      }
      validateOverloads(member.overloads, label, errors);
    }
  }

  return errors;
}

function validateOverloads(overloads, label, errors) {
  if (!Array.isArray(overloads)) {
    errors.push(`${label}: overloads: expected an array`);
    return;
  }
  overloads.forEach((overload, index) => {
    const overloadLabel = `${label}[${index}]`;
    if (typeof overload.returns !== 'string' || overload.returns.length === 0) {
      errors.push(`${overloadLabel}: returns: expected a non-empty string`);
    }
    if (!Array.isArray(overload.params)) {
      errors.push(`${overloadLabel}: params: expected an array`);
      return;
    }
    overload.params.forEach((param, paramIndex) => {
      const paramLabel = `${overloadLabel}.params[${paramIndex}]`;
      if (typeof param.name !== 'string' || param.name.length === 0) {
        errors.push(`${paramLabel}: name: expected a non-empty string`);
      }
      if (typeof param.type !== 'string' || param.type.length === 0) {
        errors.push(`${paramLabel}: type: expected a non-empty string`);
      }
    });
  });
}
