/**
 * Strict shape comparison for conformance checking.
 *
 * Deliberately avoids TypeScript's structural `extends` relationship as the
 * comparison primitive: `extends` treats a narrowed parameter type or a
 * widened return type as "compatible" in one direction, which is exactly the
 * silent-drift failure mode this task must catch (a DocxEditor overload that
 * only accepts a subset of what Office.js promises will still `extend` the
 * reference type, but callers relying on the reference contract can pass
 * values that DocxEditor now rejects). Every overload must match exactly:
 * same parameter count, same parameter order, same parameter type text, same
 * optionality, same return type text.
 */

function paramEquals(a, b) {
  return a.type === b.type && Boolean(a.optional) === Boolean(b.optional);
}

/** Exact per-overload equality. Parameter *names* are documentation only. */
export function overloadEquals(reference, authored) {
  if (reference.returns !== authored.returns) return false;
  if (reference.params.length !== authored.params.length) return false;
  for (let i = 0; i < reference.params.length; i += 1) {
    if (!paramEquals(reference.params[i], authored.params[i])) return false;
  }
  return true;
}

function describeOverload(overload) {
  const params = overload.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`);
  return `(${params.join(', ')}) => ${overload.returns}`;
}

/**
 * Every reference overload must have an exact match somewhere in the
 * authored overload list. DocxEditor may declare additional overloads
 * (additive APIs are allowed); it may not silently narrow or widen a
 * selected Office.js overload — that surfaces as a "missing exact match"
 * issue rather than being papered over by a partial/extends match.
 */
export function compareMemberOverloads(referenceOverloads, authoredOverloads) {
  const issues = [];
  for (const referenceOverload of referenceOverloads) {
    const hasExactMatch = authoredOverloads.some((authored) =>
      overloadEquals(referenceOverload, authored)
    );
    if (!hasExactMatch) {
      issues.push(`missing exact overload match for ${describeOverload(referenceOverload)}`);
    }
  }
  return issues;
}

/**
 * Compares readonly-ness for a property-kind member. Deliberately a
 * separate check from `compareMemberOverloads`: `readonly` is a modifier on
 * the member declaration, not part of an overload's parameter/return
 * *shape*, so two overload lists can be textually identical while one side
 * is assignable and the other is not — a real API-surface difference this
 * task's strict conformance model must not silently pass. Both directions
 * are flagged: dropping `readonly` (authored callers can now assign a
 * property Office.js never lets them assign) and adding it (authored
 * callers lose a legitimate assignment Office.js allows) are each variance,
 * not just the direction that happens to compile without error either way.
 * A no-op for method-kind members, which have no notion of readonly.
 */
export function comparePropertyReadonly(referenceMember, authoredMember) {
  if (referenceMember.kind !== 'property') return [];
  const referenceReadonly = Boolean(referenceMember.readonly);
  const authoredReadonly = Boolean(authoredMember.readonly);
  if (referenceReadonly === authoredReadonly) return [];
  return [
    `readonly mismatch: reference is ${referenceReadonly ? 'readonly' : 'writable'}, authored is ${
      authoredReadonly ? 'readonly' : 'writable'
    }`,
  ];
}

/**
 * Compares one reference symbol's selected members against the authored
 * declarations for the same local name. `authored` is `undefined` when the
 * symbol itself is missing from the authored declarations.
 */
export function compareSymbol(referenceSymbol, authored) {
  const issues = [];
  if (!authored) {
    return [`missing symbol: ${referenceSymbol.uid}`];
  }
  const authoredMembers = authored.members ?? {};
  for (const [memberName, referenceMember] of Object.entries(referenceSymbol.members ?? {})) {
    const authoredMember = authoredMembers[memberName];
    if (!authoredMember) {
      issues.push(`missing member: ${referenceMember.uid} (${memberName})`);
      continue;
    }
    const memberIssues = compareMemberOverloads(
      referenceMember.overloads,
      authoredMember.overloads ?? []
    );
    for (const issue of memberIssues) {
      issues.push(`${referenceSymbol.uid}#${memberName}: ${issue}`);
    }
    for (const issue of comparePropertyReadonly(referenceMember, authoredMember)) {
      issues.push(`${referenceSymbol.uid}#${memberName}: ${issue}`);
    }
  }
  return issues;
}

/**
 * Compares every symbol in a normalized reference fixture (see
 * `reference-normalize.mjs`) against the corresponding symbol in an
 * authored fixture of the same shape (e.g. DocxEditor's own generated
 * shape data). Handles both `class`/`interface`-kind symbols (compared via
 * `compareSymbol`, member by member) and `function`-kind symbols (e.g.
 * `Word.run`, compared via `compareMemberOverloads` directly against the
 * symbol's own `overloads`, since a top-level function has no `members`).
 */
export function compareFixtures(referenceFixture, authoredFixture) {
  const issues = [];
  const authoredSymbols = authoredFixture?.symbols ?? {};
  for (const [symbolName, referenceSymbol] of Object.entries(referenceFixture?.symbols ?? {})) {
    const authoredSymbol = authoredSymbols[symbolName];
    if (!authoredSymbol) {
      issues.push(`missing symbol: ${referenceSymbol.uid}`);
      continue;
    }
    if (referenceSymbol.kind === 'function') {
      const overloadIssues = compareMemberOverloads(
        referenceSymbol.overloads ?? [],
        authoredSymbol.overloads ?? []
      );
      for (const issue of overloadIssues) {
        issues.push(`${referenceSymbol.uid}: ${issue}`);
      }
      continue;
    }
    issues.push(...compareSymbol(referenceSymbol, authoredSymbol));
  }
  return issues;
}
