import type { TableFlowDeps } from './semantic-table-layout.ts';

/** Remove every live publication sink from a speculative table-row placement. */
export function stripAnchorSinksForProbe(deps: TableFlowDeps): TableFlowDeps {
  return {
    ...deps,
    measuringOnly: true,
    collectAnchoredDrawings: undefined,
    publishAnchoredDrawings: undefined,
    deferAnchoredDrawings: undefined,
    onAnchorRepublish: undefined,
    onAnchorShift: undefined,
    anchorDeferOnly: true,
  };
}
