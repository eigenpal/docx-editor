// A package edit that refuses its transaction, rather than crashing it.
//
// `TransactionContext.applyPackage` takes a pure `(pkg) => pkg` function, which has no way to
// say "no" except to throw. A plain throw escaped `transact` and reached the caller as an
// untyped `Error`, which a script cannot tell apart from a crash. An edit that finds the package
// is not the one it was planned against throws this instead, and the store turns it into an
// ordinary `package-changed` refusal: nothing applied, no revision, a reason the caller can read.

const PACKAGE_EDIT_REFUSAL = Symbol.for('docx-editor.package-edit-refusal');

/**
 * Thrown by a `ctx.applyPackage` edit to refuse the whole transaction as `package-changed`.
 *
 * @internal
 */
export class PackageEditRefusal extends Error {
  readonly [PACKAGE_EDIT_REFUSAL] = true;

  constructor(readonly detail: string) {
    super(detail);
    this.name = 'PackageEditRefusal';
  }
}

/**
 * Whether `error` is a {@link PackageEditRefusal}, branded rather than `instanceof` so a
 * refusal from another copy of the module is still recognized.
 *
 * @internal
 */
export function isPackageEditRefusal(error: unknown): error is PackageEditRefusal {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { [PACKAGE_EDIT_REFUSAL]?: unknown })[PACKAGE_EDIT_REFUSAL] === true
  );
}
