/**
 * Computes a symbol/member-level delta between two normalized reference
 * fixtures (the checked-in `word.reference.json` shape from
 * `reference-normalize.mjs`) — used by `fetch-office-reference.mjs --check`
 * to turn a bare "the fixture differs" boolean into the actual added/
 * removed/changed symbols, members, and overloads a maintainer reviewing
 * the scheduled drift issue needs, without requiring them to fetch and diff
 * the two JSON files by hand.
 *
 * Pure and offline: takes two already-parsed fixture objects, never reads
 * files or the network itself.
 */

import { overloadEquals } from './shape-compare.mjs';

function overloadKey(overload) {
  return JSON.stringify({
    params: overload.params.map((p) => ({ type: p.type, optional: Boolean(p.optional) })),
    returns: overload.returns,
  });
}

/** Overloads present in `next` with no exact (`overloadEquals`) match in `previous`, and vice versa. */
function diffOverloads(previousOverloads, nextOverloads) {
  const added = nextOverloads.filter(
    (next) => !previousOverloads.some((prev) => overloadEquals(prev, next))
  );
  const removed = previousOverloads.filter(
    (prev) => !nextOverloads.some((next) => overloadEquals(prev, next))
  );
  return { added, removed };
}

/**
 * Diffs one member (or a function-kind symbol's own overload list) between
 * two fixtures. Returns `null` when there is no observable difference —
 * callers filter nulls out rather than pushing empty change records.
 */
function diffMemberLike(previous, next) {
  const { added: addedOverloads, removed: removedOverloads } = diffOverloads(
    previous.overloads ?? [],
    next.overloads ?? []
  );
  const readonlyChanged =
    Boolean(previous.readonly) !== Boolean(next.readonly)
      ? { from: Boolean(previous.readonly), to: Boolean(next.readonly) }
      : undefined;
  const requirementSetChanged =
    (previous.requirementSet ?? null) !== (next.requirementSet ?? null)
      ? { from: previous.requirementSet ?? null, to: next.requirementSet ?? null }
      : undefined;

  if (
    addedOverloads.length === 0 &&
    removedOverloads.length === 0 &&
    readonlyChanged === undefined &&
    requirementSetChanged === undefined
  ) {
    return null;
  }
  return { addedOverloads, removedOverloads, readonlyChanged, requirementSetChanged };
}

function diffClassOrInterfaceSymbol(previous, next) {
  const previousMembers = previous.members ?? {};
  const nextMembers = next.members ?? {};

  const addedMembers = Object.keys(nextMembers)
    .filter((name) => !(name in previousMembers))
    .map((name) => nextMembers[name].uid);
  const removedMembers = Object.keys(previousMembers)
    .filter((name) => !(name in nextMembers))
    .map((name) => previousMembers[name].uid);

  const changedMembers = [];
  for (const [name, nextMember] of Object.entries(nextMembers)) {
    const previousMember = previousMembers[name];
    if (!previousMember) continue;
    const memberDiff = diffMemberLike(previousMember, nextMember);
    if (memberDiff) changedMembers.push({ uid: nextMember.uid, ...memberDiff });
  }

  if (addedMembers.length === 0 && removedMembers.length === 0 && changedMembers.length === 0) {
    return null;
  }
  return { uid: next.uid, addedMembers, removedMembers, changedMembers };
}

/**
 * @param {object} previousFixture The currently checked-in reference fixture.
 * @param {object} nextFixture A freshly regenerated reference fixture.
 * @returns `{ addedSymbols, removedSymbols, changedSymbols }` — UIDs for
 *   whole-symbol adds/removes, and one entry per symbol that still exists
 *   on both sides but has an added/removed member or overload-level change
 *   somewhere inside it (member-level entries for class/interface symbols,
 *   or `addedOverloads`/`removedOverloads` directly for function symbols
 *   such as `Word.run`, which have no `members` of their own).
 */
