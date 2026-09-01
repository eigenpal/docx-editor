// Section-column balancing over the neutral semantic block-flow pass.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { RefFieldContext } from './field-ref.ts';
import type { LayoutSession } from './layout-session.ts';
import type { PageContentInsets, OverflowPageShell } from './page-furniture-insets.ts';
import { resolveSectionColumns, type ResolvedSectionColumns } from './section-columns.ts';
import { DEFAULT_SECTION_PROPERTIES, type SectionColumns } from './section-properties.ts';
import type { LayoutBox, PageGeometry, PageRecord, SemanticLayout } from './semantic-records.ts';
import { isOutOfFlowTableFragment } from './table-float-position.ts';

/** Result shared by ordinary and column-balanced block-flow passes. @internal */
export interface BlockLayoutResult {
  readonly layout: SemanticLayout;
  readonly pages: readonly PageRecord[];
  readonly lineCounter: number;
  /** Used height of the LAST page's content column, for a section that continues onto it. */
  readonly endCursorY: number;
  /** Trailing paragraph spacing at the end of the flow, for adjacent-spacing collapse. */
  readonly endSpaceAfter: number;
  /** Whether the last page is the one the flow was still filling. */
  readonly endsOpenPage: boolean;
  /** Resolve the content box and furniture for a note-overflow sheet at this document index. */
  readonly overflowShellAt: (documentPageIndex: number, box: LayoutBox) => OverflowPageShell;
}

/** Session state the balance search reads and publishes. */
type ColumnBalanceSession = Pick<LayoutSession, 'balanceLimit' | 'endCursorY' | 'stats'>;

/** Internal section-flow inputs layered over a host's semantic options. @internal */
export type BlockLayoutOptions<HostOptions extends object = object> = HostOptions & {
  readonly geometry: PageGeometry;
  readonly sectionColumns?: SectionColumns;
  readonly lineCounterStart?: number;
  readonly flowStartY?: number;
  readonly spaceBeforeCarry?: number;
  readonly pageIndexStart?: number;
  /** The host sheet's content box when this section continues the previous one. */
  readonly continuedPageInsets?: PageContentInsets;
  /** Balance a continuous section's columns instead of filling each to the page bottom. */
  readonly balanceColumns?: boolean;
  /** First-page column bottom used internally by the bounded balance search. */
  readonly columnRegionBottom?: number;
  /** Section page-number format used to measure body page-field placeholders. */
  readonly bodyPageNumberFormat?: string;
  /** Story REF inputs built by the document composition root. */
  readonly refFields?: RefFieldContext;
  readonly session?: ColumnBalanceSession;
};

/** One ordinary block-flow attempt supplied by semantic layout. @internal */
export type BlockLayoutPass<HostOptions extends object> = (
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions<HostOptions>
) => BlockLayoutResult;

/** Content-relative bottom of each column's content on one page, floored at the region top. */
function columnBottomsOf(
  page: PageRecord,
  columns: ResolvedSectionColumns,
  regionTop: number
): number[] {
  const bottoms = columns.lefts.map(() => regionTop);
  for (const fragment of page.fragments) {
    if (isOutOfFlowTableFragment(fragment)) continue;
    let column = 0;
    // A fragment starts at its column's left edge plus indents; assign it to the LAST
    // column whose origin it does not precede (half-point slack for table indents).
    for (let index = columns.count - 1; index >= 0; index -= 1) {
      if (fragment.box.x + 0.5 >= columns.lefts[index]!) {
        column = index;
        break;
      }
    }
    bottoms[column] = Math.max(bottoms[column]!, fragment.box.y + fragment.box.height);
  }
  return bottoms;
}

/** The balance search stops once the fitting bound is known this tightly (points). */
const BALANCE_TOLERANCE_PT = 0.25;
const MAX_BALANCE_STEPS = 20;

/**
 * Lay a block run out under its section geometry, balancing columns when asked.
 *
 * Word balances the columns of a multi-column section that ends in a continuous section
 * break. The flow already advances columns, so balancing finds the shortest first-page
 * column height that still keeps the section on one sheet. Trial passes are session-less;
 * only the final pass publishes incremental state.
 */
export function layoutBlocksWithColumnBalance<HostOptions extends object>(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions<HostOptions>,
  layoutPass: BlockLayoutPass<HostOptions>
): BlockLayoutResult {
  const columns = resolveSectionColumns(
    options.sectionColumns ?? DEFAULT_SECTION_PROPERTIES.columns,
    options.geometry.width - options.geometry.margin.left - options.geometry.margin.right
  );
  if (!options.balanceColumns || columns.count < 2 || options.columnRegionBottom !== undefined) {
    if (options.session) options.session.balanceLimit = null;
    return layoutPass(bodies, revision, options);
  }

  const session = options.session;
  const regionTop = options.flowStartY ?? 0;
  const trialOptions: BlockLayoutOptions<HostOptions> = { ...options, session: undefined };
  const balancedResult = (final: BlockLayoutResult): BlockLayoutResult => {
    const page = final.pages[0];
    // The next continuous section resumes below the whole balanced region, not below the
    // last column's own cursor.
    const endCursorY = page
      ? Math.max(...columnBottomsOf(page, columns, regionTop))
      : final.endCursorY;
    if (session) session.endCursorY = endCursorY;
    return { ...final, endCursorY };
  };

  // An unchanged section tries its remembered limit first. A stale limit costs one attempt;
  // the bounded search below then refreshes it.
  if (session && session.balanceLimit !== null) {
    const remembered = session.balanceLimit;
    const attempt = layoutPass(bodies, revision, {
      ...options,
      columnRegionBottom: remembered,
    });
    if (session.stats.placed === 0 && session.stats.reusedPages === attempt.pages.length) {
      session.balanceLimit = remembered;
      return balancedResult(attempt);
    }
  }

  const natural = layoutPass(bodies, revision, trialOptions);
  if (natural.pages.length !== 1 || !natural.endsOpenPage) {
    if (session) session.balanceLimit = null;
    return layoutPass(bodies, revision, options);
  }

  const naturalBottoms = columnBottomsOf(natural.pages[0]!, columns, regionTop);
  const total = naturalBottoms.reduce((sum, bottom) => sum + Math.max(0, bottom - regionTop), 0);
  if (total <= 0) {
    if (session) session.balanceLimit = null;
    return layoutPass(bodies, revision, options);
  }

  let low = regionTop + total / columns.count;
  let high = Math.max(...naturalBottoms) + 0.01;
  const fits = (limit: number): boolean => {
    try {
      const trial = layoutPass(bodies, revision, {
        ...trialOptions,
        columnRegionBottom: limit,
      });
      return trial.pages.length === 1 && trial.endsOpenPage;
    } catch {
      // Keep rules or atomic rows can refuse a short band; that is simply "does not fit".
      return false;
    }
  };
  for (let step = 0; step < MAX_BALANCE_STEPS && high - low > BALANCE_TOLERANCE_PT; step += 1) {
    const mid = (low + high) / 2;
    if (fits(mid)) high = mid;
    else low = mid;
  }

  const final = layoutPass(bodies, revision, { ...options, columnRegionBottom: high });
  if (session) session.balanceLimit = high;
  return balancedResult(final);
}
