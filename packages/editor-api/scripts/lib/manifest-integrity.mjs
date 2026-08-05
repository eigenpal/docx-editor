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

/** Kept in lockstep with `reference-normalize.mjs`'s/`provenance.mjs`'s own `SCHEMA_VERSION` by convention, not by import — this file validates the *manifest's* schema, a separate document. */
const SUPPORTED_MANIFEST_SCHEMA_VERSION = 1;

/**
 * The small set of zero-runtime-footprint support types
 * `compat/docxeditor/declarations.ts` is allowed to export without a
 * corresponding `manifest.symbols` entry — documented in that file's own
 * header comment. Every other exported name must be a selected manifest
 * symbol; see `validateAuthoredExportsAgainstManifest`.
 */
const ALLOWLISTED_SUPPORT_TYPES = new Set([
  'ClientRequestContext',
  'SelectionMode',
  'HeaderFooterType',
]);

function symbolLabel(symbolName) {
  return symbolName;
}

/**
 * Validates `manifest.json`'s own `schemaVersion` field — offline, no
 * reference fixture needed. Catches both a manifest that predates
 * versioning (field missing) and one written against a schema shape this
 * version of the tooling (`reference-normalize.mjs`, `shape-compare.mjs`,
 * etc.) does not understand.
 */
export function validateManifestSchemaVersion(manifest) {
  const version = manifest?.schemaVersion;
  if (version !== SUPPORTED_MANIFEST_SCHEMA_VERSION) {
    return [
      `manifest.schemaVersion: expected ${SUPPORTED_MANIFEST_SCHEMA_VERSION}, got ${JSON.stringify(version)}`,
    ];
  }
  return [];
}

/**
 * Asserts that every name `compat/docxeditor/declarations.ts` actually
 * exports (from `listExportedSymbolNames`, in `extract-docxeditor-shape.mjs`)
 * is either a selected `manifest.symbols` key or one of the documented
 * zero-runtime-footprint support types. This is the guard against the
 * "Table/Image stub sneaks in" failure mode: `manifest.json` records tables
 * and images as deliberate *omissions*, but nothing before this check
 * actually enforced that an omitted (or simply never-mentioned) symbol
 * cannot still be exported from the authored declarations — the
 * conformance generator only ever *reads* the manifest-selected subset of
 * `declarations.ts`, so an extra, unselected export is invisible to it by
 * design and would otherwise ship silently.
 */
export function validateAuthoredExportsAgainstManifest(exportedNames, manifest) {
  const manifestSymbolNames = new Set(Object.keys(manifest?.symbols ?? {}));
  const issues = [];
  for (const name of exportedNames) {
    if (manifestSymbolNames.has(name)) continue;
    if (ALLOWLISTED_SUPPORT_TYPES.has(name)) continue;
    issues.push(
      `compat/docxeditor/declarations.ts exports "${name}", which is neither a selected manifest.symbols entry nor an allowlisted zero-runtime-footprint support type (${[...ALLOWLISTED_SUPPORT_TYPES].join(', ')}) — an omitted or unselected symbol must not be exported`
    );
  }
  return issues;
}

export function validateManifestAgainstReference(manifest, referenceFixture) {
  const issues = [];
  const referenceSymbols = referenceFixture?.symbols ?? {};
  const manifestSymbols = manifest?.symbols ?? {};

  for (const [symbolName, selection] of Object.entries(manifestSymbols)) {
    const referenceSymbol = referenceSymbols[symbolName];
    if (!referenceSymbol) {
      issues.push(
        `manifest.symbols.${symbolLabel(symbolName)}: no corresponding reference symbol (stale manifest entry?)`
      );
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