export function diffReferenceFixtures(previousFixture, nextFixture) {
  const previousSymbols = previousFixture?.symbols ?? {};
  const nextSymbols = nextFixture?.symbols ?? {};

  const addedSymbols = Object.keys(nextSymbols)
    .filter((name) => !(name in previousSymbols))
    .map((name) => nextSymbols[name].uid);
  const removedSymbols = Object.keys(previousSymbols)
    .filter((name) => !(name in nextSymbols))
    .map((name) => previousSymbols[name].uid);

  const changedSymbols = [];
  for (const [name, nextSymbol] of Object.entries(nextSymbols)) {
    const previousSymbol = previousSymbols[name];
    if (!previousSymbol) continue;

    if (nextSymbol.kind === 'function') {
      const memberDiff = diffMemberLike(previousSymbol, nextSymbol);
      if (memberDiff) changedSymbols.push({ uid: nextSymbol.uid, ...memberDiff });
      continue;
    }
    const symbolDiff = diffClassOrInterfaceSymbol(previousSymbol, nextSymbol);
    if (symbolDiff) changedSymbols.push(symbolDiff);
  }

  return { addedSymbols, removedSymbols, changedSymbols };
}

function formatOverload(overload) {
  const params = overload.params
    .map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`)
    .join(', ');
  return `(${params}) => ${overload.returns}`;
}

function formatOverloadChanges(label, addedOverloads, removedOverloads, lines) {
  for (const overload of addedOverloads ?? []) {
    lines.push(`      + overload added: ${formatOverload(overload)}`);
  }
  for (const overload of removedOverloads ?? []) {
    lines.push(`      - overload removed: ${formatOverload(overload)}`);
  }
  void label;
}

/**
 * Renders `diffReferenceFixtures`'s output as a human-readable summary —
 * this is what `fetch-office-reference.mjs --check` prints to stdout,
 * which the scheduled workflow captures and embeds in the drift-tracking
 * issue body (see `.github/workflows/office-compat-drift.yml`).
 */
export function formatReferenceDiff(diff) {
  const { addedSymbols = [], removedSymbols = [], changedSymbols = [] } = diff ?? {};
  if (addedSymbols.length === 0 && removedSymbols.length === 0 && changedSymbols.length === 0) {
    return 'No symbol-level differences and no member-level differences (only provenance metadata, such as the upstream version string, may have changed).';
  }

  const lines = [];
  if (addedSymbols.length > 0) {
    lines.push(`Added symbols (${addedSymbols.length}):`);
    for (const uid of addedSymbols) lines.push(`  + ${uid}`);
  }
  if (removedSymbols.length > 0) {
    lines.push(`Removed symbols (${removedSymbols.length}):`);
    for (const uid of removedSymbols) lines.push(`  - ${uid}`);
  }
  if (changedSymbols.length > 0) {
    lines.push(`Changed symbols (${changedSymbols.length}):`);
    for (const change of changedSymbols) {
      lines.push(`  ~ ${change.uid}`);
      for (const uid of change.addedMembers ?? []) lines.push(`      + member added: ${uid}`);
      for (const uid of change.removedMembers ?? []) lines.push(`      - member removed: ${uid}`);
      for (const memberChange of change.changedMembers ?? []) {
        lines.push(`      ~ member changed: ${memberChange.uid}`);
        formatOverloadChanges(
          memberChange.uid,
          memberChange.addedOverloads,
          memberChange.removedOverloads,
          lines
        );
        if (memberChange.readonlyChanged) {
          lines.push(
            `        readonly: ${memberChange.readonlyChanged.from} -> ${memberChange.readonlyChanged.to}`
          );
        }
        if (memberChange.requirementSetChanged) {
          lines.push(
            `        requirementSet: ${memberChange.requirementSetChanged.from} -> ${memberChange.requirementSetChanged.to}`
          );
        }
      }
      // Function-kind symbols (e.g. Word.run) carry addedOverloads/removedOverloads directly.
      formatOverloadChanges(change.uid, change.addedOverloads, change.removedOverloads, lines);
      if (change.readonlyChanged) {
        lines.push(
          `      readonly: ${change.readonlyChanged.from} -> ${change.readonlyChanged.to}`
        );
      }
      if (change.requirementSetChanged) {
        lines.push(
          `      requirementSet: ${change.requirementSetChanged.from} -> ${change.requirementSetChanged.to}`
        );
      }
    }
  }
  return lines.join('\n');
}
