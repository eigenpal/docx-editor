import type { TableAutofitContext } from './table-autofit-widths.ts';

const scopes = new WeakMap<
  object,
  {
    measurer: TableAutofitContext['measurer'];
    passToken: string | undefined;
    fieldToken: string;
    scope: object;
  }
>();
const contextScopes = new WeakMap<TableAutofitContext, object>();

/** Internal section proof: every projection, numbering, and drawing input stayed unchanged. */
export function carryAutofitScope(
  previous: object | null | undefined,
  next: object,
  inputsEqual: boolean,
  context: TableAutofitContext,
  fieldToken: string
): boolean {
  const known = previous ? scopes.get(previous) : undefined;
  const reusable = !!(
    inputsEqual &&
    known &&
    known.measurer === context.measurer &&
    known.passToken === context.passToken &&
    known.fieldToken === fieldToken
  );
  const scope = reusable ? known!.scope : {};
  scopes.set(next, { measurer: context.measurer, passToken: context.passToken, fieldToken, scope });
  contextScopes.set(context, scope);
  return reusable;
}
export function autofitReuseScope(context: TableAutofitContext): object | undefined {
  return contextScopes.get(context);
}
