// Branded length units: twips and points, and the ONE conversion pair between them.
//
// The engine's rule is "points everywhere; twips convert at property-read boundaries", but a
// rule over raw `number`s is convention only — nothing stops a twips value from reaching an
// arithmetic expression that assumes points. The brands make the unit part of the type, so a
// declared `Twips` parameter refuses a raw or points-valued number at compile time.
//
// This lives in the store lane deliberately: it is the one lane every consumer of the
// conversion may import (`layout`, `automation` and `editor` all reach `store` in the lane
// DAG; none of them may reach `contracts`). See
// `packages/core/src/__tests__/core-lane-graph.ts`.

declare const TWIPS: unique symbol;
declare const POINTS: unique symbol;

/**
 * A length in twentieths of a point — OOXML's `ST_TwipsMeasure` / `ST_SignedTwipsMeasure`.
 *
 * The brand is intersection-typed onto `number`, so a `Twips` value still decays to `number`
 * wherever arithmetic consumes it; only the reverse direction — passing a raw number where
 * `Twips` is declared — is refused.
 *
 * @public
 */
export type Twips = number & { readonly [TWIPS]: true };

/**
 * A length in typographic points, the unit layout and paint compute in.
 *
 * @public
 */
export type Points = number & { readonly [POINTS]: true };

/**
 * Twentieths of a point per point.
 *
 * @public
 */
export const TWIPS_PER_POINT = 20;

/**
 * Assert that a number is a twips measurement.
 *
 * A compile-time cast, not a validator: bounds, integrality and finiteness stay at the parse
 * boundary that produced the number, exactly where they are enforced today. The cast is the
 * caller's claim about the UNIT, nothing more.
 *
 * @public
 */
export const twips = (value: number): Twips => value as Twips;

/**
 * Assert that a number is a points measurement. A compile-time cast; see {@link twips}.
 *
 * @public
 */
export const points = (value: number): Points => value as Points;

/**
 * The one twips-to-points conversion. Exact division; twips are the finer unit.
 *
 * @public
 */
export const twipsToPoints = (value: Twips): Points => (value / TWIPS_PER_POINT) as Points;

/**
 * The one points-to-twips conversion.
 *
 * Rounds to the nearest twip: every OOXML twips measurement is integral, and emitting a
 * fractional twip would write a value no consumer of the file can represent.
 *
 * @public
 */
export const pointsToTwips = (value: Points): Twips => Math.round(value * TWIPS_PER_POINT) as Twips;
