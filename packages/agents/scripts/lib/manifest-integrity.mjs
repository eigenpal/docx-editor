/**
 * Internal-consistency checks for `compat/manifest.json`.
 *
 * These are the checks `bun test` can make *offline*, entirely from files
 * already checked into the repository: they catch a manifest that
 * references a symbol/member no longer present in the frozen reference
 * fixture, a category list that drifted from `manifest.symbols`, or an
 * omission entry that is malformed or contradicts an active selection.
 *
 * What this deliberately cannot check offline: whether the manifest is
 * *complete* — i.e. whether some upstream Word member exists that the
 * manifest neither selected nor recorded as a deliberate omission. That
 * requires the full upstream declaration text, which is only ever fetched
 * transiently by the scheduled drift-check job (never vendored here).
 */

const OMISSION_UID_PATTERN = /^(Word|OfficeExtension)\.[A-Za-z0-9_]+(#[A-Za-z0-9_]+)?$/;

function symbolLabel(symbolName) {
  return symbolName;
}

export function validateManifestAgainstReference(manifest, referenceFixture) {
  const issues = [];
  const referenceSymbols = referenceFixture?.symbols ?? {};
  const manifestSymbols = manifest?.symbols ?? {};

  for (const [symbolName, selection] of Object.entries(manifestSymbols)) {
    const referenceSymbol = referenceSymbols[symbolName];
    if (!referenceSymbol) {
      issues.push(`manifest.symbols.${symbolLabel(symbolName)}: no corresponding reference symbol (stale manifest entry?)`);
      continue;
    }
    if (selection.isFunction) continue;
    const referenceMembers = referenceSymbol.members ?? {};
    for (const memberName of selection.members ?? []) {
      if (!(memberName in referenceMembers)) {
        issues.push(
          `manifest.symbols.${symbolLabel(symbolName)}.members: "${memberName}" has no corresponding reference member (stale manifest entry?)`
        );
      }
    }
  }

  for (const [categoryName, symbolNames] of Object.entries(manifest?.categories ?? {})) {
    for (const symbolName of symbolNames) {
      if (!(symbolName in manifestSymbols)) {
        issues.push(
          `manifest.categories.${categoryName}: "${symbolName}" is not a key in manifest.symbols`
        );
      }
    }
  }

  const selectedMemberUids = new Set();
  for (const [symbolName, selection] of Object.entries(manifestSymbols)) {
    for (const memberName of selection.members ?? []) {
      selectedMemberUids.add(`Word.${symbolName}#${memberName}`);
    }
  }

  for (const omission of manifest?.omissions ?? []) {
    const uid = omission?.uid ?? '(missing uid)';
    if (typeof omission?.reason !== 'string' || omission.reason.trim().length === 0) {
      issues.push(`manifest.omissions: "${uid}" is missing a non-empty reason`);
    }
    if (typeof omission?.uid !== 'string' || !OMISSION_UID_PATTERN.test(omission.uid)) {
      issues.push(`manifest.omissions: "${uid}" does not look like a Word.*/OfficeExtension.* UID`);
      continue;
    }
    if (selectedMemberUids.has(omission.uid)) {
      issues.push(
        `manifest.omissions: "${omission.uid}" contradicts an active selection — it is both selected and recorded as omitted`
      );
    }
  }

  return issues;
}
