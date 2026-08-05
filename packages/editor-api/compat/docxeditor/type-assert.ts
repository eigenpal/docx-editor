/**
 * A strict, bidirectional type-equality check — deliberately *not* a
 * one-directional structural `extends` check.
 *
 * `A extends B` alone treats a narrower `A` as "compatible" with a wider
 * `B` (and vice versa for the reverse direction), which is exactly the
 * silent-drift failure mode `compat/generate-conformance.mjs`'s header
 * comment describes: a DocxEditor overload that only accepts a subset of
 * what the frozen Office.js contract promises still `extends` it in one
 * direction. `IsExact` uses the classic "distribute a bare type variable
 * over both sides of a conditional, then compare the two conditional types
 * for exact identity" trick so that primitive-vs-boxed, union widening, and
 * optional-vs-required differences all fail, not just outright unrelated
 * types.
 */
export type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;

/**
 * Fails to compile (constraint violation) unless `T` is literally `true`.
 *
 * Deliberately kept as its own, separately-instantiated generic rather than
 * folded into a single `AssertExact<A, B>` combinator: TypeScript checks a
 * generic type alias's body against a referenced constraint using the
 * *unresolved, still-generic* form of that reference, so
 * `type AssertExact<A, B> = Expect<IsExact<A, B>>` fails to compile at its
 * own definition (it can't prove `IsExact<A, B>` satisfies `extends true`
 * for arbitrary `A`/`B`) regardless of what concrete types callers pass.
 * Splitting it into two steps — first resolve `IsExact<Ref, Auth>` for
 * concrete `Ref`/`Auth` into a literal `true`/`false` via an ordinary
 * (non-generic) type alias, *then* pass that already-concrete literal to
 * `Expect` — lets the constraint check happen against a real, resolved
 * value. `generate-conformance.mjs` emits exactly this two-step shape per
 * overload.
 */
export type Expect<T extends true> = T;
