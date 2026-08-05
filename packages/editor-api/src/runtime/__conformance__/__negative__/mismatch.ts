// The control for `../declared-lifecycle.ts`.
//
// A conformance file full of type assertions is worth exactly as much as the compiler's willingness
// to reject a wrong one. This file makes a claim that is FALSE — that the declared request context
// can stand in for this runtime's — and the test next door requires it to fail to compile. If this
// ever compiles, the checks next door have stopped meaning anything and the reason is here, not
// there.

import type { DocxEditor as Declared } from '../../../../compat/docxeditor/declarations.ts';
import type { Range } from '../../../model/range.ts';
import type { RequestContext } from '../../request-context.ts';

type Satisfies<A extends B, B> = A extends B ? true : false;

// FALSE: the declared context declares only `sync`. It cannot stand in for the real one, which a
// consumer uses to reach `trackedObjects` and the capabilities of the host it is running on.
const wrongDirection: Satisfies<Declared.ClientRequestContext, RequestContext> = true;

// FALSE, and deliberately the claim the file next door does NOT make: the shipped `Range` is
// narrower than the declared one, because formatting, hyperlinks, bookmarks and content controls
// belong to LATER SLICES — members that are coming, not members that are not. What is no longer
// among them is `start`/`end`: a range does not report document-wide character offsets, this engine
// maintains no such coordinate space, and rather than leave a declaration the shipped object could
// never satisfy, they were de-selected from the manifest and removed from the declarations. If this
// ever compiles, either those later slices landed — in which case the assertion belongs next door —
// or the declarations were quietly widened to match what exists.
const wholeRangeIsImplemented: Satisfies<Range, Declared.Range> = true;

void wrongDirection;
void wholeRangeIsImplemented;
